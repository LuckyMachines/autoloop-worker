const { readdirSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

const scriptsDirectory = __dirname;
const scripts = readdirSync(scriptsDirectory)
  .filter((file) => file.endsWith(".js") && file !== "check-syntax.js")
  .sort();

for (const script of scripts) {
  const result = spawnSync(process.execPath, ["--check", join(scriptsDirectory, script)], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Syntax checked ${scripts.length} worker scripts.`);
