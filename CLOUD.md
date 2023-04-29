# CLOUD

## building docker

- you'll need to set up your .env and controller.config.json files locally first
- build a docker image
  - `docker build . -t luckymachines/autoloop-worker`

## .env variables

- controller.config.json gets copied but .env should be passed at runtime to docker
  - a local version of that is `docker run --env-file .env luckymachines/autoloop-worker`
  - you'd set up your ENV variables according to the cloud provider where the docker container is deployed

## stopping docker after local run

`docker ps` # get the id of the running container
`docker stop <container>` # kill it (gracefully)
