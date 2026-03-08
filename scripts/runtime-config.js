const LOCAL_NETWORKS = new Set(["anvil", "localhost", "hardhat"]);
const MAINNET_NETWORKS = new Set(["mainnet", "ethereum"]);

function firstDefined(env, keys) {
  for (const key of keys) {
    if (!key) continue;
    const value = env[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return null;
}

function normalizeProfile(config) {
  if (config && typeof config.network === "string") {
    return {
      network: config.network,
      allowList: Array.isArray(config.allowList) ? config.allowList : [],
      blockList: Array.isArray(config.blockList) ? config.blockList : [],
    };
  }

  const useTestProfile = Boolean(config?.testMode);
  const profile = useTestProfile ? config?.test : config?.main;
  if (!profile || typeof profile.network !== "string") {
    throw new Error(
      "controller.config.json must define either { network } or legacy { test/main + testMode }"
    );
  }

  return {
    network: profile.network,
    allowList: Array.isArray(profile.allowList) ? profile.allowList : [],
    blockList: Array.isArray(profile.blockList) ? profile.blockList : [],
  };
}

function networkEnvSuffix(network) {
  return network.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function resolveRuntime(config, env = process.env) {
  const profile = normalizeProfile(config);
  // NETWORK env var overrides config file — lets Railway set network per-service
  const network = env.NETWORK || profile.network;
  const suffix = networkEnvSuffix(network);

  // Backward compatibility: *_TESTNET is treated as sepolia legacy keys.
  const primaryRpcUrl = firstDefined(env, [
    `RPC_URL_${suffix}`,
    network === "sepolia" ? "RPC_URL_TESTNET" : null,
    "RPC_URL",
  ]);

  // Build rpcUrls array: split comma-separated primary, then add numbered fallbacks
  let rpcUrls = [];
  if (primaryRpcUrl) {
    // Support comma-separated URLs in a single env var
    rpcUrls = primaryRpcUrl.split(",").map((u) => u.trim()).filter(Boolean);
  }

  // Add numbered fallbacks RPC_URL_1 through RPC_URL_10 (skip duplicates)
  for (let i = 1; i <= 10; i++) {
    const numbered = env[`RPC_URL_${i}`];
    if (typeof numbered === "string" && numbered.trim() !== "") {
      const trimmed = numbered.trim();
      if (!rpcUrls.includes(trimmed)) {
        rpcUrls.push(trimmed);
      }
    }
  }

  const rpcUrl = rpcUrls.length > 0 ? rpcUrls[0] : null;

  // Signer mode: 'dev' uses raw private key, 'kms' uses GCP Cloud KMS
  const signerMode = env.SIGNER_MODE || "dev";
  const isMainnet = MAINNET_NETWORKS.has(network);

  // Safety: warn on mainnet with raw private key (workers use dev keys, deployers should use KMS)
  if (isMainnet && signerMode === "dev") {
    console.warn(
      "WARNING: Using raw private key on mainnet. This is OK for workers but deployers should use KMS."
    );
  }

  // Safety: KMS mode must not have PRIVATE_KEY set (prevent cross-wire)
  if (signerMode === "kms" && firstDefined(env, ["PRIVATE_KEY"])) {
    console.warn(
      "WARNING: PRIVATE_KEY is set but SIGNER_MODE=kms — ignoring PRIVATE_KEY"
    );
  }

  const kmsKeyArn = env.KMS_KEY_ARN || null;

  if (signerMode === "kms" && !kmsKeyArn) {
    throw new Error(
      `KMS_KEY_ARN is required when SIGNER_MODE=kms`
    );
  }

  const privateKey = signerMode === "dev"
    ? firstDefined(env, [
        `PRIVATE_KEY_${suffix}`,
        network === "sepolia" ? "PRIVATE_KEY_TESTNET" : null,
        "PRIVATE_KEY",
      ])
    : null;

  if (!rpcUrl) {
    throw new Error(
      `Missing RPC URL for network "${network}". Set RPC_URL_${suffix} or RPC_URL.`
    );
  }
  if (signerMode === "dev" && !privateKey) {
    throw new Error(
      `Missing private key for network "${network}". Set PRIVATE_KEY_${suffix} or PRIVATE_KEY.`
    );
  }

  return {
    network,
    allowList: profile.allowList,
    blockList: profile.blockList,
    rpcUrl,
    rpcUrls,
    privateKey,
    signerMode,
    kmsKeyArn,
    isLocal: LOCAL_NETWORKS.has(network),
    isMainnet,
  };
}

module.exports = { resolveRuntime };
