/**
 * register-vrf-keys.js
 *
 * Registers each worker's ECVRF public key on every target VRF-compatible contract.
 * Must be run by an address that holds DEFAULT_ADMIN_ROLE on the target contracts
 * (typically the deployer), OR each worker can run it themselves (controller == sender).
 *
 * Usage:
 *   NETWORK=sepolia node scripts/register-vrf-keys.js
 *
 * The script reads DEPLOYER_KEY (or falls back to PRIVATE_KEY), WORKER_1_PRIVATE_KEY,
 * WORKER_2_PRIVATE_KEY, WORKER_3_PRIVATE_KEY from the environment.
 *
 * Target contracts default to the 3 VRF agent contracts. Override with env vars:
 *   VRF_CONTRACTS="0xAddr1,0xAddr2,..."
 */

const { ethers } = require("ethers");
const { secp256k1 } = require("@noble/curves/secp256k1");
require("dotenv").config();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const NETWORK = process.env.NETWORK || "sepolia";

// RPC per network — env var takes priority, then hardcoded fallbacks
const RPC_BY_NETWORK = {
  sepolia:            process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
  mainnet:            process.env.MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com",
  "base-sepolia":     process.env.BASE_SEPOLIA_RPC_URL,
  "arbitrum-sepolia": process.env.ARBITRUM_SEPOLIA_RPC_URL,
  anvil:             "http://127.0.0.1:8545",
};

// VRF contracts per network — all contracts extending AutoLoopVRFCompatible
// Deployed 2026-04-12 with RANDAO mixing (v2)
const VRF_CONTRACTS_BY_NETWORK = {
  sepolia: [
    // ── Games ──────────────────────────────────────────────────────────
    "0xF5A9fEeaE9A164CdA46ed4122ACdBD719cADcf2A", // CrumbleCore
    "0xABE12360ecDB00d9aBcBeE8c182208BA2218830d", // GladiatorArena
    "0x1Be58fa9dc99536E5720fcAB8dc475Fc270fa462", // MechBrawl
    "0xD0DCDf4E7B710dDAdafCC661b416262e7278F902", // SorcererDuel
    "0x568384735E3fa9548fc3CFA555961350552C160C", // KaijuLeague
    "0x3f4fa22b960e31dEb45230FcC1713f13e5ba712e", // VoidHarvester
    "0xfff5652F113FF2291DABabF6611b0322ed3b13c1", // OracleRun
    // ── Agents ─────────────────────────────────────────────────────────
    "0xd3a3c4Fa3E70E9C4F034dA75546A1bc5061d61b5", // AirdropDistributor
    "0x27A737DE802e14837C865eE336Ec09189F2Ea6A4", // NFTReveal
    "0x25924dDbe1289a8cE86D9Cc5116B1C906032Ec23", // LotterySweepstakes
    "0x164e385a23b05710e180aC795E1893D56FB3c7Ac", // MatchmakingEngine
    "0xA3c9ED3e00F65d9342DdE6409Af27Bc7488753F5", // BreedingMutationEngine
    "0x7bb6d1D710210e232F41620b084f46719E3c0DB8", // TournamentBracket
  ],
  // Deployed 2026-04-13 (same deterministic addrs as Arbitrum Sepolia)
  "base-sepolia": [
    // ── Games ──────────────────────────────────────────────────────────
    "0x475609997112897E492311A0A27D1f95F808921A", // CrumbleCore
    "0xA44616d7fa55052422AD835351C91E517401884a", // GladiatorArena
    "0x057d2BABEE342741507181707056B7BE43371458", // MechBrawl
    "0xb8a3AfF32acf4B7959F9dB36Cfb2daaEAC440Fee", // SorcererDuel
    "0x3003a031Cc1540203a7aA8B6D99efA6144D46db8", // KaijuLeague
    "0x331FdB59BF463E8d3BaE568be6692d48B56F7631", // VoidHarvester
    "0xEd525A0dE90141e10B3B28053C59b1846550221d", // OracleRun
    // ── Agents ─────────────────────────────────────────────────────────
    "0x45E59F04d314D848df6bA922b8d6Af669205E7b0", // AirdropDistributor
    "0x9876Bd9f32F9fb88e27c9bEDA4Fb072EC872AD79", // NFTReveal
    "0x5bf0Fa224A80Fec9dd464dBe047E8eA710d03DeF", // LotterySweepstakes
    "0x5614878609Ecbe7584d25A6D8327C0Da47C2f8c9", // MatchmakingEngine
    "0x872196467eec7BC3fD54ef75834A352511e43f38", // BreedingMutationEngine
    "0x4df2709b6a193887a3Eb3975D8c74BE24034ea13", // TournamentBracket
  ],
  "arbitrum-sepolia": [
    // ── Games ──────────────────────────────────────────────────────────
    "0x475609997112897E492311A0A27D1f95F808921A", // CrumbleCore
    "0xA44616d7fa55052422AD835351C91E517401884a", // GladiatorArena
    "0x057d2BABEE342741507181707056B7BE43371458", // MechBrawl
    "0xb8a3AfF32acf4B7959F9dB36Cfb2daaEAC440Fee", // SorcererDuel
    "0x3003a031Cc1540203a7aA8B6D99efA6144D46db8", // KaijuLeague
    "0x331FdB59BF463E8d3BaE568be6692d48B56F7631", // VoidHarvester
    "0xEd525A0dE90141e10B3B28053C59b1846550221d", // OracleRun
    // ── Agents ─────────────────────────────────────────────────────────
    "0x45E59F04d314D848df6bA922b8d6Af669205E7b0", // AirdropDistributor
    "0x9876Bd9f32F9fb88e27c9bEDA4Fb072EC872AD79", // NFTReveal
    "0x5bf0Fa224A80Fec9dd464dBe047E8eA710d03DeF", // LotterySweepstakes
    "0x5614878609Ecbe7584d25A6D8327C0Da47C2f8c9", // MatchmakingEngine
    "0x872196467eec7BC3fD54ef75834A352511e43f38", // BreedingMutationEngine
    "0x4df2709b6a193887a3Eb3975D8c74BE24034ea13", // TournamentBracket
  ],
};

