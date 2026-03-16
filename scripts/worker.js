const { ethers } = require("ethers");
const { secp256k1 } = require("@noble/curves/secp256k1");
const { sha256 } = require("@noble/hashes/sha256");
// Config file is optional when NETWORK env var is set (e.g. Railway deployments)
let config;
try {
  config = require("../controller.config.json");
} catch {
  config = { network: process.env.NETWORK || "anvil", allowList: [], blockList: [] };
}

const autoLoopABI = require("../abi/AutoLoop.json");
const autoLoopRegistryABI = require("../abi/AutoLoopRegistry.json");
const autoLoopCompatibleInterfaceABI = require("../abi/AutoLoopCompatibleInterface.json");
const deployments = require("../deployments.json");
const { resolveRuntime } = require("./runtime-config");
const { startHealthServer, updateHealth, startTime } = require("./health");
const log = require("./logger");
const { sendAlert } = require("./alerter");
require("dotenv").config();

// KMS signer — loaded lazily only when SIGNER_MODE=kms
let GcpKmsSigner;
function getGcpKmsSigner() {
  if (!GcpKmsSigner) {
    GcpKmsSigner = require("./gcp-kms-signer").GcpKmsSigner;
  }
  return GcpKmsSigner;
}

// VRF interface ID: bytes4(keccak256("AutoLoopVRFCompatible"))
const VRF_INTERFACE_ID = ethers.id("AutoLoopVRFCompatible").slice(0, 10);

// Hybrid VRF interface ID: bytes4(keccak256("AutoLoopHybridVRFCompatible"))
const HYBRID_VRF_INTERFACE_ID = ethers.id("AutoLoopHybridVRFCompatible").slice(0, 10);

// secp256k1 curve order
const CURVE_ORDER = secp256k1.CURVE.n;
// secp256k1 field prime
const FIELD_PRIME = secp256k1.CURVE.p;

// Cache for VRF mode detection: "none" | "full" | "hybrid"
const vrfModeCache = new Map();

// Legacy cache kept for backward compat with isVRFCompatible
const vrfCompatibleCache = new Map();

let worker;
let queue;
let runtime;
let isShuttingDown = false;
let isProcessing = false; // Guard against overlapping block handlers
let activeUpdateCount = 0;

// This is not necessarily called every block. This is how many blocks to wait after
// queue of addresses needing updates has been processed.
const DEFAULT_PING_INTERVAL = 3; // # blocks to wait before checking (~36s on mainnet)
const DEFAULT_EXPIRATION = 0; // # updates to wait before shutting down, 0 = never
const QUEUE_REFRESH_INTERVAL = 50; // re-download queue every N blocks to pick up new registrations

// NonceManager handles nonce tracking automatically

// ---------------------------------------------------------------
//  ECVRF Proof Generation Utilities
// ---------------------------------------------------------------

/**
 * Check if a contract supports the VRF interface via ERC165.
 * Results are cached to avoid repeated on-chain calls.
 */
async function isVRFCompatible(contractAddress, signerOrProvider) {
  if (vrfCompatibleCache.has(contractAddress)) {
    return vrfCompatibleCache.get(contractAddress);
  }
  try {
    const contract = new ethers.Contract(
      contractAddress,
      ["function supportsInterface(bytes4) view returns (bool)"],
      signerOrProvider
    );
    const result = await contract.supportsInterface(VRF_INTERFACE_ID);
    vrfCompatibleCache.set(contractAddress, result);
    return result;
  } catch {
    vrfCompatibleCache.set(contractAddress, false);
    return false;
  }
}

/**
 * Determine the VRF mode for a contract: "none", "full", or "hybrid".
 * Hybrid contracts also pass the full VRF check (they extend it), so check hybrid first.
 * Results are cached to avoid repeated on-chain calls.
 */
