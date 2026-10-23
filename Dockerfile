# The whole evaluator in one image: the dashboard is built once, and the server serves it.
FROM node:22-slim

WORKDIR /app

# Install dependencies first so this layer is reused when only the code changes.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 4000
CMD ["npm", "start"]
