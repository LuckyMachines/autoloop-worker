function formatLog(level, message, context = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  });
}

const logger = {
  info(message, context) {
    console.log(formatLog("info", message, context));
  },
  warn(message, context) {
    console.warn(formatLog("warn", message, context));
  },
  error(message, context) {
    console.error(formatLog("error", message, context));
  },
};

module.exports = logger;
