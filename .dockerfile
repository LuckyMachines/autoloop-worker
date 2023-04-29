FROM node:18

#create app directory
WORKDIR /usr/src/app

# copy dependencies

COPY package.json ./
COPY yarn.lock  ./

#install yarn
RUN npm install -g yarn

#install dependencies
RUN yarn install

# bundle the app source
COPY . . 

CMD ["yarn","cloud-start"]
