# worker 이미지. 빌드 컨텍스트는 web/ (infra/compose.yaml 의 context: ../web).
FROM node:22-slim

# 비root(node)가 런타임에 pnpm 을 받지 않도록 corepack 캐시를 모두가 읽는 경로에 둔다.
ENV CI=true \
    COREPACK_HOME=/usr/local/share/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate && chmod -R a+rX /usr/local/share/corepack

# 처음부터 node 소유로 설치해 대용량 node_modules 에 chown -R 을 돌리지 않는다.
RUN mkdir /app && chown node:node /app
USER node
WORKDIR /app
COPY --chown=node:node package.json pnpm-lock.yaml ./
# 패키지 저장소를 빌드 캐시에 둬 네트워크가 끊겨도 받은 분은 다시 받지 않는다.
RUN --mount=type=cache,target=/pnpm-store,uid=1000,gid=1000 \
    pnpm install --frozen-lockfile --store-dir /pnpm-store

COPY --chown=node:node tsconfig.json ./
COPY --chown=node:node worker ./worker
COPY --chown=node:node server ./server
COPY --chown=node:node lib ./lib

# pnpm 을 거치면 종료 신호가 전달되지 않고 실패 마지막 줄이 ELIFECYCLE 이 되므로 node 를 직접 실행한다.
# package.json 의 worker 스크립트와 같은 인자다.
CMD ["node", "--conditions=react-server", "--import", "tsx", "worker/main.ts"]
