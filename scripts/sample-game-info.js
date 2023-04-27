const hre = require("hardhat");
const fs = require("fs");
const numberGoUpABI = require("@luckymachines/autoloop/abi/contracts/sample/NumberGoUp.sol/NumberGoUp.json");
require("dotenv").config();

// Add sample game addressed to check here
const sampleGames = [];

async function main() {
  if (sampleGames.length == 0) {
    console.log(
      "Add game addressed to check to scripts/sample-game-info.js before running this script."
    );
  } else {
    const PROVIDER_URL = config.testMode
      ? process.env.RPC_URL_TESTNET
      : process.env.RPC_URL;
    const PRIVATE_KEY = config.testMode
      ? process.env.PRIVATE_KEY_TESTNET
      : process.env.PRIVATE_KEY;
    const provider = new hre.ethers.providers.JsonRpcProvider(PROVIDER_URL);
    const wallet = new hre.ethers.Wallet(PRIVATE_KEY, provider);

    for (let i = 0; i < sampleGames.length; i++) {
      const game = new hre.ethers.Contract(
        sampleGames[i],
        numberGoUpABI,
        wallet
      );
      const gameNumber = await game.number();
      const gameInterval = await game.interval();
      const gameLastTimeStamp = await game.lastTimeStamp();
      console.log(`Current Game State for Game ${i + 1}:`);
      console.log(
        `#:${gameNumber.toString()}\ninterval:${gameInterval}\nlast time stamp:${gameLastTimeStamp}`
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
