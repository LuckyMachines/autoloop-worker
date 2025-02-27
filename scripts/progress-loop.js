const hre = require("hardhat");
const config = require("../controller.config.json");
const autoLoopABI = require("@luckymachines/autoloop/abi/contracts/AutoLoop.sol/AutoLoop.json");
const autoLoopCompatibleInterfaceABI = require("@luckymachines/autoloop/abi/contracts/AutoLoopCompatibleInterface.sol/AutoLoopCompatibleInterface.json");
const deployments = require("@luckymachines/autoloop/deployments.json");
require("dotenv").config();

// This script calls progressLoop directly on a contract that conforms to AutoLoopCompatibleInterface
// Used for testing the contract update without going through a worker
// Pass contract address as argument
// yarn progress-loop <CONTRACT ADDRESS>

async function main() {
  const contractAddress = process.argv[2] ? process.argv[2] : null;
  if (contractAddress) {
    const PROVIDER_URL = config.testMode
      ? process.env.RPC_URL_TESTNET
      : process.env.RPC_URL;
    const PRIVATE_KEY = config.testMode
      ? process.env.PRIVATE_KEY_TESTNET
      : process.env.PRIVATE_KEY;
    const provider = new hre.ethers.providers.JsonRpcProvider(PROVIDER_URL);
    const wallet = new hre.ethers.Wallet(PRIVATE_KEY, provider);
    const externalAutoLoopContract = new hre.ethers.Contract(
      contractAddress,
      autoLoopCompatibleInterfaceABI,
      wallet
    );
    const check = await externalAutoLoopContract.shouldProgressLoop();
    let needsUpdate = check.loopIsReady;
    let progressWithData = check.progressWithData;
    console.log(`Contract ${contractAddress} needs update: ${needsUpdate}`);
    if (needsUpdate) {
      const autoLoop = new hre.ethers.Contract(
        deployments[
          config.testMode ? config.test.network : config.main.network
        ].AUTO_LOOP,
        autoLoopABI,
        wallet
      );

      console.log(
        "Calling progress loop directly on:",
        externalAutoLoopContract.address
      );
      // let tx = await autoLoop.progressLoop(contractAddress, progressWithData, {
      //   gasLimit: gasToSend,
      // });
      let tx = await externalAutoLoopContract.progressLoop(progressWithData);
      let receipt = await tx.wait();
      let gasUsed = receipt.gasUsed;
      console.log(
        `Progressed loop on contract ${externalAutoLoopContract.address}.`
      );
      console.log(`Gas used: ${gasUsed}`);
    }
  } else {
    console.log("Contract address argument not set");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
