# Progress Loop Script Documentation - progress-loop.js

This script manually progresses the loop on a specified Ethereum contract. It checks whether the contract needs an update, and if it does, it calls the `progressLoop()` function of the AutoLoop contract to perform the update.

## Prerequisites

- Node.js >= 24
- `ethers` and `dotenv` packages (installed via `npm install`)
- AutoLoop ABI files and deployment addresses in `deployments.json`

## Usage

```sh
npm run progress-loop <CONTRACT_ADDRESS>
```

Replace `<CONTRACT_ADDRESS>` with the address of the contract you want to progress the loop on.

## Script Flow

1. Read the contract address from the command line argument.
2. Resolve runtime configuration (network, RPC URL, private key).
3. Create an instance of the target contract using the `AutoLoopCompatibleInterface` ABI.
4. Call `shouldProgressLoop()` on the target contract to check if it needs an update.
5. If the contract needs an update, create an instance of the AutoLoop contract.
6. Get the `maxGas` and `gasBuffer` values from the AutoLoop contract.
7. Call `progressLoop()` on the AutoLoop contract with the target contract address and progress data.
8. Wait for the transaction receipt and display the gas sent and gas used.

## Error Handling

The script checks for the presence of the contract address argument. If not provided, it logs an error and exits. Runtime errors are logged and the process exits with a non-zero status code.
