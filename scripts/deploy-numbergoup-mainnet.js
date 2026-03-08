#!/usr/bin/env node
/**
 * Deploy NumberGoUp to Ethereum mainnet via GCP KMS
 *
 * Steps:
 *   1. Deploy NumberGoUp(30) contract
 *   2. Register with AutoLoop Registrar (registerAutoLoopFor)
 *   3. Fund with initial deposit
 *
 * Usage:
 *   # Dry run:
 *   node scripts/deploy-numbergoup-mainnet.js --dry-run
 *
 *   # Live:
 *   node scripts/deploy-numbergoup-mainnet.js
 *
 *   # Custom deposit (default 0.001 ETH):
 *   node scripts/deploy-numbergoup-mainnet.js --deposit 0.002
 */

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const log = require("./logger");
const { GcpKmsSigner } = require("./gcp-kms-signer");

// ── Config ──

const KMS_KEY =
  "projects/racerverse-custody/locations/us-east1/keyRings/ethereum-keys/cryptoKeys/autoloop-deployer/cryptoKeyVersions/1";

const RPC_URL = process.env.RPC_URL || "https://ethereum-rpc.publicnode.com";

// Mainnet AutoLoop contracts
const REGISTRAR_ADDRESS = "0x202d73Ac243907A6e81B5FF55E4c316567e4fF80";

// NumberGoUp constructor arg
const UPDATE_INTERVAL = 30; // seconds

// Max gas for progressLoop — NumberGoUp uses ~60k, set 150k for safety
const MAX_GAS_PER_UPDATE = 150_000;

// ── Parse args ──

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const depositIdx = args.indexOf("--deposit");
const depositAmount = depositIdx >= 0 ? args[depositIdx + 1] : "0.001";

// ── Load forge artifact ──

function loadNumberGoUp() {
  const artifactPath = path.resolve(
    __dirname,
    "../../autoloop/out/NumberGoUp.sol/NumberGoUp.json"
  );

  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      `Forge artifact not found: ${artifactPath}\nRun 'forge build' in autoloop/ first.`
    );
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode?.object || artifact.bytecode,
  };
}

// ── Main ──

async function main() {
  log.info("=== Deploy NumberGoUp to Mainnet ===", { dryRun, depositAmount });

  const provider = new ethers.JsonRpcProvider(RPC_URL, 1);

  // Verify mainnet
  const network = await provider.getNetwork();
  if (network.chainId !== 1n) {
    throw new Error(`Expected mainnet (chain ID 1), got ${network.chainId}`);
  }

  // Init KMS signer
  const signer = new GcpKmsSigner(KMS_KEY, provider);
  const deployerAddress = await signer.getAddress();
  const balance = await provider.getBalance(deployerAddress);

  log.info("Deployer", {
    address: deployerAddress,
    balance: `${ethers.formatEther(balance)} ETH`,
  });

  if (balance < ethers.parseEther("0.002")) {
    throw new Error(
      `Deployer balance too low: ${ethers.formatEther(balance)} ETH`
    );
  }

  // Load artifact
  const { abi, bytecode } = loadNumberGoUp();
  log.info("NumberGoUp artifact loaded", {
    abiLength: abi.length,
    bytecodeLength: bytecode.length,
  });

  if (dryRun) {
    log.info("DRY RUN — estimating deployment gas...");
    const factory = new ethers.ContractFactory(abi, bytecode, signer);
    const deployTx = await factory.getDeployTransaction(UPDATE_INTERVAL);
    const gasEstimate = await provider.estimateGas({
      ...deployTx,
      from: deployerAddress,
    });
    const feeData = await provider.getFeeData();
    const estimatedCost =
      gasEstimate * (feeData.maxFeePerGas || feeData.gasPrice || 0n);

    log.info("Estimated deployment", {
      gas: gasEstimate.toString(),
      estimatedCostEth: ethers.formatEther(estimatedCost),
      depositAmount: `${depositAmount} ETH`,
      totalEstimated: ethers.formatEther(
        estimatedCost + ethers.parseEther(depositAmount)
      ),
    });
    log.info("Remove --dry-run to deploy.");
    return;
  }

  // Step 1: Deploy NumberGoUp
  log.info("Step 1: Deploying NumberGoUp...", {
    interval: UPDATE_INTERVAL,
  });

  const factory = new ethers.ContractFactory(abi, bytecode, signer);
  const contract = await factory.deploy(UPDATE_INTERVAL);
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();

  log.info("NumberGoUp deployed!", { address: contractAddress });

  // Step 2: Register with AutoLoop Registrar
  log.info("Step 2: Registering with AutoLoop Registrar...", {
    registrar: REGISTRAR_ADDRESS,
    maxGas: MAX_GAS_PER_UPDATE,
  });

  const registrarAbi = [
    "function registerAutoLoopFor(address autoLoopCompatibleContract, uint256 maxGasPerUpdate) external payable returns (bool success)",
    "function deposit(address registeredContract) external payable",
  ];

  const registrar = new ethers.Contract(REGISTRAR_ADDRESS, registrarAbi, signer);

  // Register with initial deposit
  const depositWei = ethers.parseEther(depositAmount);
  const regTx = await registrar.registerAutoLoopFor(
    contractAddress,
    MAX_GAS_PER_UPDATE,
    { value: depositWei }
  );
  const regReceipt = await regTx.wait();

  log.info("Registered + funded!", {
    txHash: regReceipt.hash,
    deposit: `${depositAmount} ETH`,
    gasUsed: regReceipt.gasUsed.toString(),
  });

  // Final balance
  const finalBalance = await provider.getBalance(deployerAddress);
  log.info("Deployment complete!", {
    numberGoUp: contractAddress,
    deployerBalance: `${ethers.formatEther(finalBalance)} ETH`,
  });

  // Output for env vars
  log.info("");
  log.info("=== Set these environment variables ===");
  console.log(`NEXT_PUBLIC_DEMO_CONTRACT=${contractAddress}`);
  console.log(`NEXT_PUBLIC_NETWORK=mainnet`);
}

main().catch((err) => {
  log.error("Deployment failed", { error: err.message, stack: err.stack });
  process.exit(1);
});