// Fall back to Sepolia list for unknown networks (anvil, mainnet)
const DEFAULT_VRF_CONTRACTS = VRF_CONTRACTS_BY_NETWORK[NETWORK] || VRF_CONTRACTS_BY_NETWORK.sepolia;

// Minimal ABI — only what we need
const VRF_ABI = [
  "function registerControllerKey(address controller, uint256 pkX, uint256 pkY) external",
  "function controllerKeyRegistered(address controller) view returns (bool)",
  "function controllerPublicKeys(address controller) view returns (uint256[2])",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the uncompressed secp256k1 public key (x, y) from a hex private key.
 * Returns { address, pkX, pkY } — pkX and pkY are BigInt.
 */
function derivePublicKey(privateKeyHex) {
  const normalized = privateKeyHex.startsWith("0x")
    ? privateKeyHex.slice(2)
    : privateKeyHex;
  const privKeyBigInt = BigInt("0x" + normalized);
  const point = secp256k1.ProjectivePoint.BASE.multiply(privKeyBigInt);
  return { pkX: point.x, pkY: point.y };
}

/**
 * Verify the public key is on the secp256k1 curve (basic sanity check).
 */
function validatePublicKey(pkX, pkY) {
  try {
    secp256k1.ProjectivePoint.fromAffine({ x: pkX, y: pkY });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const rpcUrl = RPC_BY_NETWORK[NETWORK];
  if (!rpcUrl) throw new Error(`Unknown network: ${NETWORK}`);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const chainId  = (await provider.getNetwork()).chainId;
  console.log(`Network: ${NETWORK} (chainId ${chainId})`);

  // Admin/deployer wallet — pays gas for all registrations
  const adminKey = process.env.DEPLOYER_KEY || process.env.PRIVATE_KEY;
  if (!adminKey) throw new Error("Set DEPLOYER_KEY or PRIVATE_KEY in environment");
  const adminWallet = new ethers.Wallet(adminKey, provider);
  console.log(`Admin wallet: ${adminWallet.address}`);

  // Worker private keys → derive (address, pkX, pkY)
  const workerKeys = [
    process.env.WORKER_1_PRIVATE_KEY,
    process.env.WORKER_2_PRIVATE_KEY,
    process.env.WORKER_3_PRIVATE_KEY,
  ].filter(Boolean);

  if (workerKeys.length === 0) {
    // Fall back to the admin key itself (single-worker mode)
    console.warn("No WORKER_N_PRIVATE_KEY env vars found — registering admin key as controller.");
    workerKeys.push(adminKey);
  }

  const workers = workerKeys.map((pk) => {
    const wallet = new ethers.Wallet(pk);
    const { pkX, pkY } = derivePublicKey(pk);
    if (!validatePublicKey(pkX, pkY)) {
      throw new Error(`Invalid secp256k1 public key derived for address ${wallet.address}`);
    }
    return { address: wallet.address, pkX, pkY };
  });

  console.log(`\nWorkers to register (${workers.length}):`);
  workers.forEach((w, i) => {
    console.log(`  Worker ${i + 1}: ${w.address}`);
    console.log(`    pkX: ${w.pkX.toString(16).slice(0, 16)}...`);
    console.log(`    pkY: ${w.pkY.toString(16).slice(0, 16)}...`);
  });

  // Target VRF contracts
  const rawContracts = process.env.VRF_CONTRACTS
    ? process.env.VRF_CONTRACTS.split(",").map((s) => s.trim())
    : DEFAULT_VRF_CONTRACTS;

  console.log(`\nTarget contracts (${rawContracts.length}):`);
  rawContracts.forEach((addr) => console.log(`  ${addr}`));

  // Register each worker on each contract
  let successCount = 0;
  let skipCount    = 0;
  let errorCount   = 0;

  for (const contractAddr of rawContracts) {
    console.log(`\n── ${contractAddr} ──`);
    const contract = new ethers.Contract(contractAddr, VRF_ABI, adminWallet);

    for (const worker of workers) {
      const label = `  ${worker.address}`;

      // Check if already registered
      try {
        const already = await contract.controllerKeyRegistered(worker.address);
        if (already) {
          const existing = await contract.controllerPublicKeys(worker.address);
          const xMatch = existing[0] === worker.pkX;
          const yMatch = existing[1] === worker.pkY;
          if (xMatch && yMatch) {
            console.log(`${label} — already registered, same key. Skipping.`);
            skipCount++;
            continue;
          } else {
            console.log(`${label} — registered but different key, overwriting...`);
          }
        }
      } catch (err) {
        console.warn(`${label} — could not read controllerKeyRegistered: ${err.message}`);
      }

      // Register
      try {
        console.log(`${label} — registering...`);
        const tx = await contract.registerControllerKey(
          worker.address,
          worker.pkX,
          worker.pkY,
        );
        const receipt = await tx.wait();
        console.log(`${label} — registered in tx ${receipt.hash} (block ${receipt.blockNumber})`);
        successCount++;
      } catch (err) {
        console.error(`${label} — FAILED: ${err.message}`);
        errorCount++;
      }
    }
  }

  console.log(`\n── Summary ──`);
  console.log(`  Registered: ${successCount}`);
  console.log(`  Skipped (already current): ${skipCount}`);
  console.log(`  Errors: ${errorCount}`);

  if (errorCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
