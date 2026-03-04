# Introducing the AutoLoop Ecosystem

AutoLoop is a decentralized automation protocol for smart contracts on Ethereum. It provides a permissioned, modular system for executing recurring on-chain operations — eliminating the need for manual intervention or centralized keepers.

## How It Works

1. **You deploy a contract** that implements the `AutoLoopCompatibleInterface` (two functions: `shouldProgressLoop()` and `progressLoop()`)
2. **You register it** with the AutoLoop Registry and deposit ETH to cover gas costs
3. **Worker nodes** continuously monitor registered contracts and call `progressLoop()` when `shouldProgressLoop()` returns true
4. **Gas costs are deducted** from your deposited balance — you only pay for actual execution

## Key Features

- **Automated Execution**: Workers monitor your contracts every block and execute loops when conditions are met
- **Permissioned Controllers**: Only registered controllers can progress loops, ensuring a secure execution environment
- **Native Verifiable Randomness**: Contracts that need provably fair randomness can inherit from `AutoLoopVRFCompatible`. Workers automatically generate ECVRF proofs off-chain, and the on-chain `VRFVerifier` verifies them — no external oracle required
- **Managed Worker Fleet**: Lucky Machines operates a fleet of redundant workers on Railway, with live status visible on the [dashboard](https://dashboard.tryautoloop.com)
- **Self-Service Dashboard**: Register contracts, deposit funds, and monitor loop history from the web dashboard using your browser wallet

## Architecture

| Component | Description |
|-----------|-------------|
| [autoloop](https://github.com/LuckyMachines/autoloop) | Solidity contracts (AutoLoop, Registry, Registrar, VRFVerifier) |
| [autoloop-worker](https://github.com/LuckyMachines/autoloop-worker) | Off-chain Node.js worker that monitors and executes loops |
| [autoloop-dashboard-v2](https://dashboard.tryautoloop.com) | Next.js dashboard for contract management and monitoring |
| [autoloop-site](https://tryautoloop.com) | Marketing and documentation site |

## Getting Started

### As a Contract Developer

1. Implement `AutoLoopCompatibleInterface` in your contract
2. Deploy your contract to Sepolia (or Anvil for testing)
3. Go to https://dashboard.tryautoloop.com
4. Connect your wallet, register your contract, and deposit ETH
5. Workers will automatically start executing your loops

### As a Worker Operator

1. Clone the [autoloop-worker](https://github.com/LuckyMachines/autoloop-worker) repo
2. Fund a wallet with ETH (0.001 for registration + gas for execution)
3. Set `PRIVATE_KEY`, `RPC_URL`, and `NETWORK` in your environment
4. Run `npm run cloud-start` to register and start monitoring

## Deployed on Sepolia

| Contract | Address |
|----------|---------|
| AutoLoop | `0xB5F4cF500daE3162A4A4F5D2f3569bE1d5BE5238` |
| AutoLoopRegistry | `0xAE63c1071020964e61f668De95cA1c90ad5695A7` |
| AutoLoopRegistrar | `0xAE473527893bbf687D93cFD0e447d13202054ef0` |
