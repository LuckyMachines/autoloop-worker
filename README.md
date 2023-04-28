# Lucky Machines AutoLoop Worker

An AutoLoop worker you can run to earn profits and

# Run a local worker

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
