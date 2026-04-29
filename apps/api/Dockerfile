FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/fs-utils/package.json packages/fs-utils/package.json
COPY packages/orchestration/package.json packages/orchestration/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/weather/package.json packages/weather/package.json

RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages packages

ENV NODE_ENV=production
# Default when PORT is unset (local). Cloud Run injects PORT — server prefers it over API_PORT.
ENV API_PORT=8080

CMD ["pnpm", "--filter", "@vi/api", "start"]
