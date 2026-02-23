const { ethers } = require("ethers");
const autoLoopABI = require("../abi/AutoLoop.json");
const autoLoopRegistryABI = require("../abi/AutoLoopRegistry.json");
const autoLoopRegistrarABI = require("../abi/AutoLoopRegistrar.json");
const deployments = require("../deployments.json");
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
  const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const registrar = new ethers.Contract(
    deployments[
      config.testMode ? config.test.network : config.main.network
    ].AUTO_LOOP_REGISTRAR,
    autoLoopRegistrarABI,
    wallet
  );

  console.log("Checking if can register...");
  let canRegister = await registrar.canRegisterController(wallet.address);
  console.log("Can register:", canRegister);
  if (canRegister) {
    console.log("Attempting to register:", wallet.address);
    try {
      const tx = await registrar.registerController({
        value: ethers.parseEther("0.001")
      });
      await tx.wait();
    } catch (err) {
      console.log(err.message);
    }
  }

  const registry = new ethers.Contract(
    deployments[
      config.testMode ? config.test.network : config.main.network
    ].AUTO_LOOP_REGISTRY,
    autoLoopRegistryABI,
    wallet
  );

  const isRegistered = await registry.isRegisteredController(wallet.address);
  if (isRegistered) {
    console.log("Controller registered.");
  } else {
    console.log("Controller not registered");
  }

  const autoLoop = new ethers.Contract(
    deployments[
      config.testMode ? config.test.network : config.main.network
    ].AUTO_LOOP,
    autoLoopABI,
    wallet
  );
  const controllerRole = await autoLoop.CONTROLLER_ROLE();
  const hasControllerRole = await autoLoop.hasRole(
    controllerRole,
    wallet.address
  );
  if (hasControllerRole) {
    console.log("Controller role set on AutoLoop");
  } else {
    console.log("Controller role not set on AutoLoop");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
