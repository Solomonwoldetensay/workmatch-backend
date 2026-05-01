# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY . .

USER node

EXPOSE 3000

CMD ["node", "server.js"]
