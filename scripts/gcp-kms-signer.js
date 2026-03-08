/**
 * GCP Cloud KMS Signer for ethers v6
 *
 * Adapted from racerverse-stripe-custody-mainnet/src/signing/gcpKms.ts
 * for use in the AutoLoop worker. Signs transactions using a secp256k1
 * key stored in Google Cloud KMS (HSM-backed for production).
 *
 * Required env vars:
 *   KMS_KEY_ARN  — Full GCP key version resource path
 *                  projects/{p}/locations/{l}/keyRings/{r}/cryptoKeys/{k}/cryptoKeyVersions/{v}
 *
 * Authentication:
 *   Set GOOGLE_APPLICATION_CREDENTIALS to the path of a service-account JSON key,
 *   or use Application Default Credentials (ADC) on GCP/Railway.
 */

const { AbstractSigner, Transaction, keccak256, SigningKey, getBytes, hexlify, hashMessage } = require("ethers");
const { KeyManagementServiceClient } = require("@google-cloud/kms");

// secp256k1 curve order
const SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const SECP256K1_N_HALF = SECP256K1_N / 2n;

/**
 * Parse an uncompressed secp256k1 EC public key from a PEM-encoded string.
 * Returns the 65-byte uncompressed point (0x04 || x || y).
 */
function parsePublicKeyFromPem(pem) {
  const base64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Buffer.from(base64, "base64");

  if (der.length < 65) {
    throw new Error("PEM public key too short to contain an EC point");
  }
  const point = der.subarray(der.length - 65);
  if (point[0] !== 0x04) {
    throw new Error("Could not find uncompressed EC point in PEM public key");
  }
  return new Uint8Array(point);
}

/**
 * Parse r and s from a DER-encoded ECDSA signature.
 * Format: 0x30 [total-len] 0x02 [r-len] [r] 0x02 [s-len] [s]
 */
function parseDerSignature(sig) {
  if (sig[0] !== 0x30) throw new Error("Invalid DER signature: missing SEQUENCE tag");
  let offset = 2;

  if (sig[offset] !== 0x02) throw new Error("Invalid DER signature: missing INTEGER tag for r");
  offset++;
  const rLen = sig[offset];
  offset++;
  const rBytes = sig.subarray(offset, offset + rLen);
  offset += rLen;

  if (sig[offset] !== 0x02) throw new Error("Invalid DER signature: missing INTEGER tag for s");
  offset++;
  const sLen = sig[offset];
  offset++;
  const sBytes = sig.subarray(offset, offset + sLen);

  const r = BigInt("0x" + Buffer.from(rBytes).toString("hex"));
  const s = BigInt("0x" + Buffer.from(sBytes).toString("hex"));
  return { r, s };
}

/**
 * EIP-2 normalization: if s > N/2, flip to N - s.
 */
function normalizeS(s) {
  return s > SECP256K1_N_HALF ? SECP256K1_N - s : s;
}

/**
 * Determine the recovery parameter (0 or 1) by trying both and checking
 * which recovers to the expected address.
 */
function calculateRecoveryParam(digest, r, s, expectedAddress) {
  const rHex = "0x" + r.toString(16).padStart(64, "0");
  const sHex = "0x" + s.toString(16).padStart(64, "0");

  for (const v of [0, 1]) {
    const sig = SigningKey.recoverPublicKey(digest, { r: rHex, s: sHex, v });
    const recovered = keccak256("0x" + sig.slice(4));
    const addr = "0x" + recovered.slice(-40);
    if (addr.toLowerCase() === expectedAddress.toLowerCase()) {
      return v;
    }
  }
  throw new Error("Could not determine recovery parameter — address mismatch");
}

class GcpKmsSigner extends AbstractSigner {
  constructor(keyVersionName, provider) {
    super(provider);
    this.keyVersionName = keyVersionName;
    this.kmsClient = new KeyManagementServiceClient();
    this._cachedAddress = null;
    this._cachedPublicKeyBytes = null;
  }

  async getAddress() {
    if (this._cachedAddress) return this._cachedAddress;

    const [publicKey] = await this.kmsClient.getPublicKey({ name: this.keyVersionName });
    if (!publicKey.pem) throw new Error("KMS returned no PEM public key");

    const ecPoint = parsePublicKeyFromPem(publicKey.pem);
    this._cachedPublicKeyBytes = ecPoint;

    // ETH address = last 20 bytes of keccak256(x || y)
    const hash = keccak256(ecPoint.slice(1));
    const address = "0x" + hash.slice(-40);

    this._cachedAddress = address;
    return address;
  }

  /**
   * Get the raw uncompressed public key bytes (65 bytes: 0x04 || x || y).
   * Useful for VRF proof generation which needs the public key coordinates.
   */
  async getPublicKeyBytes() {
    if (!this._cachedPublicKeyBytes) {
      await this.getAddress(); // populates cache
    }
    return this._cachedPublicKeyBytes;
  }

  connect(provider) {
    return new GcpKmsSigner(this.keyVersionName, provider);
  }

  async signTransaction(tx) {
    const address = await this.getAddress();
    const populated = await this.populateTransaction(tx);
    const transaction = Transaction.from(populated);
    const unsignedBytes = getBytes(transaction.unsignedSerialized);
    const digest = getBytes(keccak256(unsignedBytes));

    const [signResponse] = await this.kmsClient.asymmetricSign({
      name: this.keyVersionName,
      digest: { sha256: Buffer.from(digest) },
    });

    if (!signResponse.signature) throw new Error("KMS returned empty signature");
    const derSig = new Uint8Array(
      signResponse.signature instanceof Uint8Array
        ? signResponse.signature
        : Buffer.from(signResponse.signature, "base64")
    );

    let { r, s } = parseDerSignature(derSig);
    s = normalizeS(s);

    const v = calculateRecoveryParam(digest, r, s, address);

    transaction.signature = {
      r: "0x" + r.toString(16).padStart(64, "0"),
      s: "0x" + s.toString(16).padStart(64, "0"),
      v: v + 27,
    };

    return transaction.serialized;
  }

  async signMessage(message) {
    const digest = getBytes(hashMessage(message));
    const address = await this.getAddress();

    const [signResponse] = await this.kmsClient.asymmetricSign({
      name: this.keyVersionName,
      digest: { sha256: Buffer.from(digest) },
    });

    if (!signResponse.signature) throw new Error("KMS returned empty signature");
    const derSig = new Uint8Array(
      signResponse.signature instanceof Uint8Array
        ? signResponse.signature
        : Buffer.from(signResponse.signature, "base64")
    );

    let { r, s } = parseDerSignature(derSig);
    s = normalizeS(s);
    const v = calculateRecoveryParam(digest, r, s, address);

    return hexlify(
      Buffer.concat([
        Buffer.from(r.toString(16).padStart(64, "0"), "hex"),
        Buffer.from(s.toString(16).padStart(64, "0"), "hex"),
        Buffer.from([v + 27]),
      ])
    );
  }

  async signTypedData() {
    throw new Error("signTypedData not implemented for GcpKmsSigner");
  }
}

module.exports = { GcpKmsSigner, parsePublicKeyFromPem, parseDerSignature };
