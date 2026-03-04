# Register Controller Script Documentation - register-controller.js

This script registers a new controller with the AutoLoop Registrar contract, checks its registration status with the AutoLoop Registry, and verifies if it has been granted the controller role in the AutoLoop contract.

## Prerequisites

- Node.js >= 24
- `ethers` and `dotenv` packages (installed via `npm install`)
- A funded wallet (0.001 ETH for registration)
- AutoLoop ABI files and deployment addresses in `deployments.json`

## Usage

```sh
npm run register-controller
```

Or with environment variable overrides:

```sh
NETWORK=sepolia RPC_URL=https://... PRIVATE_KEY=0x... npm run register-controller
```

## Configuration

The script reads configuration from:

1. `controller.config.json` (optional if `NETWORK` env var is set)
2. Environment variables: `NETWORK`, `RPC_URL`, `PRIVATE_KEY`
3. `.env` file (loaded via dotenv)

## Script Flow

1. Resolve runtime configuration (network, RPC URL, private key)
2. Create an instance of the AutoLoop Registrar contract
3. Check if the wallet address can be registered as a controller via `canRegisterController()`
4. If registration is possible, call `registerController()` with 0.001 ETH
5. Verify registration in the AutoLoop Registry via `isRegisteredController()`
6. Verify the controller role is set on the AutoLoop contract via `hasRole(CONTROLLER_ROLE)`

## Error Handling

The script logs error messages during the registration process and continues to the worker if run via `npm run cloud-start`. If the wallet is already registered, `canRegisterController()` returns false and registration is skipped.
