# Cloud Deployment

## Railway (Recommended)

The worker is deployed to Railway using the included `Dockerfile` and `railway.toml`.

### Setup

1. Create a Railway project and add a service
2. Set environment variables:
   ```
   NETWORK=sepolia
   RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
   PRIVATE_KEY=0x_YOUR_WORKER_KEY
   PORT=3000
   ```
3. Deploy with `railway up` or connect a GitHub repo

The `railway.toml` configures:
- Dockerfile-based builds
- Health check at `/health`
- Auto-restart on failure (up to 5 retries)

### Multiple Workers

Run multiple workers as separate Railway services in the same project. Each worker needs its own `PRIVATE_KEY`. All workers share the same code and can monitor the same contracts — the protocol handles deconfliction.

### Health Monitoring

Each worker exposes `GET /health` on port 3000. Railway uses this for health checks. The [dashboard](../autoloop-dashboard-v2) proxies these endpoints via its `/api/workers` route to display fleet status.

## Docker

### Build

```shell
docker build -t autoloop-worker .
```

### Run

```shell
docker run --env-file .env autoloop-worker
```

Or pass env vars directly:

```shell
docker run \
  -e NETWORK=sepolia \
  -e RPC_URL=https://ethereum-sepolia-rpc.publicnode.com \
  -e PRIVATE_KEY=0x... \
  -e PORT=3000 \
  autoloop-worker
```

### Docker Compose (Local Multi-Worker)

A `docker-compose.workers.yml` is available in the parent directory for running 3 workers against a local Anvil instance.

## Legacy: Google Cloud

See the [GCP deployment article](https://kadiremreozcan.medium.com/google-cloud-platform-gcp-dockerize-a-node-js-web-app-and-deploy-to-compute-engine-instance-501809832289) for Compute Engine deployment. The same Docker image works — just set env vars in the GCE instance configuration.
