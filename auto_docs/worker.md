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
- `performUpdate(contractAddress)`: Performs the update on the specified contract by calling the `progressLoop()` function of the AutoLoop contract.
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
