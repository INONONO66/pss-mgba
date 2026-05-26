FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm

COPY package.json ./

RUN pnpm install --dangerously-allow-all-builds --frozen-lockfile 2>/dev/null || pnpm install --dangerously-allow-all-builds --no-frozen-lockfile

COPY src/ ./src/
COPY tsconfig.json ./

EXPOSE 8787

CMD ["npx", "tsx", "src/index.ts"]
