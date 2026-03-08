#!/usr/bin/env node
/**
 * Gnosis Safe Multisig Setup & Validation
 *
 * Validates that a Safe multisig is properly configured as the proxy admin
 * for AutoLoop contracts. Also provides instructions for creating a new Safe.
 *
 * Usage:
 *   # Validate an existing Safe:
 *   SAFE_ADDRESS=0x... RPC_URL=https://... node scripts/setup-safe.js
 *
 *   # Show setup instructions:
 *   node scripts/setup-safe.js --help
 */

const { ethers } = require("ethers");
require("dotenv").config();

const log = require("./logger");

// Gnosis Safe v1.3.0 ABI (subset for validation)
const SAFE_ABI = [
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function isOwner(address owner) view returns (bool)",
  "function VERSION() view returns (string)",
  "function nonce() view returns (uint256)",
];

// ProxyAdmin ABI (OZ TransparentUpgradeableProxy admin)
const PROXY_ADMIN_ABI = [
  "function owner() view returns (address)",
  "function getProxyAdmin(address proxy) view returns (address)",
  "function getProxyImplementation(address proxy) view returns (address)",
];

async function validateSafe() {
  const safeAddress = process.env.SAFE_ADDRESS;
  const rpcUrl = process.env.RPC_URL;

  if (!safeAddress || !rpcUrl) {
    printHelp();
    return;
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  log.info("Connected", {
    network: network.name,
    chainId: network.chainId.toString(),
  });

  // Check Safe contract exists
  const code = await provider.getCode(safeAddress);
  if (code === "0x") {
    log.error("No contract found at SAFE_ADDRESS", { address: safeAddress });
    process.exit(1);
  }

  const safe = new ethers.Contract(safeAddress, SAFE_ABI, provider);

  try {
    const version = await safe.VERSION();
    const owners = await safe.getOwners();
    const threshold = await safe.getThreshold();
    const nonce = await safe.nonce();

    log.info("Safe validated", {
      address: safeAddress,
      version,
      owners: owners.length,
      threshold: threshold.toString(),
      nonce: nonce.toString(),
    });

    // Security recommendations
    if (threshold < 2n) {
      log.warn("SECURITY: Safe threshold is 1 — recommend at least 2-of-N for mainnet");
    }
    if (owners.length < 3) {
      log.warn("SECURITY: Safe has fewer than 3 owners — recommend at least 3 for mainnet");
    }

    log.info("Owners:");
    for (const owner of owners) {
      log.info(`  ${owner}`);
    }

    // Check if KMS address is an owner (if KMS_KEY_ARN is set)
    if (process.env.KMS_KEY_ARN) {
      try {
        const { GcpKmsSigner } = require("./gcp-kms-signer");
        const kms = new GcpKmsSigner(process.env.KMS_KEY_ARN, provider);
        const kmsAddress = await kms.getAddress();
        const isOwner = await safe.isOwner(kmsAddress);
        log.info("KMS address", {
          address: kmsAddress,
          isSafeOwner: isOwner,
        });
        if (!isOwner) {
          log.warn("KMS address is NOT a Safe owner — add it if you want KMS to propose transactions");
        }
      } catch (err) {
        log.warn("Could not check KMS address", { error: err.message });
      }
    }

    // If deployments exist, verify Safe is the proxy admin
    try {
      const deployments = require("../deployments.json");
      const networkKey =
        network.chainId === 1n ? "mainnet" :
        network.chainId === 11155111n ? "sepolia" : null;

      if (networkKey && deployments[networkKey]?.AUTO_LOOP) {
        log.info("Checking proxy admin configuration...");
        // For OZ TransparentUpgradeableProxy, the admin is stored in a specific storage slot
        // EIP-1967 admin slot: bytes32(uint256(keccak256('eip1967.proxy.admin')) - 1)
        const ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";

        for (const [name, addr] of Object.entries(deployments[networkKey])) {
          if (!addr) continue;
          const adminSlot = await provider.getStorage(addr, ADMIN_SLOT);
          const proxyAdmin = "0x" + adminSlot.slice(26); // last 20 bytes
          const isSafe = proxyAdmin.toLowerCase() === safeAddress.toLowerCase();
          log.info(`${name} proxy admin`, {
            proxyAdmin,
            isSafe: isSafe ? "YES" : "NO",
          });
        }
      }
    } catch {
      // deployments.json not found or no matching network
    }

    log.info("Safe validation complete");
  } catch (err) {
    log.error("Failed to validate Safe", {
      error: err.message,
      hint: "Is SAFE_ADDRESS a Gnosis Safe contract?",
    });
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
AutoLoop Proxy Admin — Gnosis Safe Setup Guide
================================================

1. CREATE A GNOSIS SAFE

   Go to https://app.safe.global and create a new Safe on your target network.

   Recommended configuration for mainnet:
   - At least 3 owners (team members / hardware wallets)
   - Threshold of 2 (2-of-3 minimum)
   - Consider adding the KMS address as an owner for automated proposals

2. ENVIRONMENT VARIABLES

   SAFE_ADDRESS=0x...          # Your Safe multisig address
   PROXY_ADMIN=0x...           # Same as SAFE_ADDRESS (used by deploy script)
   KMS_KEY_ARN=projects/...    # GCP KMS key (optional, for validation)
   RPC_URL=https://...         # RPC endpoint

3. VALIDATE

   SAFE_ADDRESS=0x... RPC_URL=https://... node scripts/setup-safe.js

4. DEPLOY WITH SAFE AS PROXY ADMIN

   # Testnet (Forge):
   PROXY_ADMIN=\${SAFE_ADDRESS} forge script script/Deploy.s.sol --broadcast

   # Mainnet (KMS):
   SIGNER_MODE=kms KMS_KEY_ARN=projects/... PROXY_ADMIN=\${SAFE_ADDRESS} \\
     RPC_URL=https://... ETH_CHAIN_ID=1 node scripts/deploy-mainnet.js

5. TRANSFER ADMIN ROLE (Post-deploy)

   After deployment, transfer the DEFAULT_ADMIN_ROLE on AutoLoop and Registry
   to the Safe. This makes contract admin operations require multisig approval.

   The deployer (KMS or EOA) retains admin initially for wiring up roles,
   then should renounce it after transferring to the Safe.
`);
}

if (process.argv.includes("--help")) {
  printHelp();
} else {
  validateSafe().catch((err) => {
    log.error("Fatal error", { error: err.message });
    process.exit(1);
  });
}
