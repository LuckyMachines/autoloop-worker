const { ethers } = require("ethers");
const config = require("../controller.config.json");
const autoLoopABI = require("../abi/AutoLoop.json");
const autoLoopCompatibleInterfaceABI = require("../abi/AutoLoopCompatibleInterface.json");
const deployments = require("../deployments.json");
const { resolveRuntime } = require("./runtime-config");
require("dotenv").config();

// This script calls progressLoop directly on a contract that conforms to AutoLoopCompatibleInterface
// Used for testing the contract update without going through a worker
// Pass contract address as argument
// npm run progress-loop <CONTRACT ADDRESS>

async function main() {
  const contractAddress = process.argv[2] ? process.argv[2] : null;
  if (contractAddress) {
    const runtime = resolveRuntime(config);
    const provider = new ethers.JsonRpcProvider(runtime.rpcUrl);
    const wallet = new ethers.Wallet(runtime.privateKey, provider);
    const externalAutoLoopContract = new ethers.Contract(
      contractAddress,
      autoLoopCompatibleInterfaceABI,
      wallet
    );
    const check = await externalAutoLoopContract.shouldProgressLoop();
    let needsUpdate = check.loopIsReady;
    let progressWithData = check.progressWithData;
    console.log(`Contract ${contractAddress} needs update: ${needsUpdate}`);
    if (needsUpdate) {
      const autoLoop = new ethers.Contract(
        deployments[runtime.network].AUTO_LOOP,
        autoLoopABI,
        wallet
      );

      const contractAddr = await externalAutoLoopContract.getAddress();
      console.log(
        "Calling progress loop directly on:",
        contractAddr
      );
      let tx = await externalAutoLoopContract.progressLoop(progressWithData);
      let receipt = await tx.wait();
      let gasUsed = receipt.gasUsed;
      console.log(
        `Progressed loop on contract ${contractAddr}.`
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
