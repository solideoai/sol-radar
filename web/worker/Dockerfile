# worker 이미지. 빌드 컨텍스트는 web/ (infra/compose.yaml 의 context: ../web).
FROM node:22-slim

ENV CI=true
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY worker ./worker
COPY server ./server
COPY lib ./lib

RUN chown -R node:node /app
USER node
CMD ["pnpm", "worker"]
