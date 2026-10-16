# syntax=docker/dockerfile:1
# 建置方式(從 repo 根目錄):
#   docker build -f apps/admin/Dockerfile -t wowgo-base-admin \
#     --build-arg VITE_GRAPHQL_ENDPOINT=http://localhost:5001/graphql .

# ---- base ----
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

# ---- pruner:turbo prune 裁出 admin 所需的最小 monorepo 子集 ----
FROM base AS pruner
RUN npm install -g turbo@^2.10
COPY . .
RUN turbo prune @repo/admin --docker

# ---- builder ----
FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
# Vite 的環境變數在 build 時烘進靜態產物 —— 不同環境要用不同 build-arg 各建一次
ARG VITE_GRAPHQL_ENDPOINT=http://localhost:5001/graphql
ENV VITE_GRAPHQL_ENDPOINT=$VITE_GRAPHQL_ENDPOINT
RUN pnpm exec turbo run build --filter=@repo/admin
# 防回歸(#259):模組說明 src/md/module-help/ 底下的 *.help.md(底座與專案的來源)是被 Vite 內嵌進 bundle 的程式資產。
# 根目錄 .dockerignore 的 `**/*.md` 曾把它們整包擋在 build context 外,本機 build 卻正常 ——
# 這一步讓那種情況在建 image 時就失敗,而不是部署後才發現每頁的「?」都打不開。
RUN pnpm --filter @repo/admin check:help-bundle

# ---- runner:nginx 服務靜態檔 ----
FROM nginx:1.29-alpine AS runner
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/admin/dist /usr/share/nginx/html
# Cloud Run 慣例埠 8080
EXPOSE 8080
