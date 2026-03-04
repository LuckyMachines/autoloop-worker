const http = require("http");
const https = require("https");
const log = require("./logger");

const WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL;
const RATE_LIMIT_MS = 60_000; // 1 alert per minute per error type
const REQUEST_TIMEOUT = 5000;

// Rate limit tracker: Map<errorType, lastSentTimestamp>
const rateLimitMap = new Map();

function isSlackUrl(url) {
  return url && url.includes("hooks.slack.com");
}

function formatSlackPayload(level, title, message, fields) {
  const emoji = { info: ":information_source:", warn: ":warning:", error: ":x:" }[level] || ":grey_question:";
  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `${emoji} ${title}`, emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: message },
    },
  ];
  if (fields && Object.keys(fields).length > 0) {
    blocks.push({
      type: "section",
      fields: Object.entries(fields).map(([k, v]) => ({
        type: "mrkdwn",
        text: `*${k}:*\n${v}`,
      })),
    });
  }
  return { blocks };
}

function formatGenericPayload(level, title, message, fields) {
  return {
    level,
    title,
    message,
    fields: fields || {},
    timestamp: new Date().toISOString(),
  };
}

/**
 * Send an alert via webhook. Fire-and-forget — never blocks the worker.
 * @param {string} level - "info" | "warn" | "error"
 * @param {string} title - Alert title
 * @param {string} message - Alert body
 * @param {object} [fields] - Optional key-value metadata
 * @param {string} [errorType] - Rate limit key (e.g. "provider_switch", "tx_failure")
 */
function sendAlert(level, title, message, fields, errorType) {
  if (!WEBHOOK_URL) return; // No-op if not configured

  // Rate limiting by error type
  if (errorType) {
    const lastSent = rateLimitMap.get(errorType);
    if (lastSent && Date.now() - lastSent < RATE_LIMIT_MS) {
      return; // Throttled
    }
    rateLimitMap.set(errorType, Date.now());
  }

  const payload = isSlackUrl(WEBHOOK_URL)
    ? formatSlackPayload(level, title, message, fields)
    : formatGenericPayload(level, title, message, fields);

  const body = JSON.stringify(payload);
  const url = new URL(WEBHOOK_URL);
  const transport = url.protocol === "https:" ? https : http;

  const req = transport.request(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: REQUEST_TIMEOUT,
    },
    (res) => {
      // Drain response
      res.resume();
      if (res.statusCode >= 400) {
        log.warn("Alert webhook returned error", { statusCode: res.statusCode });
      }
    }
  );

  req.on("error", (err) => {
    log.warn("Alert webhook request failed", { error: err.message });
  });

  req.on("timeout", () => {
    req.destroy();
    log.warn("Alert webhook request timed out");
  });

  req.write(body);
  req.end();
}

module.exports = { sendAlert };
