const { ethers } = require("ethers");
const autoLoopRegistryABI = require("../abi/AutoLoopRegistry.json");
const deployments = require("../deployments.json");
const config = require("../controller.config.json");
const { resolveRuntime } = require("./runtime-config");
require("dotenv").config();

async function main() {
  const runtime = resolveRuntime(config);
  // query registered auto loops
  const provider = new ethers.JsonRpcProvider(runtime.rpcUrl);
  const wallet = new ethers.Wallet(runtime.privateKey, provider);
  const registry = new ethers.Contract(
    deployments[runtime.network].AUTO_LOOP_REGISTRY,
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
