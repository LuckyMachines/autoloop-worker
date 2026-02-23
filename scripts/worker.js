const { ethers } = require("ethers");
const { secp256k1 } = require("@noble/curves/secp256k1");
const { sha256 } = require("@noble/hashes/sha256");
const config = require("../controller.config.json");

const autoLoopABI = require("../abi/AutoLoop.json");
const autoLoopRegistryABI = require("../abi/AutoLoopRegistry.json");
const autoLoopCompatibleInterfaceABI = require("../abi/AutoLoopCompatibleInterface.json");
const deployments = require("../deployments.json");
require("dotenv").config();

// VRF interface ID: bytes4(keccak256("AutoLoopVRFCompatible"))
const VRF_INTERFACE_ID = ethers.id("AutoLoopVRFCompatible").slice(0, 10);

// secp256k1 curve order
const CURVE_ORDER = secp256k1.CURVE.n;
// secp256k1 field prime
const FIELD_PRIME = secp256k1.CURVE.p;

// Cache for VRF-compatible contract detection
const vrfCompatibleCache = new Map();

let worker;
let queue;

// This is not necessarily called every block. This is how many blocks to wait after
// queue of addresses needing updates has been processed.
const DEFAULT_PING_INTERVAL = 1; // # blocks to wait before checking
const DEFAULT_EXPIRATION = 0; // # updates to wait before shutting down, 0 = never

let nonceOffset = 0;

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
    const PROVIDER_URL = config.testMode
      ? process.env.RPC_URL_TESTNET
      : process.env.RPC_URL;
    const PRIVATE_KEY = config.testMode
      ? process.env.PRIVATE_KEY_TESTNET
      : process.env.PRIVATE_KEY;
    this.provider = new ethers.JsonRpcProvider(PROVIDER_URL);
    this.wallet = new ethers.Wallet(PRIVATE_KEY, this.provider);
  }

  async checkNeedsUpdate(contractAddress) {
    const externalAutoLoopContract = new ethers.Contract(
      contractAddress,
      autoLoopCompatibleInterfaceABI,
      worker.wallet
    );
    let needsUpdate = false;

    try {
      const check = await externalAutoLoopContract.shouldProgressLoop();
      needsUpdate = check.loopIsReady;
    } catch (err) {
      console.log(
        `Error checking auto loop compatible contract: ${contractAddress}.`
      );
      console.log(err.message);
    }

    return needsUpdate;
  }

  async performUpdate(contractAddress) {
    const externalAutoLoopContract = new ethers.Contract(
      contractAddress,
      autoLoopCompatibleInterfaceABI,
      worker.wallet
    );

    // confirm update is still needed and grab update data
    const check = await externalAutoLoopContract.shouldProgressLoop();
    let needsUpdate = check.loopIsReady;
    let progressWithData = check.progressWithData;

    if (needsUpdate) {
      // Check if contract supports VRF and wrap data accordingly
      const vrfEnabled = await isVRFCompatible(contractAddress, worker.wallet);
      if (vrfEnabled) {
        try {
          const PRIVATE_KEY = config.testMode
            ? process.env.PRIVATE_KEY_TESTNET
            : process.env.PRIVATE_KEY;

          // Compute the seed: keccak256(contractAddress, loopID)
          // The loopID is encoded in progressWithData from shouldProgressLoop
          const abiCoder = ethers.AbiCoder.defaultAbiCoder();
          const loopID = abiCoder.decode(["uint256"], progressWithData)[0];
          const seed = ethers.keccak256(
            ethers.solidityPacked(["address", "uint256"], [contractAddress, loopID])
          );

          // Generate VRF proof
          const vrfProof = generateVRFProof("0x" + PRIVATE_KEY.replace(/^0x/, ""), seed);
          console.log(`Generated VRF proof for contract ${contractAddress} (loopID: ${loopID})`);

          // Wrap in VRF envelope
          progressWithData = wrapWithVRFEnvelope(vrfProof, progressWithData);
        } catch (vrfErr) {
          console.log(`VRF proof generation failed for ${contractAddress}: ${vrfErr.message}`);
          console.log("Falling back to non-VRF update (will likely revert for VRF contracts)");
        }
      }

      const autoLoop = new ethers.Contract(
        deployments[
          config.testMode ? config.test.network : config.main.network
        ].AUTO_LOOP,
        autoLoopABI,
        worker.wallet
      );

      // Set gas from contract settings
      let maxGas = await autoLoop.maxGasFor(contractAddress);
      const gasBuffer = await autoLoop.gasBuffer();
      const gasToSend = BigInt(maxGas) + BigInt(gasBuffer);
      let nonce =
        (await worker.provider.getTransactionCount(this.wallet.address)) +
        nonceOffset; // accounts for pending updates
      nonceOffset++;
      try {
        const txGas = await autoLoop.progressLoop.estimateGas(
          contractAddress,
          progressWithData
        );
        console.log("Estimated gas:", txGas.toString());
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
              nonce: nonce
            }
          );
          let receipt = await tx.wait();
          let gasUsed = receipt.gasUsed;
          console.log(`Progressed loop on contract ${contractAddress}.`);
          console.log(`Gas used: ${gasUsed}`);
        } else {
          console.log(
            `Contract ${contractAddress} underfunded. Cannot progress.`
          );
        }
        nonceOffset--;
      } catch (err) {
        console.log("Error progressing loop", err.message);
        nonceOffset--;
      }
    } else {
      throw new Error(`Contract no longer needs update: ${contractAddress}`);
    }
  }

  async start() {
    worker.provider.once("block", async (blockNumber) => {
      if (this.totalBlocksPassed % this.pingInterval == 0) {
        let contractsToRemove = [];
        try {
          if (queue.contracts.length == 0) {
            console.log("Downloading queue...");
            await queue.download();
          }

          for (let i = 0; i < queue.contracts.length; i++) {
            const needsUpdate = await this.checkNeedsUpdate(queue.contracts[i]);
            if (needsUpdate) {
              try {
                await this.performUpdate(queue.contracts[i]);
              } catch (err) {
                console.log(
                  `Error performing update on auto loop compatible contract: ${queue.contracts[i]}`
                );
                console.log(err.message);
                contractsToRemove.push(queue.contracts[i]);
              }
            }
          }
        } catch (err) {
          console.log(`Error at block ${blockNumber}\n${err.message}`);
        }
        if (contractsToRemove.length > 0) {
          console.log("Clearing unused contracts...");
          for (let i = 0; i < contractsToRemove.length; i++) {
            queue.removeContract(contractsToRemove[i]);
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
      await this.start();
    });
  }

  async stop() {
    console.log("Stopping worker...");
    // do any final tasks before worker is down
    process.exit();
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
      console.log("registry:", registryAddress);
      const allowList = config[config.testMode ? "test" : "main"].allowList;
      const blockList = config[config.testMode ? "test" : "main"].blockList;
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
      console.log("Queue:", this.contracts);
    } catch (err) {
      console.error(err);
    }
  }
}

async function createRegistryContract() {
  const registry = new ethers.Contract(
    deployments[
      config.testMode ? config.test.network : config.main.network
    ].AUTO_LOOP_REGISTRY,
    autoLoopRegistryABI,
    worker.wallet
  );
  return registry;
}

async function setup() {
  worker = new Worker(
    process.argv[2] ? process.argv[2] : null,
    process.argv[3] ? process.argv[3] : null
  );
  const registry = await createRegistryContract();
  queue = new Queue(registry);
}

function main() {
  worker.start();
}

setup()
  .then(() => {
    main();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
