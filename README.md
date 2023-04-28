# Lucky Machines AutoLoop Worker

An AutoLoop worker you can run to support the network and create a stream of income.

# Run a local worker

## Clone the repo

```shell
gh repo clone LuckyMachines/autoloop-worker
```

## Move into directory

```shell
cd autoloop-worker
```

## Install dependencies

```shell
yarn
```

## Set Credentials

- Create a `.env` file with RPC URL & wallet private key (see `.env-example`)

## Turn on testing in `controller.config.json`

`"testMode": true`

## Run the AutoLoop worker

- Register wallet as AutoLoop worker (via registrar)

```shell
yarn register-controller
```

- Run the AutoLoop worker with controller privileges

```shell
yarn start
```
