# Lucky Machines AutoLoop Worker

An off-chain worker that monitors registered AutoLoop-compatible contracts and executes `progressLoop()` when needed. Supports all three automation modes: Standard, Hybrid VRF, and Full VRF.

## AI Agent Quickstart

Machine-readable context lives in `llms.txt`.

Recommended agent flow:

1. Read `llms.txt` and `README.md`
2. Configure `.env` (and optionally `controller.config.json`)
3. Run `npm run register-controller`
4. Run `npm start` and monitor logs

## Requirements

- Node.js `>=24`
- Access to an RPC endpoint for the target network
- A funded controller private key (0.001 ETH for registration + gas for loop execution)

## Quick Start

```shell
git clone https://github.com/LuckyMachines/autoloop-worker.git
cd autoloop-worker
npm install
```

Create `.env` from `.env-example` and set your keys and RPC URLs.

For local Anvil testing:

```env
RPC_URL=http://127.0.0.1:8545
PRIVATE_KEY=0x...
```

You can also define per-network keys:

```env
PRIVATE_KEY_ANVIL=0x...
RPC_URL_ANVIL=http://127.0.0.1:8545
PRIVATE_KEY_SEPOLIA=0x...
RPC_URL_SEPOLIA=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PRIVATE_KEY` | Yes | Controller wallet private key |
| `RPC_URL` | Yes | RPC endpoint for the target network |
| `NETWORK` | No | Override network from config file (`anvil`, `sepolia`) |
| `PORT` | No | Health server port (default: 3000) |

The `NETWORK` env var overrides `controller.config.json`, making it easy to configure per-service in cloud deployments without modifying config files.

### Config File (Optional)

`controller.config.json` is optional when `NETWORK` env var is set. If present:

```json
{
  "network": "anvil",
  "allowList": [],
  "blockList": []
}
```

- `network`: deployment key in `deployments.json` (`anvil`, `sepolia`)
- `allowList`: optional explicit contract list to monitor
- `blockList`: optional contracts to exclude when using full registry scan

Legacy `test/main/testMode` config shape is still supported.

## Scripts

```shell
npm start                          # Run worker (scripts/worker.js)
npm run register-controller        # Register wallet as controller (costs 0.001 ETH)
npm run registered-auto-loops      # List registered contracts
npm run progress-loop <ADDRESS>    # Manual one-off loop progression
npm run cloud-start                # Register + start (used in Docker/Railway)
```

## Health Endpoint

The worker runs an HTTP health server on `PORT` (default 3000).

```
GET /health
```

Returns:

```json
{
  "status": "running",
  "uptime": 1234,
  "network": "sepolia",
  "blockNumber": 10374545,
  "loopsMonitored": 3,
  "lastCheck": "2026-03-03T09:07:14.004Z"
}
```

## Cloud Deployment (Railway)

The worker ships with a `Dockerfile` and `railway.toml` for Railway deployment.

### Railway Environment Variables

Set these per worker service:

```
NETWORK=mainnet
RPC_URL=https://mainnet.infura.io/v3/YOUR_INFURA_KEY
PRIVATE_KEY=0x_YOUR_WORKER_KEY
PORT=3000
```

### Docker

```shell
docker build -t autoloop-worker .
docker run --env-file .env autoloop-worker
```

The Dockerfile includes a `HEALTHCHECK` that pings `/health`. The entrypoint is `npm run cloud-start`, which registers the controller and starts the worker.

## VRF Support

The worker auto-detects contract types via ERC-165 (`supportsInterface`) and handles each mode automatically:

| Contract Type | ERC-165 Interface | Worker Behavior |
|---------------|-------------------|-----------------|
| `AutoLoopCompatible` | — | Standard execution, no VRF |
| `AutoLoopHybridVRFCompatible` | `bytes4(keccak256("AutoLoopHybridVRFCompatible"))` | Reads `needsVRF` flag from `shouldProgressLoop()` data; generates VRF proof only when `true` |
| `AutoLoopVRFCompatible` | `bytes4(keccak256("AutoLoopVRFCompatible"))` | Generates ECVRF proof on every tick |

All VRF proofs use ECVRF-SECP256K1-SHA256-TAI. Before a VRF or Hybrid VRF contract accepts proofs from a controller, the controller public key must be registered on-chain:

```solidity
vrfContract.registerControllerKey(controllerAddress, pkX, pkY);
```

## Deployed Contract Addresses

Addresses are stored in `deployments.json`:

- **Sepolia**: AutoLoop `0xB5F4...5238`, Registry `0xAE63...95A7`, Registrar `0xAE47...4ef0`
- **Anvil**: Dynamically assigned per local deployment

## Related Repos

- [autoloop](https://github.com/LuckyMachines/autoloop) - Core smart contracts
- [autoloop-dashboard-v2](../autoloop-dashboard-v2) - Managed service dashboard (Next.js)
