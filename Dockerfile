FROM node:18

#create app directory
WORKDIR /usr/src/app

# copy dependencies lists

COPY package.json ./
COPY yarn.lock  ./

# copy our custom config file
COPY controller.config.json ./

#install dependencies
RUN yarn install

# bundle the app source
COPY . . 

CMD ["yarn","cloud-start"]
