# Progress Loop Script Documentation - progress-loop.js

This script manually progresses the loop on a specified Ethereum contract. It checks whether the contract needs an update, and if it does, it calls the `progressLoop()` function of the AutoLoop contract to perform the update.

## Prerequisites

Ensure the following dependencies are installed and configured:

- `hardhat`
- `dotenv`
- AutoLoop ABI files and deployment information

## Usage

To run the script, execute the following command:

```sh
yarn progress-loop <CONTRACT_ADDRESS>
```

Replace `<CONTRACT_ADDRESS>` with the address of the contract you want to progress the loop on.

## Script Flow

1. Read the contract address from the command line argument.
2. Set up the provider and wallet using environment variables and configuration settings.
3. Create an instance of the target contract using the `AutoLoopCompatibleInterface` ABI.
4. Call the `shouldProgressLoop()` function on the target contract to check if it needs an update.
5. If the contract needs an update, create an instance of the AutoLoop contract using its ABI.
6. Get the `maxGas` and `gasBuffer` values from the AutoLoop contract.
7. Call the `progressLoop()` function on the AutoLoop contract with the target contract address and progress data.
8. Wait for the transaction receipt and display the gas sent and gas used for the transaction.

## Error Handling

The script checks for the presence of the contract address argument. If the argument is not set, it logs an error message and exits.

If an error occurs during the execution of the main function, the error message is logged, and the process exits with a non-zero status code.
