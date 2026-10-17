# syntax=docker/dockerfile:1
# 建置方式(從 repo 根目錄):docker build -f apps/api/Dockerfile -t wowgo-base-api .

# ---- base:node + pnpm(corepack 依 root package.json 的 packageManager 欄位選版本) ----
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

# ---- pruner:turbo prune 裁出 api 所需的最小 monorepo 子集 ----
FROM base AS pruner
RUN npm install -g turbo@^2.10
COPY . .
RUN turbo prune @repo/api --docker

# ---- builder:安裝依賴並建置 ----
FROM base AS builder
# 先只複製 package.json 們與 lockfile —— 依賴層可被 Docker layer cache 快取,
# 之後只改程式碼不改依賴時,install 這層直接命中快取
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm exec turbo run build --filter=@repo/api
# 重新連結為純生產依賴(pnpm prune 在 workspace 下會砍掉子套件的 node_modules,不能用;
#  CI=true 跳過 pnpm 的 TTY 確認)
RUN CI=true pnpm install --prod --frozen-lockfile --ignore-scripts

# ---- runner:最小執行環境 ----
FROM node:24-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app .
# api 啟動時會在工作目錄寫出 schema.gql,需要寫入權
RUN chown -R node:node /app/apps/api
USER node
WORKDIR /app/apps/api
# Cloud Run 會注入 PORT 環境變數;main.ts 讀 process.env.PORT ?? "5001"
EXPOSE 5001
CMD ["node", "dist/main.js"]
