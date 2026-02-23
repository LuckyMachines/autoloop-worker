# Lucky Machines AutoLoop Worker

An off-chain bot that monitors [AutoLoop](https://github.com/LuckyMachines/autoloop)-compatible contracts and triggers `progressLoop()` when needed. Supports standard loops and VRF (verifiable randomness) loops.

## Quick Start

```shell
git clone https://github.com/LuckyMachines/autoloop-worker.git
cd autoloop-worker
npm install
```

### Configure Environment

Create a `.env` file (see `.env-example`):

```env
RPC_URL=http://127.0.0.1:8545
PRIVATE_KEY=your_controller_private_key
PRIVATE_KEY_TESTNET=your_testnet_private_key
```

### Configure Network

Edit `controller.config.json`:

```json
{
  "network": "anvil",
  "testMode": true
}
```

Available networks: `anvil`, `sepolia`

### Register & Run

```shell
# Register your wallet as an AutoLoop controller
npm run register-controller

# Start the worker
npm start
```

The worker will poll for registered contracts, check `shouldProgressLoop()`, and submit `progressLoop()` transactions when needed.

## VRF Support

The worker automatically detects VRF-compatible contracts via ERC-165 (`supportsInterface`) and generates ECVRF proofs when required. No extra configuration is needed.

### How It Works

1. **Detection** — On each update cycle, the worker calls `supportsInterface(VRF_INTERFACE_ID)` on each contract. Results are cached.
2. **Seed computation** — The deterministic seed is `keccak256(contractAddress, loopID)`, matching the on-chain `computeSeed()` function.
3. **Proof generation** — The worker generates an ECVRF-SECP256K1-SHA256-TAI proof using the controller's private key:
   - Hash-to-curve (try-and-increment)
   - Gamma = privateKey * H
   - Fiat-Shamir challenge + response
   - Precomputed U and V points for `fastVerify()`
4. **Envelope wrapping** — The proof, helper points, and original game data are ABI-encoded into a VRF envelope and submitted as `progressWithData`.
5. **On-chain verification** — The contract's `VRFVerifier.sol` verifies the proof and extracts a `bytes32` random value.

### VRF Key Registration

Before a VRF contract will accept proofs from your controller, your public key must be registered on-chain:

```solidity
// Called once per controller per VRF contract
vrfContract.registerControllerKey(controllerAddress, pkX, pkY);
```

The [autoloop-dashboard](https://github.com/LuckyMachines/autoloop-dashboard) provides a one-click UI for this step.

### Dependencies

VRF proof generation uses:

- [`@noble/curves`](https://github.com/paulmillr/noble-curves) — secp256k1 elliptic curve operations
- [`@noble/hashes`](https://github.com/paulmillr/noble-hashes) — SHA-256 and keccak256
- [`ethers`](https://docs.ethers.org/v6/) — ABI encoding, key derivation

## Related Repos

- [autoloop](https://github.com/LuckyMachines/autoloop) — Smart contracts (AutoLoop, VRFVerifier, AutoLoopVRFCompatible)
- [autoloop-dashboard](https://github.com/LuckyMachines/autoloop-dashboard) — Web-based control panel and event monitor
