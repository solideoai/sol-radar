# 기존 Next.js API를 재사용한다. 별도 Gateway 프레임워크/Redis 컨테이너를 만들지 않는다.
FROM node:22-slim AS build
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app/web
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
COPY infra/sources/ /app/infra/sources/
# Next 빌드의 전체 타입 검사는 기존 @test-harness 선언도 확인한다.
COPY scripts/ /app/scripts/
RUN pnpm build

FROM node:22-slim AS runtime
ENV NODE_ENV=production SOL_DEPLOYMENT_ROLE=redis-api HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/web/.next/standalone ./
WORKDIR /app/web
COPY --from=build --chown=node:node /app/web/.next/static ./.next/static
COPY --from=build --chown=node:node /app/web/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
