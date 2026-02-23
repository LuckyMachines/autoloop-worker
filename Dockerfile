FROM node:24-slim

WORKDIR /usr/src/app

COPY package.json ./
COPY package-lock.json* ./

COPY controller.config.json ./

RUN npm install --production

COPY . .

CMD ["npm", "run", "cloud-start"]
