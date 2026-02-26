# Lucky Machines AutoLoop Worker

An off-chain worker that monitors registered AutoLoop-compatible contracts and executes `progressLoop()` when needed. Supports both standard loops and VRF loops.

## AI Agent Quickstart

Machine-readable context lives in `llms.txt`.

Recommended agent flow:

1. Read `llms.txt` and `README.md`
2. Configure `.env` and `controller.config.json`
3. Run `npm run register-controller`
4. Run `npm start` and monitor `scripts/worker.js` logs

## Requirements

- Node.js `>=24`
- Access to an RPC endpoint for the target network
- A funded controller private key

## Quick Start

```shell
git clone https://github.com/LuckyMachines/autoloop-worker.git
cd autoloop-worker
npm install
```

Create `.env` from `.env-example` and set your keys and RPC URLs.

For local Anvil, default RPC is:

```env
RPC_URL=http://127.0.0.1:8555
PRIVATE_KEY=0x...
```

You can also define per-network keys:

```env
PRIVATE_KEY_ANVIL=0x...
RPC_URL_ANVIL=http://127.0.0.1:8555
PRIVATE_KEY_SEPOLIA=0x...
RPC_URL_SEPOLIA=https://ethereum-sepolia-rpc.publicnode.com
```

## Worker Config

Edit `controller.config.json`:

```json
{
  "network": "anvil",
  "allowList": [],
  "blockList": []
}
```

- `network`: deployment key in `deployments.json` (for example `anvil`, `sepolia`)
- `allowList`: optional explicit contract list to monitor
- `blockList`: optional contracts to exclude when using full registry scan

Legacy `test/main/testMode` config shape is still supported.

## Run

```shell
npm run register-controller
npm start
```

Scripts:

- `npm start`: run worker (`scripts/worker.js`)
- `npm run register-controller`: register current wallet as controller
- `npm run registered-auto-loops`: list registered contracts
- `npm run progress-loop <ADDRESS>`: manual one-off loop progression

## VRF Support

The worker auto-detects VRF-compatible contracts via ERC-165 (`supportsInterface`) and submits VRF proofs when required.

Before a VRF contract accepts proofs from a controller, the controller public key must be registered on-chain:

```solidity
vrfContract.registerControllerKey(controllerAddress, pkX, pkY);
```

The [autoloop-dashboard](https://github.com/LuckyMachines/autoloop-dashboard) can perform this registration from UI.

## Related Repos

- [autoloop](https://github.com/LuckyMachines/autoloop) - Core contracts
- [autoloop-dashboard](https://github.com/LuckyMachines/autoloop-dashboard) - Local control panel and event stream
