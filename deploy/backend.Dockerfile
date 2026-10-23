FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY --chown=node:node backend/package*.json ./
COPY --chown=node:node backend/prisma ./prisma
RUN npm ci && npx prisma generate
COPY --chown=node:node backend/src ./src
ENV NODE_ENV=production PORT=5000
USER node
EXPOSE 5000
CMD ["node", "src/server.js"]
