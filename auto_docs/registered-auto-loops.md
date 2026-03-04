# Get Registered AutoLoops Script Documentation - registered-auto-loops.js

This script retrieves the list of registered AutoLoops from the AutoLoop Registry contract.

## Prerequisites

- Node.js >= 24
- `ethers` and `dotenv` packages (installed via `npm install`)
- AutoLoop ABI files and deployment addresses in `deployments.json`

## Usage

```sh
npm run registered-auto-loops
```

## Script Flow

1. Resolve runtime configuration (network, RPC URL, private key).
2. Create an instance of the AutoLoop Registry contract.
3. Call `getRegisteredAutoLoops()` on the Registry contract.
4. Log the list of registered AutoLoop contract addresses.

## Error Handling

If an error occurs during execution, the error message is logged and the process exits with a non-zero status code.
