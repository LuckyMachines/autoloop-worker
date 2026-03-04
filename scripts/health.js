const http = require("http");

let healthData = {
  status: "starting",
  uptime: 0,
  network: null,
  blockNumber: 0,
  loopsMonitored: 0,
  lastCheck: null,
  activeProvider: 0,
  totalProviders: 1,
};

const startTime = Date.now();

function updateHealth(data) {
  Object.assign(healthData, data);
}

function startHealthServer() {
  const port = process.env.PORT || 3000;

  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ...healthData,
          uptime: Math.floor((Date.now() - startTime) / 1000),
        })
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, () => {
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", message: `Health server listening on port ${port}` }));
  });

  return server;
}

module.exports = { startHealthServer, updateHealth, startTime };
