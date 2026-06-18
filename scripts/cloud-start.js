const { spawn } = require("child_process");
const { startHealthServer, updateHealth } = require("./health");

function runNode(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      stdio: "inherit",
      env: process.env,
      windowsHide: true,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${script} exited with ${signal || code}`));
    });
  });
}

async function main() {
  const healthServer = startHealthServer();
  updateHealth({ status: "registering", network: process.env.NETWORK || null });

  await runNode("scripts/register-controller.js");

  updateHealth({ status: "starting-worker" });
  await new Promise((resolve, reject) => {
    healthServer.close((error) => (error ? reject(error) : resolve()));
  });

  const worker = spawn(process.execPath, ["scripts/worker.js"], {
    stdio: "inherit",
    env: process.env,
    windowsHide: true,
  });

  const forward = (signal) => {
    if (!worker.killed) {
      worker.kill(signal);
    }
  };

  process.on("SIGTERM", () => forward("SIGTERM"));
  process.on("SIGINT", () => forward("SIGINT"));

  worker.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
  worker.on("exit", (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
}

main().catch((error) => {
  updateHealth({ status: "error" });
  console.error(error);
  process.exit(1);
});
