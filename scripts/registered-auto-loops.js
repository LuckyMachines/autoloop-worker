const hre = require("hardhat");
const autoLoopRegistryABI = require("../abi/AutoLoopRegistry.json");
const config = require("../controller.config.json");
require("dotenv").config();

async function main() {
  // register controller with registrar contract
  const PROVIDER_URL = config.testMode
    ? process.env.RPC_URL_TESTNET
    : process.env.RPC_URL;
  const PRIVATE_KEY = config.testMode
    ? process.env.PRIVATE_KEY_TESTNET
    : process.env.PRIVATE_KEY;
  const provider = new hre.ethers.providers.JsonRpcProvider(PROVIDER_URL);
  const wallet = new hre.ethers.Wallet(PRIVATE_KEY, provider);
  const registry = new hre.ethers.Contract(
    config[hre.network.name].AUTO_LOOP_REGISTRY,
    autoLoopRegistryABI,
    wallet
  );
  const registeredLoops = await registry.getRegisteredAutoLoops();
  console.log("Registered AutoLoops:", registeredLoops);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