async function getVRFMode(contractAddress, signerOrProvider) {
  if (vrfModeCache.has(contractAddress)) {
    return vrfModeCache.get(contractAddress);
  }
  try {
    const contract = new ethers.Contract(
      contractAddress,
      ["function supportsInterface(bytes4) view returns (bool)"],
      signerOrProvider
    );
    // Check hybrid first (it also passes the full VRF check since it extends it)
    const isHybrid = await contract.supportsInterface(HYBRID_VRF_INTERFACE_ID);
    if (isHybrid) {
      vrfModeCache.set(contractAddress, "hybrid");
      vrfCompatibleCache.set(contractAddress, true);
      return "hybrid";
    }
    const isFullVRF = await contract.supportsInterface(VRF_INTERFACE_ID);
    if (isFullVRF) {
      vrfModeCache.set(contractAddress, "full");
      vrfCompatibleCache.set(contractAddress, true);
      return "full";
    }
    vrfModeCache.set(contractAddress, "none");
    vrfCompatibleCache.set(contractAddress, false);
    return "none";
  } catch {
    vrfModeCache.set(contractAddress, "none");
    vrfCompatibleCache.set(contractAddress, false);
    return "none";
  }
}

/**
 * Hash-to-curve using try-and-increment (TAI) — matches VRFVerifier.sol.
 * Returns a secp256k1 ProjectivePoint.
 */
function hashToCurve(publicKeyBytes, message) {
  const pkPoint = secp256k1.ProjectivePoint.fromHex(publicKeyBytes);
  const pkXBytes = bigintToBytes32(pkPoint.x);
  const pkYBytes = bigintToBytes32(pkPoint.y);

  for (let ctr = 0; ctr < 256; ctr++) {
    // keccak256(0xFE || 0x01 || pkX || pkY || message || ctr)
    const payload = ethers.concat([
      new Uint8Array([0xfe, 0x01]),
      pkXBytes,
      pkYBytes,
      message,
      new Uint8Array([ctr])
    ]);
    const hash = ethers.keccak256(payload);
    const x = BigInt(hash);

    if (x >= FIELD_PRIME) continue;

    try {
      // Try to lift x to a point on the curve (even y)
      const point = liftX(x);
      if (point) return point;
    } catch {
      continue;
    }
  }
  throw new Error("hashToCurve: failed to find point after 256 attempts");
}

/**
 * Lift an x-coordinate to a secp256k1 point with even y.
 */
function liftX(x) {
  const p = FIELD_PRIME;
  // y^2 = x^3 + 7 mod p
  const y2 = (((x * x) % p) * x + 7n) % p;
  // sqrt via (p+1)/4 exponentiation
  let y = modPow(y2, (p + 1n) / 4n, p);
  if ((y * y) % p !== y2) return null;
  // Use even y
  if (y % 2n !== 0n) y = p - y;
  return secp256k1.ProjectivePoint.fromAffine({ x, y });
}

/**
 * Modular exponentiation: base^exp mod mod
 */
function modPow(base, exp, mod) {
  let result = 1n;
  base = ((base % mod) + mod) % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) result = (result * base) % mod;
    exp = exp / 2n;
    base = (base * base) % mod;
  }
  return result;
}

/**
 * Convert a BigInt to a 32-byte Uint8Array (big-endian).
 */
function bigintToBytes32(n) {
  const hex = n.toString(16).padStart(64, "0");
  return ethers.getBytes("0x" + hex);
}

/**
 * Modular inverse using extended Euclidean algorithm.
 */
function modInverse(a, mod) {
  a = ((a % mod) + mod) % mod;
  let [old_r, r] = [a, mod];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  return ((old_s % mod) + mod) % mod;
}

/**
 * Compute the Fiat-Shamir challenge hash, matching VRFVerifier.sol's _hashPoints.
 * c = keccak256(0xFE || 0x02 || H || PK || Gamma || U || V) mod n
 */
function hashPoints(H, PK, Gamma, U, V) {
  const payload = ethers.concat([
    new Uint8Array([0xfe, 0x02]),
    bigintToBytes32(H.x), bigintToBytes32(H.y),
    bigintToBytes32(PK.x), bigintToBytes32(PK.y),
    bigintToBytes32(Gamma.x), bigintToBytes32(Gamma.y),
    bigintToBytes32(U.x), bigintToBytes32(U.y),
    bigintToBytes32(V.x), bigintToBytes32(V.y)
  ]);
  const hash = ethers.keccak256(payload);
  return BigInt(hash) % CURVE_ORDER;
}

/**
 * Generate a full ECVRF proof for a given seed using the controller's private key.
 * Returns { proof, uPoint, vComponents } ready for ABI encoding.
 */
