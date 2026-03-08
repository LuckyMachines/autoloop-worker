#!/usr/bin/env node
/**
 * AutoLoop KMS Setup for Mainnet
 *
 * Creates a new GCP Cloud KMS key for AutoLoop in the same project/keyring
 * as the racerverse-coordinator, then funds it from the racerverse KMS wallet.
 *
 * Prerequisites:
 *   1. gcloud CLI authenticated: gcloud auth application-default login
 *   2. IAM permissions on racerverse-custody project:
 *      - cloudkms.cryptoKeys.create (to create the new key)
 *      - cloudkms.cryptoKeyVersions.useToSign (on both keys)
 *      - cloudkms.cryptoKeyVersions.viewPublicKey (on both keys)
 *
 * Usage:
 *   # Step 1: Create key + derive address (no ETH needed)
 *   node scripts/setup-kms-mainnet.js --create-key
 *
 *   # Step 2: Fund from racerverse wallet (requires mainnet ETH in racerverse wallet)
 *   node scripts/setup-kms-mainnet.js --fund --amount 0.005
 *
 *   # Step 3: Verify setup
 *   node scripts/setup-kms-mainnet.js --verify
 *
 *   # All steps at once:
 *   node scripts/setup-kms-mainnet.js --create-key --fund --amount 0.005
 *
 *   # Dry run (don't actually create key or send ETH):
 *   node scripts/setup-kms-mainnet.js --create-key --fund --amount 0.005 --dry-run
 */

const { ethers } = require("ethers");
const { GcpKmsSigner } = require("./gcp-kms-signer");
const log = require("./logger");

// ── Configuration ──

const GCP_PROJECT = "racerverse-custody";
const GCP_LOCATION = "us-east1";
const GCP_KEYRING = "ethereum-keys";
const AUTOLOOP_KEY_NAME = "autoloop-deployer";

// Racerverse existing KMS key (source of funds)
const RACERVERSE_KMS_KEY =
  `projects/${GCP_PROJECT}/locations/${GCP_LOCATION}/keyRings/${GCP_KEYRING}/cryptoKeys/mint-signer/cryptoKeyVersions/1`;
const RACERVERSE_EXPECTED_ADDRESS = "0x1d5ddb1431c0d15e5e211b0c5810177d38e4a971";

// AutoLoop new KMS key (will be created)
const AUTOLOOP_KMS_KEY =
  `projects/${GCP_PROJECT}/locations/${GCP_LOCATION}/keyRings/${GCP_KEYRING}/cryptoKeys/${AUTOLOOP_KEY_NAME}/cryptoKeyVersions/1`;

// Mainnet RPC
const RPC_URL = process.env.RPC_URL || "https://ethereum-rpc.publicnode.com";

// ── Parse args ──

const args = process.argv.slice(2);
const shouldCreateKey = args.includes("--create-key");
const shouldFund = args.includes("--fund");
const shouldVerify = args.includes("--verify") || (!shouldCreateKey && !shouldFund);
const dryRun = args.includes("--dry-run");
const amountIdx = args.indexOf("--amount");
const fundAmount = amountIdx >= 0 ? args[amountIdx + 1] : "0.002";

// ── Step 1: Create KMS Key ──

