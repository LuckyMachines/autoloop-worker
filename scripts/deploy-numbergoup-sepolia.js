#!/usr/bin/env node
/**
 * Deploy NumberGoUp demo to Sepolia and register + fund it.
 *
 * Usage:
 *   node scripts/deploy-numbergoup-sepolia.js
 *
 * Env:
 *   PRIVATE_KEY      — deployer key (defaults to .env)
 *   RPC_URL_SEPOLIA  — Sepolia RPC (defaults to publicnode)
 *   DEPOSIT          — ETH to deposit (default 0.5)
 *   INTERVAL         — tick interval in seconds (default 60)
 */

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const deployments = require("../deployments.json");
require("dotenv").config();

const RPC_URL =
  process.env.RPC_URL_SEPOLIA || "https://ethereum-sepolia-rpc.publicnode.com";
const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.PRIVATE_KEY_TESTNET;
const DEPOSIT = process.env.DEPOSIT || "0.5";
const INTERVAL = parseInt(process.env.INTERVAL || "60", 10); // 60s default
const MAX_GAS_PER_UPDATE = 150_000;

const REGISTRAR_ADDRESS = deployments.sepolia.AUTO_LOOP_REGISTRAR;

function loadNumberGoUp() {
  const artifactPath = path.resolve(
    __dirname,
    "../../autoloop/out/NumberGoUp.sol/NumberGoUp.json"
  );
  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      `Artifact not found: ${artifactPath}\nRun 'forge build' in autoloop/ first.`
    );
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode?.object || artifact.bytecode,
  };
}

async function main() {
  console.log("=== Deploy NumberGoUp to Sepolia ===");
  console.log(`  Interval: ${INTERVAL}s`);
  console.log(`  Deposit:  ${DEPOSIT} ETH`);
  console.log(`  Registrar: ${REGISTRAR_ADDRESS}`);
  console.log();

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  if (network.chainId !== 11155111n) {
    throw new Error(`Expected Sepolia (11155111), got ${network.chainId}`);
  }

  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Deployer: ${wallet.address}`);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH`);
  console.log();

  // Step 1: Deploy
  console.log("Step 1: Deploying NumberGoUp...");
  const { abi, bytecode } = loadNumberGoUp();
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy(INTERVAL);
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();
  console.log(`  Deployed: ${contractAddress}`);

  // Step 2: Register + fund
  console.log(`Step 2: Registering + depositing ${DEPOSIT} ETH...`);
  const registrar = new ethers.Contract(
    REGISTRAR_ADDRESS,
    [
      "function registerAutoLoopFor(address, uint256) external payable returns (bool)",
      "function deposit(address) external payable",
    ],
    wallet
  );

  const regTx = await registrar.registerAutoLoopFor(
    contractAddress,
    MAX_GAS_PER_UPDATE,
    { value: ethers.parseEther(DEPOSIT) }
  );
  const receipt = await regTx.wait();
  console.log(`  Registered! tx: ${receipt.hash}`);

  // Step 3: Verify
  console.log("Step 3: Verifying...");
  const numberGoUp = new ethers.Contract(
    contractAddress,
    ["function number() view returns (uint256)", "function interval() view returns (uint256)"],
    provider
  );
  const num = await numberGoUp.number();
  const int = await numberGoUp.interval();
  console.log(`  number(): ${num}`);
  console.log(`  interval(): ${int}s`);

  const finalBalance = await provider.getBalance(wallet.address);
  console.log();
  console.log("=== Done ===");
  console.log(`  NumberGoUp: ${contractAddress}`);
  console.log(`  Ticks every: ${INTERVAL}s`);
  console.log(`  Funded: ${DEPOSIT} ETH`);
  console.log(`  Deployer balance: ${ethers.formatEther(finalBalance)} ETH`);
  console.log();
  console.log(`NEXT_PUBLIC_DEMO_CONTRACT=${contractAddress}`);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