function generateVRFProof(privateKeyHex, seed) {
  // Derive public key
  const privKeyBytes = ethers.getBytes(privateKeyHex);
  const pubPoint = secp256k1.ProjectivePoint.BASE.multiply(
    BigInt("0x" + Buffer.from(privKeyBytes).toString("hex"))
  );
  const publicKeyHex = "04" +
    pubPoint.x.toString(16).padStart(64, "0") +
    pubPoint.y.toString(16).padStart(64, "0");

  // Step 1: Hash to curve
  const H = hashToCurve(publicKeyHex, ethers.getBytes(seed));

  // Step 2: Gamma = privateKey * H
  const privKeyBigInt = BigInt("0x" + Buffer.from(privKeyBytes).toString("hex"));
  const Gamma = H.multiply(privKeyBigInt);

  // Step 3: Choose nonce k deterministically (RFC 6979-style)
  const kHash = ethers.keccak256(
    ethers.concat([
      privKeyBytes,
      ethers.getBytes(seed),
      bigintToBytes32(Gamma.x),
      bigintToBytes32(Gamma.y)
    ])
  );
  const k = (BigInt(kHash) % (CURVE_ORDER - 1n)) + 1n;

  // Step 4: Compute U = k * G and V = k * H
  const U = secp256k1.ProjectivePoint.BASE.multiply(k);
  const kH = H.multiply(k);

  // Step 5: Compute challenge c = hash(H, PK, Gamma, U, V) mod n
  const c = hashPoints(H, pubPoint, Gamma, U, kH);

  // Step 6: Compute s = (k + c * privateKey) mod n
  const s = (k + c * privKeyBigInt) % CURVE_ORDER;

  // Step 7: Compute helper values for fastVerify
  // U = s*G - c*PK (the verifier recomputes this)
  // For fastVerify, we supply U directly
  // vComponents: [sH_x, sH_y, cGamma_x, cGamma_y]
  const sH = H.multiply(s);
  const cGamma = Gamma.multiply(c);

  return {
    proof: [Gamma.x, Gamma.y, c, s],
    uPoint: [U.x, U.y],
    vComponents: [sH.x, sH.y, cGamma.x, cGamma.y]
  };
}

/**
 * Wrap progressWithData in a VRF envelope.
 */
function wrapWithVRFEnvelope(vrfProof, gameData) {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  return abiCoder.encode(
    ["uint8", "uint256[4]", "uint256[2]", "uint256[4]", "bytes"],
    [
      1, // vrfVersion = ECVRF-SECP256K1-SHA256-TAI
      vrfProof.proof,
      vrfProof.uPoint,
      vrfProof.vComponents,
      gameData
    ]
  );
}

class Worker {
  constructor(interval, expiration) {
    this.pingInterval = interval ? interval : DEFAULT_PING_INTERVAL;
    this.expirationUpdates = expiration ? expiration : DEFAULT_EXPIRATION;
    this.totalUpdates = 0;
    this.totalBlocksPassed = 0;
    this.network = runtime.network;
    this.signerMode = runtime.signerMode;
    this.privateKey = runtime.privateKey; // null when signerMode=kms
    this.rpcUrls = runtime.rpcUrls;
    this.activeProviderIndex = 0;
    this.provider = new ethers.JsonRpcProvider(runtime.rpcUrl);

    if (this.signerMode === "kms") {
      const KmsSigner = getGcpKmsSigner();
      this.wallet = new KmsSigner(runtime.kmsKeyArn, this.provider);
      this.managedWallet = new ethers.NonceManager(this.wallet);
      log.info("Using GCP KMS signer", { keyArn: runtime.kmsKeyArn.split("/").pop() });
    } else {
      this.wallet = new ethers.Wallet(this.privateKey, this.provider);
      this.managedWallet = new ethers.NonceManager(this.wallet);
    }
  }

  async switchProvider() {
    const nextIndex = (this.activeProviderIndex + 1) % this.rpcUrls.length;
    if (nextIndex === this.activeProviderIndex && this.rpcUrls.length === 1) {
      log.warn("No fallback RPC available, retrying same provider");
    }
    this.activeProviderIndex = nextIndex;
    const newUrl = this.rpcUrls[this.activeProviderIndex];
    log.info("Switching RPC provider", {
      index: this.activeProviderIndex,
      url: newUrl.replace(/\/\/.*@/, '//***@'), // mask credentials in logs
      totalProviders: this.rpcUrls.length,
    });
    sendAlert("warn", "RPC Provider Switch", `Switched to provider ${this.activeProviderIndex + 1}/${this.rpcUrls.length}`, {
      "Provider Index": this.activeProviderIndex.toString(),
      "Total Providers": this.rpcUrls.length.toString(),
    }, "provider_switch");

    // Remove existing listeners
    this.provider.removeAllListeners();

    // Create new provider, wallet, and NonceManager
    this.provider = new ethers.JsonRpcProvider(newUrl);
    if (this.signerMode === "kms") {
      const KmsSigner = getGcpKmsSigner();
      this.wallet = new KmsSigner(runtime.kmsKeyArn, this.provider);
    } else {
      this.wallet = new ethers.Wallet(this.privateKey, this.provider);
    }
    this.managedWallet = new ethers.NonceManager(this.wallet);

    // Re-start block listener
    await this.start();
  }