async function createKey() {
  log.info("=== Step 1: Create AutoLoop KMS Key ===");

  const { KeyManagementServiceClient } = require("@google-cloud/kms");
  const kmsClient = new KeyManagementServiceClient();

  const keyRingPath = kmsClient.keyRingPath(GCP_PROJECT, GCP_LOCATION, GCP_KEYRING);

  // Check if key already exists
  const cryptoKeyPath = kmsClient.cryptoKeyPath(
    GCP_PROJECT, GCP_LOCATION, GCP_KEYRING, AUTOLOOP_KEY_NAME
  );

  try {
    const [existingKey] = await kmsClient.getCryptoKey({ name: cryptoKeyPath });
    log.info("Key already exists", {
      name: existingKey.name,
      purpose: existingKey.purpose,
    });

    // Get the address from the existing key
    const [publicKey] = await kmsClient.getPublicKey({ name: AUTOLOOP_KMS_KEY });
    const address = deriveAddress(publicKey.pem);
    log.info("Existing AutoLoop KMS address", { address });
    return address;
  } catch (err) {
    if (err.code !== 5) throw err; // 5 = NOT_FOUND, anything else is a real error
  }

  log.info("Creating new KMS key", {
    project: GCP_PROJECT,
    location: GCP_LOCATION,
    keyRing: GCP_KEYRING,
    keyName: AUTOLOOP_KEY_NAME,
    algorithm: "EC_SIGN_SECP256K1_SHA256",
    dryRun,
  });

  if (dryRun) {
    log.info("DRY RUN — would create key at:", { path: cryptoKeyPath });
    return null;
  }

  // Create the crypto key
  const [key] = await kmsClient.createCryptoKey({
    parent: keyRingPath,
    cryptoKeyId: AUTOLOOP_KEY_NAME,
    cryptoKey: {
      purpose: "ASYMMETRIC_SIGN",
      versionTemplate: {
        algorithm: "EC_SIGN_SECP256K1_SHA256",
        protectionLevel: "HSM",
      },
      // Labels for organization
      labels: {
        project: "autoloop",
        purpose: "deployer",
        network: "mainnet",
      },
    },
  });

  log.info("KMS key created", { name: key.name });

  // Wait a moment for the key version to become available
  log.info("Waiting for key version to become ENABLED...");
  let attempts = 0;
  while (attempts < 30) {
    try {
      const [publicKey] = await kmsClient.getPublicKey({ name: AUTOLOOP_KMS_KEY });
      if (publicKey.pem) {
        const address = deriveAddress(publicKey.pem);
        log.info("AutoLoop KMS address derived", { address });
        return address;
      }
    } catch {
      // Key version not ready yet
    }
    await new Promise((r) => setTimeout(r, 2000));
    attempts++;
  }

  throw new Error("Timed out waiting for key version to become available");
}

// ── Step 2: Fund from Racerverse ──

async function fundFromRacerverse(autoloopAddress) {
  log.info("=== Step 2: Fund AutoLoop KMS Wallet ===");

  const provider = new ethers.JsonRpcProvider(RPC_URL, 1);
  const network = await provider.getNetwork();

  if (network.chainId !== 1n) {
    throw new Error(`Expected mainnet (chain ID 1), got ${network.chainId}`);
  }

  // Connect racerverse KMS signer
  const racerverseSigner = new GcpKmsSigner(RACERVERSE_KMS_KEY, provider);
  const racerverseAddress = await racerverseSigner.getAddress();

  if (racerverseAddress.toLowerCase() !== RACERVERSE_EXPECTED_ADDRESS.toLowerCase()) {
    throw new Error(
      `Racerverse KMS address mismatch: got ${racerverseAddress}, expected ${RACERVERSE_EXPECTED_ADDRESS}`
    );
  }

  // Get balances
  const racerverseBalance = await provider.getBalance(racerverseAddress);
  const autoloopBalance = await provider.getBalance(autoloopAddress);

  log.info("Balances", {
    racerverse: `${ethers.formatEther(racerverseBalance)} ETH (${racerverseAddress})`,
    autoloop: `${ethers.formatEther(autoloopBalance)} ETH (${autoloopAddress})`,
    fundAmount: `${fundAmount} ETH`,
  });

  const sendWei = ethers.parseEther(fundAmount);

  if (racerverseBalance < sendWei) {
    throw new Error(
      `Racerverse wallet has insufficient balance: ${ethers.formatEther(racerverseBalance)} ETH < ${fundAmount} ETH`
    );
  }

  if (dryRun) {
    const feeData = await provider.getFeeData();
    const gasCost = 21000n * (feeData.maxFeePerGas || 0n);
    log.info("DRY RUN — would send", {
      from: racerverseAddress,
      to: autoloopAddress,
      amount: `${fundAmount} ETH`,
      estimatedGasCost: `${ethers.formatEther(gasCost)} ETH`,
    });
    return;
  }

  log.info("Sending ETH from racerverse KMS to autoloop KMS...");

  const feeData = await provider.getFeeData();
  const tx = await racerverseSigner.sendTransaction({
    to: autoloopAddress,
    value: sendWei,
    type: 2, // EIP-1559
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    maxFeePerGas: feeData.maxFeePerGas,
  });

  log.info("Transaction sent", { hash: tx.hash });
  log.info("Waiting for confirmation...");

  const receipt = await tx.wait(1);
  log.info("Confirmed", {
    block: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
  });

  // Verify new balance
  const newBalance = await provider.getBalance(autoloopAddress);
  log.info("AutoLoop wallet funded", {
    address: autoloopAddress,
    balance: `${ethers.formatEther(newBalance)} ETH`,
  });
}

