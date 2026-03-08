#!/usr/bin/env node
/**
 * AutoLoop Mainnet Deployment Script
 *
 * Deploys AutoLoop contracts to Ethereum mainnet using GCP KMS signing
 * (same key infrastructure as racerverse-coordinator / stripe-custody).
 *
 * Usage:
 *   # Dry run (simulation only):
 *   SIGNER_MODE=kms KMS_KEY_ARN=projects/... RPC_URL=https://... \
 *     node scripts/deploy-mainnet.js --dry-run
 *
 *   # Live deployment:
 *   SIGNER_MODE=kms KMS_KEY_ARN=projects/... RPC_URL=https://... \
 *     PROXY_ADMIN=0x... node scripts/deploy-mainnet.js
 *
 * Environment:
 *   SIGNER_MODE      — "kms" for production, "dev" for testnet (required)
 *   KMS_KEY_ARN      — GCP KMS key version path (required for kms mode)
 *   PRIVATE_KEY       — Raw private key (required for dev mode only)
 *   RPC_URL           — Ethereum RPC endpoint
 *   PROXY_ADMIN       — Multisig address for proxy admin (required for mainnet)
 *   ETH_CHAIN_ID      — Expected chain ID (1 for mainnet, 11155111 for sepolia)
 *
 * The script:
 *   1. Validates environment (chain ID, signer mode, proxy admin)
 *   2. Deploys implementation contracts
 *   3. Deploys TransparentUpgradeableProxy for each
 *   4. Wires up roles (registrar on AutoLoop + Registry)
 *   5. Verifies post-deployment state
 *   6. Outputs addresses for deployments.json
 */

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const log = require("./logger");

// ── ABI + Bytecode loading from forge artifacts ──

const FORGE_OUT_DIR = path.resolve(__dirname, "../../autoloop/out");

function loadContract(name) {
  const forgePath = path.join(FORGE_OUT_DIR, `${name}.sol`, `${name}.json`);

  if (!fs.existsSync(forgePath)) {
    throw new Error(
      `Forge artifact not found: ${forgePath}. Run 'forge build' in autoloop/ first.`
    );
  }

  const artifact = JSON.parse(fs.readFileSync(forgePath, "utf8"));
  const abi = artifact.abi;
  const bytecode = artifact.bytecode?.object || artifact.bytecode;

  if (!abi) throw new Error(`No ABI found in ${forgePath}`);
  if (!bytecode) throw new Error(`No bytecode found in ${forgePath}`);

  return { abi, bytecode };
}

// ── Safety checks ──

function validateEnvironment() {
  const signerMode = process.env.SIGNER_MODE;
  const chainId = parseInt(process.env.ETH_CHAIN_ID || "0");
  const rpcUrl = process.env.RPC_URL;
  const proxyAdmin = process.env.PROXY_ADMIN;
  const dryRun = process.argv.includes("--dry-run");

  if (!rpcUrl) throw new Error("RPC_URL is required");
  if (!signerMode) throw new Error("SIGNER_MODE is required (dev or kms)");

  // Mainnet safety
  if (chainId === 1) {
    if (signerMode !== "kms") {
      throw new Error("SIGNER_MODE must be 'kms' for mainnet deployment");
    }
    if (!proxyAdmin || proxyAdmin === ethers.ZeroAddress) {
      throw new Error(
        "PROXY_ADMIN must be set to a multisig address for mainnet"
      );
    }
    if (process.env.PRIVATE_KEY) {
      throw new Error(
        "PRIVATE_KEY must not be set for mainnet — use KMS only"
      );
    }
  }

  return { signerMode, chainId, rpcUrl, proxyAdmin, dryRun };
}