  async checkNeedsUpdate(contractAddress) {
    const externalAutoLoopContract = new ethers.Contract(
      contractAddress,
      autoLoopCompatibleInterfaceABI,
      worker.wallet
    );

    try {
      const check = await externalAutoLoopContract.shouldProgressLoop();
      return {
        needsUpdate: check.loopIsReady,
        progressWithData: check.progressWithData,
      };
    } catch (err) {
      log.error(`Error checking auto loop compatible contract: ${contractAddress}.`, { contract: contractAddress, error: err.message });
      return { needsUpdate: false, progressWithData: null };
    }
  }

  async performUpdate(contractAddress, progressWithData) {
    // Determine VRF mode: "none", "full", or "hybrid"
    const vrfMode = await getVRFMode(contractAddress, worker.wallet);

    if (vrfMode === "full") {
      // Full VRF: every tick gets a VRF proof (existing behavior)
      if (this.signerMode === "kms") {
        log.warn(`VRF contract ${contractAddress} cannot be served in KMS mode — private key required for VRF proofs`, { contract: contractAddress });
        return;
      }
      try {
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const loopID = abiCoder.decode(["uint256"], progressWithData)[0];
        const seed = ethers.keccak256(
          ethers.solidityPacked(["address", "uint256"], [contractAddress, loopID])
        );

        const vrfProof = generateVRFProof("0x" + this.privateKey.replace(/^0x/, ""), seed);
        log.info(`Generated VRF proof for contract ${contractAddress}`, { contract: contractAddress, loopID: loopID.toString() });

        progressWithData = wrapWithVRFEnvelope(vrfProof, progressWithData);
      } catch (vrfErr) {
        log.warn(`VRF proof generation failed for ${contractAddress}, skipping update`, { contract: contractAddress, error: vrfErr.message });
        return;
      }
    } else if (vrfMode === "hybrid") {
      // Hybrid VRF: decode the flag to decide whether this tick needs VRF
      // progressWithData = abi.encode(bool needsVRF, uint256 loopID, bytes gameData)
      try {
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const [needsVRF, loopID] = abiCoder.decode(
          ["bool", "uint256", "bytes"],
          progressWithData
        );

        if (needsVRF) {
          if (this.signerMode === "kms") {
            log.warn(`Hybrid VRF tick on ${contractAddress} cannot be served in KMS mode`, { contract: contractAddress });
            return;
          }

          const seed = ethers.keccak256(
            ethers.solidityPacked(["address", "uint256"], [contractAddress, loopID])
          );

          const vrfProof = generateVRFProof("0x" + this.privateKey.replace(/^0x/, ""), seed);
          log.info(`Generated VRF proof for hybrid tick on ${contractAddress}`, {
            contract: contractAddress,
            loopID: loopID.toString(),
            vrfMode: "hybrid",
          });

          // Wrap the original progressWithData (which contains the hybrid flag) in VRF envelope
          progressWithData = wrapWithVRFEnvelope(vrfProof, progressWithData);
        } else {
          log.info(`Standard tick on hybrid contract ${contractAddress}`, {
            contract: contractAddress,
            loopID: loopID.toString(),
            vrfMode: "hybrid",
          });
          // Send progressWithData as-is — no VRF proof needed
        }
      } catch (vrfErr) {
        log.warn(`Hybrid VRF processing failed for ${contractAddress}, skipping update`, { contract: contractAddress, error: vrfErr.message });
        return;
      }
    }
    // vrfMode === "none": send progressWithData as-is (standard behavior)

    const autoLoop = new ethers.Contract(
      deployments[this.network].AUTO_LOOP,
      autoLoopABI,
      worker.managedWallet
    );

    // Set gas from contract settings
    let maxGas = await autoLoop.maxGasFor(contractAddress);
    const gasBuffer = await autoLoop.gasBuffer();
    try {
      const txGas = await autoLoop.progressLoop.estimateGas(
        contractAddress,
        progressWithData
      );
      log.info("Estimated gas", { gas: txGas.toString(), contract: contractAddress });
      // add fee on top of gas
      let totalGas = (BigInt(txGas) + BigInt(gasBuffer)) * 17n / 10n;
      const contractBalance = await autoLoop.balance(contractAddress);

      const feeData = await worker.provider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const totalGasCost = totalGas * gasPrice;
      let contractHasGas = BigInt(contractBalance) >= totalGasCost;

      if (contractHasGas) {
        let tx = await autoLoop.progressLoop(
          contractAddress,
          progressWithData,
          {
            gasLimit: totalGas,
          }
        );
        let receipt = await tx.wait();
        let gasUsed = receipt.gasUsed;
        log.info(`Progressed loop on contract ${contractAddress}.`, { contract: contractAddress, gasUsed: gasUsed.toString() });
      } else {
        log.info(`Contract ${contractAddress} underfunded, skipping.`, { contract: contractAddress, balance: contractBalance.toString() });
      }
    } catch (err) {
      log.error("Error progressing loop", { contract: contractAddress, error: err.message });
      sendAlert("error", "Transaction Failed", `Failed to progress loop on ${contractAddress}`, {
        Contract: contractAddress,
        Error: err.message,
      }, "tx_failure");
      // Reset nonce manager to re-sync from chain on next tx
      worker.managedWallet.reset();
    }
  }