// ── Step 3: Verify ──

async function verify() {
  log.info("=== Step 3: Verify AutoLoop KMS Setup ===");

  const provider = new ethers.JsonRpcProvider(RPC_URL, 1);

  // Verify AutoLoop KMS key
  let autoloopAddress;
  try {
    const autoloopSigner = new GcpKmsSigner(AUTOLOOP_KMS_KEY, provider);
    autoloopAddress = await autoloopSigner.getAddress();
    log.info("AutoLoop KMS key OK", { address: autoloopAddress });
  } catch (err) {
    log.error("AutoLoop KMS key not found or inaccessible", {
      error: err.message,
      keyPath: AUTOLOOP_KMS_KEY,
      hint: "Run with --create-key first",
    });
    return;
  }

  // Check balance
  const balance = await provider.getBalance(autoloopAddress);
  log.info("AutoLoop wallet balance", {
    address: autoloopAddress,
    balance: `${ethers.formatEther(balance)} ETH`,
  });

  if (balance < ethers.parseEther("0.001")) {
    log.warn("Balance is low — run with --fund to transfer ETH from racerverse wallet");
  } else {
    log.info("Balance sufficient for deployment");
  }

  // Output the env vars needed
  log.info("");
  log.info("=== Environment Variables for Mainnet Deploy ===");
  log.info("");
  console.log(`SIGNER_MODE=kms`);
  console.log(`KMS_KEY_ARN=${AUTOLOOP_KMS_KEY}`);
  console.log(`RPC_URL=${RPC_URL}`);
  console.log(`ETH_CHAIN_ID=1`);
  console.log(`NETWORK=mainnet`);
  console.log(`# PROXY_ADMIN=<your-gnosis-safe-address>`);
  log.info("");
  log.info("Deploy command:");
  console.log(`  SIGNER_MODE=kms KMS_KEY_ARN=${AUTOLOOP_KMS_KEY} \\`);
  console.log(`    RPC_URL=${RPC_URL} ETH_CHAIN_ID=1 \\`);
  console.log(`    PROXY_ADMIN=<safe-address> \\`);
  console.log(`    node scripts/deploy-mainnet.js`);
}

// ── Helpers ──

function deriveAddress(pem) {
  const { parsePublicKeyFromPem } = require("./gcp-kms-signer");
  const ecPoint = parsePublicKeyFromPem(pem);
  const hash = ethers.keccak256(ecPoint.slice(1));
  return "0x" + hash.slice(-40);
}

// ── Main ──

async function main() {
  log.info("AutoLoop KMS Mainnet Setup", {
    gcpProject: GCP_PROJECT,
    keyRing: GCP_KEYRING,
    autoloopKey: AUTOLOOP_KEY_NAME,
    dryRun,
  });

  let autoloopAddress = null;

  if (shouldCreateKey) {
    autoloopAddress = await createKey();
  }

  if (shouldFund) {
    if (!autoloopAddress) {
      // Get address from existing key
      try {
        const signer = new GcpKmsSigner(AUTOLOOP_KMS_KEY, new ethers.JsonRpcProvider(RPC_URL, 1));
        autoloopAddress = await signer.getAddress();
      } catch (err) {
        log.error("Cannot fund — AutoLoop KMS key not found. Run --create-key first (without --dry-run).", { error: err.message });
        process.exit(1);
      }
    }
    await fundFromRacerverse(autoloopAddress);
  }

  if (shouldVerify) {
    await verify();
  }

  log.info("Done.");
}

main().catch((err) => {
  log.error("Setup failed", { error: err.message, stack: err.stack });
  process.exit(1);
});
