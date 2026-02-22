# Simple container for MONOLITH 180 PTT server
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3030

EXPOSE 3030

CMD ["node", "server.js"]
