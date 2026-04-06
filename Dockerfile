FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
COPY index.js ./
COPY src ./src
COPY public ./public

EXPOSE 8990

CMD ["node", "index.js"]
