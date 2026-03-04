FROM node:24-slim

WORKDIR /usr/src/app

COPY package.json ./
COPY package-lock.json* ./

RUN npm install --production

COPY . .

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const http=require('http');const r=http.get('http://localhost:'+(process.env.PORT||3000)+'/health',s=>{process.exit(s.statusCode===200?0:1)});r.on('error',()=>process.exit(1))"

CMD ["npm", "run", "cloud-start"]
