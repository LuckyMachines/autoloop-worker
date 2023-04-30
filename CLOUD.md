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

## deploy to google cloud

- setup a new project according to [this article](https://kadiremreozcan.medium.com/google-cloud-platform-gcp-dockerize-a-node-js-web-app-and-deploy-to-compute-engine-instance-501809832289)

- from the project directory, build for google cloud

  - `docker build -t gcr.io/autoloop-worker-node/docker-image .`

- push to image docker + google cloud

  - `docker push gcr.io/autoloop-worker-node/docker-image`

- then go to "Container Registry" on google cloud console
- click Deploy button
- click Deploy to GCE
- configure environment variables for the instance
  - Container > Change > Environment Variables + Add Variable
- launch it!
- you can ssh in
- then do `docker ps`
- then docker exec <container id> env to see the environment variables
- then do `docker logs` to see logs
