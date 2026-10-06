# scratch-lot

ScratchLot 刮刮樂智慧管理系統。建立在多租戶應用底座 [wowgo-base](https://github.com/taiwanhua/wowgo-base) 上,沿用其前台、後台、API、RBAC、租戶隔離、動態表單與審核流程;本 repo 維護自己的品牌、業務和部署設定。

## 底座版本

採用的底座版本記在根 `package.json` 的 `wowgoBase`;設定來源見[初始化索引](docs/project-initialization.md),升級與回收見 [deployment](docs/deployment.md#底座首次接軌與版本升級)。

## 專案結構

```
apps/
├── api        NestJS + GraphQL(code-first)+ Mongoose(Cloud Run)
├── front      Next.js 前台,SEO:Server Component + ISR(Vercel)
├── admin      Vite + React 後台(Cloud Run + nginx)
└── storybook  設計系統目錄 + Palette Lab(stories 住在 packages/ui)
packages/
├── graphql    GraphQL codegen:型別 + TanStack Query hooks(front/admin 共用)
├── ui         設計系統:兩層 tokens、MUI theme(light/dark)、元件+測試+story 三件套
├── logger     共用 logger(全 repo 唯一可用 console 之處)
├── i18n       多語訊息檔(zh-TW / en)+ locale 定義(front: next-intl、admin: use-intl)
└── config-*   eslint / prettier / typescript / jest 共用設定(單一入口)
```

## 快速開始

首次啟動先依各 app 的 `.env.example` 建立 `.env`;已有檔案直接核對。API 的 `MONGODB_URI` 必填。多專案共存時,根 Compose 設定與 API 連線需一起對齊,見[本地開發](docs/architecture.md#本地開發)。

```bash
docker compose up -d   # 啟動 MongoDB
pnpm install
pnpm dev               # 同時啟動 api / front / admin / storybook
```

| 本地服務               | 網址                          |
| ---------------------- | ----------------------------- |
| GraphQL API(+ Sandbox) | http://localhost:5001/graphql |
| 前台 front             | http://localhost:3002         |
| 後台 admin             | http://localhost:3001         |
| Storybook              | http://localhost:6006         |

## 常用指令

```bash
pnpm lint / check-types / test / build   # 品質檢查與建置(CI 跑同一套)
pnpm format                              # Prettier(含 import 排序)
pnpm --filter @repo/graphql generate     # 後端 schema 變更後重生前端型別/hooks
pnpm --filter @repo/storybook dev        # 只開設計系統
docker compose --profile full up -d      # 整套容器本地驗證(mongo+api+admin)

# 專案啟用雲端並完成資源設定後,才手動部署(分支↔環境有防呆)
gh workflow run Deploy --ref dev -f environment=dev
gh workflow run Deploy --ref staging -f environment=staging
gh workflow run Deploy --ref main -f environment=production
```

## 開發流程(摘要)

feat 分支一律從 `main` 切出 → PR 合併 `dev` 整合測試 → 要上線的 feat 逐一 PR 合併 `staging` 預發布 → `staging` 合回 `main` = 發布 → feat rebase 最新 main。完整規則見 [CLAUDE.md](CLAUDE.md)。

品質三層約束:ESLint(strictTypeChecked 積木組合)+ TS strict + Prettier(機器強制)/ [docs/standards/](docs/standards/README.md) 編號規範(可審查)/ CLAUDE.md(原則)。

## 文件索引

| 文件                                         | 內容                                                 |
| -------------------------------------------- | ---------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md) | 專案架構、資料流、codegen、技術決策                  |
| [docs/deployment.md](docs/deployment.md)     | 部署操作手冊:環境對照、CI/CD、環境變數管理、維運速查 |
| [docs/standards/](docs/standards/README.md)  | 程式碼規範(GEN/STRUCT/REACT/DATA/GQL/TEST)           |
| [docs/branding.md](docs/branding.md)         | 品牌設定與設計資源;新專案依初始化操作建立            |
| [docs/agents/](docs/agents/)                 | AI 工作流程設定(issue tracker、triage、domain docs)  |
| [docs/tmp/dis.md](docs/tmp/dis.md)           | 決策共識與待辦追蹤                                   |
