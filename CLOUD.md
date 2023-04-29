# CLOUD

- you'll need to set up your .env and controller.config.json files first
- build a docker image
  - `docker build . -t luckymachines/autoloop-worker`
- controller.config.json gets copied but .env should be passed at runtime to docker
  - so a local version of that is `docker run --env-file .env luckymachines/autoloop-worker`
  - you'd set up your ENV variables according to the cloud provider where the docker container is deployed
