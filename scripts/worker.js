const { ethers } = require("hardhat");
const hre = require("hardhat");
const config = require("../controller.config.json");

const autoLoopABI = require("@luckymachines/autoloop/abi/contracts/AutoLoop.sol/AutoLoop.json");
const autoLoopRegistryABI = require("@luckymachines/autoloop/abi/contracts/AutoLoopRegistry.sol/AutoLoopRegistry.json");
const autoLoopCompatibleInterfaceABI = require("@luckymachines/autoloop/abi/contracts/AutoLoopCompatibleInterface.sol/AutoLoopCompatibleInterface.json");
const deployments = require("@luckymachines/autoloop/deployments.json");
require("dotenv").config();

let worker;
let queue;

// This is not necessarily called every block. This is how many blocks to wait after
// queue of addresses needing updates has been processed.
const DEFAULT_PING_INTERVAL = 1; // # blocks to wait before checking
const DEFAULT_EXPIRATION = 0; // # updates to wait before shutting down, 0 = never

let nonceOffset = 0;

class Worker {
  constructor(interval, expiration) {
    this.pingInterval = interval ? interval : DEFAULT_PING_INTERVAL;
    this.expirationUpdates = expiration ? expiration : DEFAULT_EXPIRATION;
    this.totalUpdates = 0;
    this.totalBlocksPassed = 0;
    const PROVIDER_URL = config.testMode
      ? process.env.RPC_URL_TESTNET
      : process.env.RPC_URL;
    const PRIVATE_KEY = config.testMode
      ? process.env.PRIVATE_KEY_TESTNET
      : process.env.PRIVATE_KEY;
    this.provider = new hre.ethers.providers.JsonRpcProvider(PROVIDER_URL);
    this.wallet = new hre.ethers.Wallet(PRIVATE_KEY, this.provider);
  }

  async checkNeedsUpdate(contractAddress) {
    const externalAutoLoopContract = new ethers.Contract(
      contractAddress,
      autoLoopCompatibleInterfaceABI,
      worker.wallet
    );
    let needsUpdate = false;

    try {
      const check = await externalAutoLoopContract.shouldProgressLoop();
      needsUpdate = check.loopIsReady;
    } catch (err) {
      console.log(
        `Error checking auto loop compatible contract: ${contractAddress}.`
      );
      console.log(err.message);
    }

    return needsUpdate;
  }

  async performUpdate(contractAddress) {
    const externalAutoLoopContract = new ethers.Contract(
      contractAddress,
      autoLoopCompatibleInterfaceABI,
      worker.wallet
    );

    // confirm update is still needed and grab update data
    const check = await externalAutoLoopContract.shouldProgressLoop();
    let needsUpdate = check.loopIsReady;
    let progressWithData = check.progressWithData;

    if (needsUpdate) {
      const autoLoop = new hre.ethers.Contract(
        deployments[
          config.testMode ? config.test.network : config.main.network
        ].AUTO_LOOP,
        autoLoopABI,
        worker.wallet
      );

      // Set gas from contract settings
      let maxGas = await autoLoop.maxGasFor(contractAddress);
      const gasBuffer = await autoLoop.gasBuffer();
      const gasToSend = Number(maxGas) + Number(gasBuffer);
      let nonce =
        (await worker.provider.getTransactionCount(this.wallet.address)) +
        nonceOffset; // accounts for pending updates
      nonceOffset++;
      try {
        const txGas = await autoLoop.estimateGas.progressLoop(
          contractAddress,
          progressWithData
        );
        console.log("Estimated gas:", txGas);
        // add fee on top of gas
        let totalGas = Math.round((Number(txGas) + Number(gasBuffer)) * 1.7);
        const contractBalance = await autoLoop.balance(contractAddress);

        const gasPrice = await worker.provider.getGasPrice();
        const totalGasCost = totalGas * gasPrice;
        let contractHasGas = Number(contractBalance) >= totalGasCost;

        if (contractHasGas) {
          let tx = await autoLoop.progressLoop(
            contractAddress,
            progressWithData,
            {
              gasLimit: totalGas.toString(),
              nonce: nonce
            }
          );
          let receipt = await tx.wait();
          let gasUsed = receipt.gasUsed;
          console.log(`Progressed loop on contract ${contractAddress}.`);
          console.log(`Gas used: ${gasUsed}`);
        } else {
          console.log(
            `Contract ${contractAddress} underfunded. Cannot progress.`
          );
        }
        nonceOffset--;
      } catch (err) {
        console.log("Error progressing loop", err.message);
        nonceOffset--;
      }
    } else {
      throw new Error(`Contract no longer needs update: ${contractAddress}`);
    }
  }