async function createSigner(signerMode, provider) {
  if (signerMode === "kms") {
    const { GcpKmsSigner } = require("./gcp-kms-signer");
    const kmsKeyArn = process.env.KMS_KEY_ARN;
    if (!kmsKeyArn) throw new Error("KMS_KEY_ARN required for kms mode");
    const signer = new GcpKmsSigner(kmsKeyArn, provider);
    // Verify we can get the address
    const address = await signer.getAddress();
    log.info("KMS signer initialized", { address });
    return signer;
  } else {
    const pk = process.env.PRIVATE_KEY;
    if (!pk) throw new Error("PRIVATE_KEY required for dev mode");
    const wallet = new ethers.Wallet(pk, provider);
    log.info("Dev signer initialized", { address: wallet.address });
    return wallet;
  }
}

// ── Deployment ──

async function deployContract(signer, abi, bytecode, args = []) {
  const factory = new ethers.ContractFactory(abi, bytecode, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  return { contract, address };
}

async function main() {
  const { signerMode, chainId, rpcUrl, proxyAdmin, dryRun } =
    validateEnvironment();

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // Verify chain ID matches
  const network = await provider.getNetwork();
  if (chainId && BigInt(chainId) !== network.chainId) {
    throw new Error(
      `Chain ID mismatch: expected ${chainId}, got ${network.chainId}`
    );
  }

  const signer = await createSigner(signerMode, provider);
  const deployerAddress = await signer.getAddress();

  log.info("Deployment configuration", {
    network: network.name,
    chainId: network.chainId.toString(),
    deployer: deployerAddress,
    proxyAdmin: proxyAdmin || deployerAddress,
    signerMode,
    dryRun,
  });

  if (dryRun) {
    log.info("DRY RUN — simulating deployment only");
    const balance = await provider.getBalance(deployerAddress);
    log.info("Deployer balance", {
      eth: ethers.formatEther(balance),
    });
    // Estimate gas for deployments
    log.info("Dry run complete. Remove --dry-run to deploy.");
    return;
  }

  // Check deployer balance
  const balance = await provider.getBalance(deployerAddress);
  log.info("Deployer balance", { eth: ethers.formatEther(balance) });
  if (balance < ethers.parseEther("0.1")) {
    throw new Error(
      `Deployer balance too low: ${ethers.formatEther(balance)} ETH. Need at least 0.1 ETH.`
    );
  }

  const adminAddress = proxyAdmin || deployerAddress;

  // Load forge artifacts
  const AutoLoop = loadContract("AutoLoop");
  const AutoLoopRegistry = loadContract("AutoLoopRegistry");
  const AutoLoopRegistrar = loadContract("AutoLoopRegistrar");
  const TransparentUpgradeableProxy = loadContract(
    "TransparentUpgradeableProxy"
  );

  // Step 1: Deploy implementations
  log.info("Deploying AutoLoop implementation...");
  const { address: autoLoopImplAddr } = await deployContract(
    signer,
    AutoLoop.abi,
    AutoLoop.bytecode
  );
  log.info("AutoLoop implementation deployed", { address: autoLoopImplAddr });

  log.info("Deploying AutoLoopRegistry implementation...");
  const { address: registryImplAddr } = await deployContract(
    signer,
    AutoLoopRegistry.abi,
    AutoLoopRegistry.bytecode
  );
  log.info("Registry implementation deployed", { address: registryImplAddr });

  log.info("Deploying AutoLoopRegistrar implementation...");
  const { address: registrarImplAddr } = await deployContract(
    signer,
    AutoLoopRegistrar.abi,
    AutoLoopRegistrar.bytecode
  );
  log.info("Registrar implementation deployed", {
    address: registrarImplAddr,
  });

  // Step 2: Deploy proxies with initialization
  const autoLoopIface = new ethers.Interface(AutoLoop.abi);
  const registryIface = new ethers.Interface(AutoLoopRegistry.abi);
  const registrarIface = new ethers.Interface(AutoLoopRegistrar.abi);

  log.info("Deploying AutoLoop proxy...");
  const autoLoopInitData = autoLoopIface.encodeFunctionData("initialize", [
    "0.1.0",
  ]);
  const { address: autoLoopProxyAddr } = await deployContract(
    signer,
    TransparentUpgradeableProxy.abi,
    TransparentUpgradeableProxy.bytecode,
    [autoLoopImplAddr, adminAddress, autoLoopInitData]
  );
  log.info("AutoLoop proxy deployed", { address: autoLoopProxyAddr });

  log.info("Deploying Registry proxy...");
  const registryInitData = registryIface.encodeFunctionData("initialize", [
    deployerAddress,
  ]);
  const { address: registryProxyAddr } = await deployContract(
    signer,
    TransparentUpgradeableProxy.abi,
    TransparentUpgradeableProxy.bytecode,
    [registryImplAddr, adminAddress, registryInitData]
  );
  log.info("Registry proxy deployed", { address: registryProxyAddr });

  log.info("Deploying Registrar proxy...");
  const registrarInitData = registrarIface.encodeFunctionData("initialize", [
    autoLoopProxyAddr,
    registryProxyAddr,
    deployerAddress,
  ]);
  const { address: registrarProxyAddr } = await deployContract(
    signer,
    TransparentUpgradeableProxy.abi,
    TransparentUpgradeableProxy.bytecode,
    [registrarImplAddr, adminAddress, registrarInitData]
  );
  log.info("Registrar proxy deployed", { address: registrarProxyAddr });

  // Step 3: Wire up registrar roles
  log.info("Setting registrar on AutoLoop...");
  const autoLoop = new ethers.Contract(
    autoLoopProxyAddr,
    AutoLoop.abi,
    signer
  );
  const tx1 = await autoLoop.setRegistrar(registrarProxyAddr);
  await tx1.wait();

  log.info("Setting registrar on Registry...");
  const registry = new ethers.Contract(
    registryProxyAddr,
    AutoLoopRegistry.abi,
    signer
  );
  const tx2 = await registry.setRegistrar(registrarProxyAddr);
  await tx2.wait();

  // Step 4: Verify deployment
  log.info("Verifying deployment...");
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
  const REGISTRAR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REGISTRAR_ROLE"));

  const checks = [
    {
      name: "AutoLoop admin role",
      ok: await autoLoop.hasRole(DEFAULT_ADMIN_ROLE, deployerAddress),
    },
    {
      name: "Registry admin role",
      ok: await registry.hasRole(DEFAULT_ADMIN_ROLE, deployerAddress),
    },
    {
      name: "AutoLoop registrar role",
      ok: await autoLoop.hasRole(REGISTRAR_ROLE, registrarProxyAddr),
    },
    {
      name: "Registry registrar role",
      ok: await registry.hasRole(REGISTRAR_ROLE, registrarProxyAddr),
    },
  ];

  for (const check of checks) {
    if (!check.ok) {
      throw new Error(`Verification failed: ${check.name}`);
    }
    log.info(`Verified: ${check.name}`);
  }

  // Step 5: Output results
  const result = {
    network: network.name,
    chainId: network.chainId.toString(),
    deployer: deployerAddress,
    proxyAdmin: adminAddress,
    contracts: {
      AUTO_LOOP: autoLoopProxyAddr,
      AUTO_LOOP_REGISTRY: registryProxyAddr,
      AUTO_LOOP_REGISTRAR: registrarProxyAddr,
    },
    implementations: {
      AutoLoop: autoLoopImplAddr,
      AutoLoopRegistry: registryImplAddr,
      AutoLoopRegistrar: registrarImplAddr,
    },
  };

  log.info("Deployment complete!", result);

  // Update deployments.json
  const deploymentsPath = path.resolve(__dirname, "../deployments.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const networkKey = chainId === 1 ? "mainnet" : network.name;
  deployments[networkKey] = result.contracts;
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 4) + "\n");
  log.info(`Updated ${deploymentsPath}`);

  // Also write full deployment receipt
  const receiptPath = path.resolve(
    __dirname,
    `../deployment-receipt-${networkKey}-${Date.now()}.json`
  );
  fs.writeFileSync(receiptPath, JSON.stringify(result, null, 2) + "\n");
  log.info(`Deployment receipt: ${receiptPath}`);
}

main().catch((err) => {
  log.error("Deployment failed", { error: err.message, stack: err.stack });
  process.exit(1);
});
