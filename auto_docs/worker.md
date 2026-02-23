# AutoLoop Worker Documentation - worker.js

This script creates an AutoLoop worker that performs updates on a list of Ethereum contracts when needed. It monitors Ethereum blocks and interacts with contracts based on their state.

## Overview

The script has two main components:

1. `Worker`: Handles the main logic of checking for contract updates, performing updates when needed, and controlling the worker's loop.
2. `Queue`: Manages the list of contract addresses and interacts with the AutoLoopRegistry contract to download a fresh list of contracts.

The worker periodically checks if the contracts in the queue require updates and performs the updates if necessary.

## Worker

The `Worker` class constructor takes two optional parameters:

1. `interval`: The number of blocks to wait before checking the queue of addresses needing updates.
2. `expiration`: The number of updates to wait before shutting down the worker.

### Worker Methods

- `checkNeedsUpdate(contractAddress)`: Determines if the specified contract needs an update by calling the `shouldProgressLoop()` function of the contract.
- `performUpdate(contractAddress)`: Performs the update on the specified contract by calling the `progressLoop()` function of the AutoLoop contract. For VRF-compatible contracts (detected via ERC-165), this method generates an ECVRF proof and wraps it in a VRF envelope before submitting.
- `start()`: Starts the worker loop, which checks for contract updates and performs updates when needed.
- `stop()`: Stops the worker loop and exits the process.

## Queue

The `Queue` class constructor takes one parameter:

1. `registryContractFactory`: A factory function that creates an instance of the AutoLoopRegistry contract.

### Queue Methods

- `addContract(contractAddress)`: Adds the specified contract address to the queue.
- `removeContract(contractAddress)`: Removes the specified contract address from the queue.
- `download()`: Fetches a fresh list of contracts from the AutoLoopRegistry contract.

## Setup

1. Instantiate a `Worker` with the desired `interval` and `expiration` values.
2. Create an instance of the AutoLoopRegistry contract using the `registryContractFactory()` function.
3. Instantiate a `Queue` with the AutoLoopRegistry contract instance.
4. Call the `start()` method on the `Worker` instance to begin the worker loop.

## Running the script

To run the script, execute the following command:

```sh
node script.js [interval] [expiration]
```

- `interval`: Optional. The number of blocks to wait before checking the queue of addresses needing updates.
- `expiration`: Optional. The number of updates to wait before shutting down the worker.

## VRF Proof Generation

When the worker encounters a VRF-compatible contract, it generates an ECVRF-SECP256K1-SHA256-TAI proof before submitting the update. The following functions handle this process:

### VRF Functions

- `isVRFCompatible(contractAddress, signerOrProvider)`: Checks if a contract supports the `AutoLoopVRFCompatible` interface via ERC-165 `supportsInterface()`. Results are cached in a `Map` to avoid repeated on-chain calls.
- `generateVRFProof(privateKeyHex, seed)`: Generates a full ECVRF proof for a given seed using the controller's private key. Returns `{ proof, uPoint, vComponents }` ready for ABI encoding. Steps:
  1. Derive public key from private key
  2. Hash-to-curve (TAI) to get point H
  3. Compute Gamma = privateKey * H
  4. Choose deterministic nonce k (RFC 6979-style)
  5. Compute U = k * G and V = k * H
  6. Compute Fiat-Shamir challenge c = hash(H, PK, Gamma, U, V) mod n
  7. Compute response s = (k + c * privateKey) mod n
  8. Compute fastVerify helper values (sH, cGamma)
- `wrapWithVRFEnvelope(vrfProof, gameData)`: ABI-encodes the VRF proof, helper points, and original game data into the VRF envelope format expected by `AutoLoopVRFCompatible.sol`.
- `hashToCurve(publicKeyBytes, message)`: Hash-to-curve using try-and-increment (TAI), matching the on-chain `VRFVerifier.hashToCurve()` implementation.
- `hashPoints(H, PK, Gamma, U, V)`: Computes the Fiat-Shamir challenge hash, matching the on-chain `_hashPoints()` function.

### VRF Flow within `performUpdate()`

1. Call `shouldProgressLoop()` to get `progressWithData` (contains the loop ID)
2. Call `isVRFCompatible()` to check for VRF support
3. If VRF-compatible:
   a. Decode the loop ID from `progressWithData`
   b. Compute the deterministic seed: `keccak256(contractAddress, loopID)`
   c. Call `generateVRFProof()` with the controller's private key and seed
   d. Call `wrapWithVRFEnvelope()` to replace `progressWithData` with the VRF envelope
4. Submit the transaction to `AutoLoop.progressLoop(contractAddress, progressWithData)`