  async start() {
    // console.log("Starting worker...");
    // console.log("Provider:", this.provider);
    // console.log("Wallet:", this.wallet);
    worker.provider.once("block", async (blockNumber) => {
      if (this.totalBlocksPassed % this.pingInterval == 0) {
        let contractsToRemove = [];
        try {
          if (queue.contracts.length == 0) {
            console.log("Downloading queue...");
            await queue.download();
          }

          for (let i = 0; i < queue.contracts.length; i++) {
            const needsUpdate = await this.checkNeedsUpdate(queue.contracts[i]);
            if (needsUpdate) {
              try {
                await this.performUpdate(queue.contracts[i]);
                // contractsToRemove.push(queue.contracts[i]);
              } catch (err) {
                console.log(
                  `Error performing update on auto loop compatible contract: ${queue.contracts[i]}`
                );
                console.log(err.message);
                contractsToRemove.push(queue.contracts[i]);
              }
            } else {
              // contractsToRemove.push(queue.contracts[i]);
            }
          }
        } catch (err) {
          console.log(`Error at block ${blockNumber}\n${err.message}`);
        }
        if (contractsToRemove.length > 0) {
          console.log("Clearing unused contracts...");
          for (let i = 0; i < contractsToRemove.length; i++) {
            queue.removeContract(contractsToRemove[i]);
          }
        }
        this.totalUpdates++;
        if (
          this.expirationUpdates > 0 &&
          this.totalUpdates >= this.expirationUpdates
        ) {
          await this.stop();
        }
      }
      this.totalBlocksPassed++;
      await this.start();
    });
  }

  async stop() {
    console.log("Stopping worker...");
    // do any final tasks before worker is down
    process.exit();
  }
}

class Queue {
  constructor(registryContractFactory) {
    this.contracts = [];
    this.contractFactory = registryContractFactory;
  }
  addContract(contractAddress) {
    const index = this.contracts.indexOf(contractAddress);
    if (index < 0) {
      this.contracts.push(contractAddress);
    }
  }
  removeContract(contractAddress) {
    const index = this.contracts.indexOf(contractAddress);
    // console.log("contracts:", this.contracts);
    if (index >= 0) {
      if (Object.isFrozen(this.contracts)) {
        this.contracts = this.contracts.slice(0);
      }
      this.contracts.splice(index, 1);
    }
  }
  async download() {
    // get queue from contracts

    try {
      console.log("registry:", this.contractFactory.address);
      const allowList = config[config.testMode ? "test" : "main"].allowList;
      const blockList = config[config.testMode ? "test" : "main"].blockList;
      if (allowList.length > 0) {
        this.contracts =
          await this.contractFactory.getRegisteredAutoLoopsFromList(allowList);
      } else {
        if (blockList.length > 0) {
          this.contracts =
            await this.contractFactory.getRegisteredAutoLoopsExcludingList(
              blockList
            );
        } else {
          this.contracts = await this.contractFactory.getRegisteredAutoLoops();
        }
      }
      console.log("Queue:", this.contracts);
    } catch (err) {
      console.error(err);
    }
  }
}

async function registryContractFactory() {
  const registry = new hre.ethers.Contract(
    deployments[
      config.testMode ? config.test.network : config.main.network
    ].AUTO_LOOP_REGISTRY,
    autoLoopRegistryABI,
    worker.wallet
  );
  return registry;
}

async function setup() {
  worker = new Worker(
    process.argv[2] ? process.argv[2] : null,
    process.argv[3] ? process.argv[3] : null
  );
  const registryFactory = await registryContractFactory();
  queue = new Queue(registryFactory);
  //console.log("Worker:", worker);
}

function main() {
  worker.start();
}

setup()
  .then(() => {
    main();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
