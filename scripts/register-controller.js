const hre = require("hardhat");
const autoLoopRegistrarABI = require("../abi/AutoLoopRegistrar.json");
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
  const registrar = new hre.ethers.Contract(
    config[hre.network.name].AUTO_LOOP_REGISTRAR,
    autoLoopRegistrarABI,
    wallet
  );
  try {
    const tx = await registrar.registerController();
    await tx.wait();
  } catch (err) {
    console.log(err.message);
  }

  // TODO: confirm controller is registered with registry

  const registry = new hre.ethers.Contract(
    config[hre.network.name].AUTO_LOOP_REGISTRY,
    autoLoopRegistryABI,
    wallet
  );

  let accounts = await ethers.provider.listAccounts();
  const isRegistered = await registry.isRegisteredController(accounts[0]);
  if (isRegistered) {
    console.log("Controller registered.");
  } else {
    console.log("Controller not registered");
  }

  const AutoLoop = await hre.ethers.getContractFactory("AutoLoop");
  const autoLoop = AutoLoop.attach(config[hre.network.name].AUTO_LOOP);
  const controllerRole = await autoLoop.CONTROLLER_ROLE();
  const hasControllerRole = await autoLoop.hasRole(controllerRole, accounts[0]);
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