  async start() {
    log.info("Starting block listener...");

    worker.provider.on("block", async (blockNumber) => {
      if (isShuttingDown) return;
      // Prevent overlapping block handler execution — if previous block
      // is still being processed, skip this one to avoid duplicate txs
      if (isProcessing) return;
      isProcessing = true;
      try {
        if (this.totalBlocksPassed % this.pingInterval == 0) {
          // Download queue on first run, and periodically re-download to pick up new registrations
          if (queue.contracts.length == 0 || this.totalBlocksPassed % QUEUE_REFRESH_INTERVAL == 0) {
            log.info("Downloading queue...");
            await queue.download();
          }

          // Update health with current stats
          updateHealth({
            status: "running",
            network: this.network,
            blockNumber,
            loopsMonitored: queue.contracts.length,
            activeUpdates: activeUpdateCount,
            lastCheck: new Date().toISOString(),
            activeProvider: this.activeProviderIndex,
            totalProviders: this.rpcUrls.length,
          });

          // Snapshot the current queue so modifications during iteration are safe
          const currentContracts = [...queue.contracts];

          for (let i = 0; i < currentContracts.length; i++) {
            if (isShuttingDown) break;
            const { needsUpdate, progressWithData } = await this.checkNeedsUpdate(currentContracts[i]);
            if (needsUpdate) {
              try {
                activeUpdateCount++;
                await this.performUpdate(currentContracts[i], progressWithData);
                activeUpdateCount--;
              } catch (err) {
                activeUpdateCount--;
                // "No longer needs update" is transient — don't remove, just log
                log.warn(`Update skipped for ${currentContracts[i]}`, { contract: currentContracts[i], error: err.message });
              }
            }
          }

          this.totalUpdates++;
          if (
            this.expirationUpdates > 0 &&
            this.totalUpdates >= this.expirationUpdates
          ) {
            await this.stop();
          }
        }
        this.totalBlocksPassed++;
      } catch (err) {
        log.error(`Error processing block ${blockNumber}`, { blockNumber, error: err.message });
        // Update health to show error state but keep running
        updateHealth({
          status: "error",
          network: this.network,
          blockNumber,
          loopsMonitored: queue.contracts.length,
          lastCheck: new Date().toISOString(),
          lastError: err.message,
        });
      } finally {
        isProcessing = false;
      }
    });

    // Handle provider errors and reconnect
    worker.provider.on("error", (err) => {
      log.error("Provider error", { error: err.message });
      updateHealth({
        status: "error",
        network: this.network,
        loopsMonitored: queue.contracts.length,
        lastCheck: new Date().toISOString(),
        lastError: err.message,
      });
      // Attempt failover on connection-level errors or rate limits
      const failoverErrors = ["SERVER_ERROR", "NETWORK_ERROR", "TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "BAD_DATA"];
      const isRateLimited = err.message && (err.message.includes("Too Many Requests") || err.message.includes("-32005"));
      const shouldFailover = isRateLimited || failoverErrors.some(code =>
        err.code === code || (err.message && err.message.includes(code))
      );
      if (shouldFailover && this.rpcUrls.length > 1) {
        this.switchProvider().catch(switchErr => {
          log.error("Failed to switch provider", { error: switchErr.message });
        });
      }
    });
  }

  async stop() {
    log.info("Stopping worker...");
    isShuttingDown = true;
    sendAlert("info", "Worker Shutting Down", `AutoLoop worker shutting down gracefully`, {
      "Total Updates": this.totalUpdates.toString(),
      "Uptime (s)": Math.floor((Date.now() - startTime) / 1000).toString(),
    });
    updateHealth({ status: "shutting_down" });

    // Remove block listener to stop new work
    this.provider.removeAllListeners();

    // Wait for in-progress transactions to complete (poll every 1s)
    const drainStart = Date.now();
    const DRAIN_TIMEOUT = 30000; // 30s — Railway's SIGTERM window
    while (activeUpdateCount > 0) {
        if (Date.now() - drainStart > DRAIN_TIMEOUT) {
            log.warn("Drain timeout reached, forcing exit", { activeUpdates: activeUpdateCount });
            break;
        }
        log.info("Waiting for in-progress transactions...", { activeUpdates: activeUpdateCount });
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    log.info("Worker stopped cleanly", {
        totalUpdates: this.totalUpdates,
        uptime: Math.floor((Date.now() - startTime) / 1000)
    });
    process.exit(0);
  }
}

class Queue {
  constructor(registryContract) {
    this.contracts = [];
    this.registryContract = registryContract;
  }
  addContract(contractAddress) {
    const index = this.contracts.indexOf(contractAddress);
    if (index < 0) {
      this.contracts.push(contractAddress);
    }
  }
  removeContract(contractAddress) {
    const index = this.contracts.indexOf(contractAddress);
    if (index >= 0) {
      if (Object.isFrozen(this.contracts)) {
        this.contracts = this.contracts.slice(0);
      }
      this.contracts.splice(index, 1);
    }
  }
  async download() {
    // get queue from contracts
    try {
      const registryAddress = await this.registryContract.getAddress();
      log.info("Registry address", { registry: registryAddress });
      const allowList = runtime.allowList;
      const blockList = runtime.blockList;
      if (allowList.length > 0) {
        this.contracts =
          await this.registryContract.getRegisteredAutoLoopsFromList(allowList);
      } else {
        if (blockList.length > 0) {
          this.contracts =
            await this.registryContract.getRegisteredAutoLoopsExcludingList(
              blockList
            );
        } else {
          this.contracts = await this.registryContract.getRegisteredAutoLoops();
        }
      }
      log.info("Queue downloaded", { contracts: this.contracts });
    } catch (err) {
      log.error("Error downloading queue", { error: err.message });
    }
  }
}

async function createRegistryContract() {
  const registry = new ethers.Contract(
    deployments[runtime.network].AUTO_LOOP_REGISTRY,
    autoLoopRegistryABI,
    worker.wallet
  );
  return registry;
}

async function setup() {
  runtime = resolveRuntime(config);
  log.info("Worker starting", { network: runtime.network, rpcUrl: runtime.rpcUrl, totalRpcUrls: runtime.rpcUrls.length });

  // Start health server
  startHealthServer();
  updateHealth({ status: "initializing", network: runtime.network });

  sendAlert("info", "Worker Starting", `AutoLoop worker starting on ${runtime.network}`, {
    Network: runtime.network,
    "RPC URLs": runtime.rpcUrls.length.toString(),
  });

  worker = new Worker(
    process.argv[2] ? process.argv[2] : null,
    process.argv[3] ? process.argv[3] : null
  );
  const registry = await createRegistryContract();
  queue = new Queue(registry);

  // Graceful shutdown handlers
  const shutdown = (signal) => {
    log.info(`Received ${signal}, initiating graceful shutdown...`);
    if (worker) {
      worker.stop();
    } else {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

function main() {
  worker.start();
}

setup()
  .then(() => {
    main();
  })
  .catch((error) => {
    log.error("Fatal startup error", { error: error.message });
    process.exit(1);
  });
