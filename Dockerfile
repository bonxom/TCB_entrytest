FROM node:22-bookworm-slim

# Build tools are needed if better-sqlite3 has no matching prebuilt binary.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --global pnpm@11.21.0

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 3000
CMD ["pnpm", "run", "dev"]
