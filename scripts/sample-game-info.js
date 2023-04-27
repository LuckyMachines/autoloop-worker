const hre = require("hardhat");
const fs = require("fs");
const deployments = require("../deployments.json");
const numberGoUpABI = require("../abi/NumberGoUp.json");
require("dotenv").config();

const sampleGames = ["0x34767eaB7e409C3920723CA4F2285cb7C1AC5B7E"];

async function main() {
  /*
  if (!deployments[hre.network.name].AUTO_LOOP_REGISTRAR) {
    console.log(
      "\nRegistrar not deployed. Run the deployment script or set the address in deployments.json first.\n"
    );
  } else if (!deployments[hre.network.name].SAMPLE_GAME) {
    console.log("\n Sample game not deployed.\n");
  } else {
    const Game = await hre.ethers.getContractFactory("NumberGoUp");
    const game = Game.attach(deployments[hre.network.name].SAMPLE_GAME);
    const gameNumber = await game.number();
    const gameInterval = await game.interval();
    const gameLastTimeStamp = await game.lastTimeStamp();
    console.log(`Current Game State for ${game.address}:`);
    console.log(
      `#:${gameNumber.toString()}\ninterval:${gameInterval}\nlast time stamp:${gameLastTimeStamp}`
    );
  }
  */
  const PROVIDER_URL = config.testMode
    ? process.env.RPC_URL_TESTNET
    : process.env.RPC_URL;
  const PRIVATE_KEY = config.testMode
    ? process.env.PRIVATE_KEY_TESTNET
    : process.env.PRIVATE_KEY;
  const provider = new hre.ethers.providers.JsonRpcProvider(PROVIDER_URL);
  const wallet = new hre.ethers.Wallet(PRIVATE_KEY, provider);

  for (let i = 0; i < sampleGames.length; i++) {
    const game = new hre.ethers.Contract(sampleGames[i], numberGoUpABI, wallet);
    const gameNumber = await game.number();
    const gameInterval = await game.interval();
    const gameLastTimeStamp = await game.lastTimeStamp();
    console.log(`Current Game State for Game ${i + 1}:`);
    console.log(
      `#:${gameNumber.toString()}\ninterval:${gameInterval}\nlast time stamp:${gameLastTimeStamp}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
