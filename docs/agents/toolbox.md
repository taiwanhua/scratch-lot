# 常用指令與 skill:什麼時機用什麼

給人與 AI 共用的速查表。每一節都附正本:指令以 `package.json` 的 scripts 與 `.github/workflows/*.yml` 為準,本檔與正本不一致時照正本做並回報。流程(何時認領、何時移卡)見 [issue-tracker.md](./issue-tracker.md);指令跑出怪現象先查 [pitfalls.md](./pitfalls.md)。

指令預設在 repo 根執行;PowerShell 與 Bash 兩種寫法不同時,兩種都列。

凡 gh 指令有 repo 範圍,均明示 `--repo <owner/repo>` 並核對 `deploy/project/github.json.expectedRepository` 與 origin。下表省略的例子也適用;不能靠 gh 在 origin/upstream 之間自動選擇。

## 目錄

1. [gh:issue 與 PR](#ghissue-與-pr)
2. [手動觸發的 workflow:部署、E2E、資料庫還原](#手動觸發的-workflow部署e2e資料庫還原)
3. [自動跑的 workflow](#自動跑的-workflow)
4. [分支:對齊與重置 dev / staging](#分支對齊與重置-dev--staging)
5. [pnpm / turbo:建置、測試、格式](#pnpm--turbo建置測試格式)
6. [本機跑 E2E](#本機跑-e2e)
7. [mock 模式](#mock-模式)
8. [codegen 與資料庫(本機)](#codegen-與資料庫本機)
9. [Figma 品牌同步](#figma-品牌同步)
10. [第三方依賴](#第三方依賴)
11. [Claude Code skill 對照表](#claude-code-skill-對照表)
12. [派工模板(給無 session 的 agent)](#派工模板給無-session-的-agent)
13. [批次 release(指路)](#批次-release指路)
14. [底座升級與回收](#底座升級與回收)

## gh:issue 與 PR

| 情境                | 指令                                                                                                                               | 提醒                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 讀票(含留言)        | `gh issue view <n> --json title,body,comments,labels`                                                                              | 純文字 `--comments` 在 PowerShell 會被截斷                                                                 |
| 從 JSON 取欄位      | `gh … --json <欄位> --jq '<filter>'`                                                                                               | 沒有外部 `jq`,一律用 `--jq`                                                                                |
| 認領                | `gh issue edit <n> --add-assignee "@me"`                                                                                           | `@me` 要加引號                                                                                             |
| 開 PR               | `gh pr create --base dev --title "…" --body-file <scratchpad 檔>`                                                                  | 內文先用 Write 寫成檔(heredoc 會被守衛擋);內文含 `Closes #<n>`                                             |
| 多行 commit 訊息    | `git commit -F <scratchpad 檔>`                                                                                                    | 單行用 `-m`                                                                                                |
| 看 PR 能不能合 / CI | `gh pr view <n> --json mergeable,statusCheckRollup`、`gh pr checks <n>`                                                            | `CONFLICTING` 時 CI 不會跑;不要加 `--required`                                                             |
| 輪詢 CI             | `until gh pr checks <n>; do sleep 30; done`(寫成一行)                                                                              | 多行迴圈會被守衛擋                                                                                         |
| 移看板卡            | `gh project item-edit --id <item_id> --project-id <project_id> --field-id <status_field_id> --single-select-option-id <option_id>` | 看板 IDs 讀 `deploy/project/github.json` 的 `projectStatus`;欄位對應與卡片 ID 查法見 issue-tracker「看板」 |
| 查 workflow run     | `gh run list --workflow <檔名或名稱> --limit 5`、`gh run view <run-id> --log-failed`                                               | 手動 workflow 觸發後要自己查結果                                                                           |

正本:[issue-tracker.md](./issue-tracker.md#看板票的生命週期唯一真相)、[deploy/project/github.json](../../deploy/project/github.json)、`.github/workflows/project-status.yml`

## 手動觸發的 workflow:部署、E2E、資料庫還原

三支都只有 `workflow_dispatch`,merge 不會觸發。UI 路徑一律是 GitHub → Actions → 選 workflow → Run workflow。

| workflow                     | 指令                                                                                                                                                      | 何時用                                                                                    | 副作用                                                                                            | 前置條件                                                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Deploy**(`deploy.yml`)     | `gh workflow run Deploy --ref <分支> -f environment=<dev\|staging\|production>`                                                                           | 一批票都合進 `dev` 後部署 dev;release 流程中部署 staging / production                     | 建 image、部署 Cloud Run,**成功後自動跑一次 `update`**;只部署改到的 app(比對該環境目前部署的 SHA) | 分支與環境要對應:dev←`dev`、staging←`staging`、production←`main`,不對直接失敗;改了 `.dockerignore` / Dockerfile 要加 `-f force=true` |
| **E2E**(`e2e.yml`)           | `gh workflow run e2e.yml --ref <分支>`;只跑一條加 `-f grep="劇本 7"`                                                                                      | 使用者決定要跑時才觸發;agent 只在 PR 註明是否建議跑與理由(`docs/agents/issue-tracker.md`) | 無:資料庫是 job 自己的拋棄式 container,不碰任何環境、不讀 Secret;會花不少 Actions 額度            | workflow 檔已在 `main`;跑的是 `--ref` 那個分支上的 spec 與 harness                                                                   |
| **Reset DB**(`reset-db.yml`) | `gh workflow run "Reset DB" --ref <版本> -f environment=<dev\|staging\|production> -f mode=<data\|full> -f confirmation="reset:<環境>:<實際DB名>:<模式>"` | 依指定版本還原資料庫                                                                      | data 保留受管設定及歷史,full 重建全部應用資料;不部署服務或清除 GCS                                | 人工確認須符合環境、DB 與模式;完整刪留規則及操作見 [deployment](../deployment.md#資料庫還原reset)                                    |

正本:`.github/workflows/deploy.yml`、`.github/workflows/e2e.yml`、`.github/workflows/reset-db.yml`、`docs/deployment.md`(三、手動操作)

## 自動跑的 workflow

| workflow                                 | 觸發                                                                                                          | 看什麼                                                                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CI**(`ci.yml`)                         | PR 與 push 到 `main` / `dev` / `staging`;paths-ignore 是 `docs/**`、根目錄 `*.md`、`.claude/**`、`.agents/**` | `project-settings` 與 `figma-sync` 每次跑;workspace 的 lint / test / build 依受影響清單執行,全部 job 由 `verify` 彙整。完整 job 圖與過濾規則見 [deployment](../deployment.md#ciciyml),接線見 [ci.yml](../../.github/workflows/ci.yml) |
| **Docs**(`docs.yml`)                     | 同上,但 paths 只有 `docs/**`、`*.md`、`**/*.md`                                                               | `pnpm run format:check`(與 ci.yml 同一個腳本)                                                                                                                                                                                         |
| **Project Status**(`project-status.yml`) | issue / PR 事件                                                                                               | 自動移看板卡(規則見 issue-tracker「看板」)                                                                                                                                                                                            |

只改 `.claude/**`、`.agents/**` 裡的非 md 檔時兩支都不跑,prettier 要自己在本機跑(對照見 `docs/deployment.md`「CI」)。

正本:`.github/workflows/ci.yml`、`.github/workflows/docs.yml`、`.github/workflows/project-status.yml`

## 分支:對齊與重置 dev / staging

| 情境                                               | 指令                                                                  | 提醒                                                                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 開工切分支                                         | `git fetch origin` → `git checkout -b feat/<票號>-<描述> origin/main` | 依賴票還沒進 `main` 時改從依賴票的分支尾端切;**不從 `dev` / `staging` 切**(疊票與對齊規則見 deployment.md「分支模型」)                     |
| release 後對齊、或 `dev` 被汙染要**重置 dev 分支** | `git push --force origin origin/main:refs/heads/dev`(`staging` 同理)  | **只由主流程做**;先跑前置檢查(兩個 `git diff --stat` 為空、`gh pr list --base dev --state open`)。絕不把 `main` merge 回 `dev` / `staging` |
| 重置 dev 的**資料庫**                              | 見上一節 Reset DB                                                     | 分支重置與資料庫重置是兩件事                                                                                                               |
| 交叉 merge base(PR 顯示衝突、本地 merge-tree 乾淨) | 主流程 reset 該 base 後,`gh pr close <n>` → `gh pr reopen <n>`        | base 更新不觸發 `pull_request` 事件                                                                                                        |

正本:`docs/deployment.md`(二、「分支模型」「Release 步驟」第 4 點、「交叉 merge base」)、`CLAUDE.md`「Git 工作流程」

## pnpm / turbo:建置、測試、格式

| 情境                          | 指令                                                                                                                                       | 提醒                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 新 worktree 第一件事          | `pnpm install`                                                                                                                             | 純文件票也要(沒裝就沒有 prettier)                                                                              |
| 讓 `@repo/*` 型別與出口解得開 | `pnpm exec turbo run build --filter=@repo/graphql --filter=@repo/ui --filter=@repo/domain --filter=@repo/project-config`                   | 程式票開工必做;db-migrator 的票也要。包含 Vite 設定載入時需要的 project-config                                 |
| 整包驗收測試                  | `pnpm exec turbo run test --filter=@repo/admin`(`@repo/api`、`@repo/ui`、`@repo/domain`… 同理)                                             | filter 寫全名;turbo 會先 build 依賴                                                                            |
| 單檔測試:admin                | `pnpm --filter @repo/admin exec node --experimental-vm-modules node_modules/jest/bin/jest.js --maxWorkers=2 --testPathPatterns <路徑片段>` | 就是 package `test` script 本人再加旗標;不要 `pnpm exec jest`(少了 `--experimental-vm-modules`,ESM 測試直接炸) |
| 單檔測試:api                  | `pnpm --filter @repo/api exec jest --passWithNoTests --detectOpenHandles --maxWorkers=2 --testPathPatterns <路徑片段>`                     | api 的 `test` script 就是直接呼叫 `jest`(CJS preset,不需要 `--experimental-vm-modules`)                        |
| 單檔測試:ui                   | `pnpm --filter @repo/ui exec node --experimental-vm-modules node_modules/jest/bin/jest.js --maxWorkers=2 --testPathPatterns <路徑片段>`    | 同 admin                                                                                                       |
| 取 `origin/main` 的測試數基準 | 在 main 的 checkout 進 package 目錄直接 `pnpm run test`                                                                                    | 不要用 turbo:快取跨 worktree 共用,會拿到別人先前跑的結果(TEST-08「測試數的基準」)                              |
| 交件前 lint / 型別            | 進各 package 目錄:`pnpm run lint`、`pnpm run check-types`                                                                                  | **理由**:turbo 快取命中時只是重播先前的 log,本機綠、CI 仍可能被 type-aware warning 擋下                        |
| 全 repo 型別                  | `pnpm exec turbo run check-types`                                                                                                          | 同上,看到 `cache hit` 不代表驗過本次改動                                                                       |
| 格式化 / 檢查                 | `pnpm format` / `pnpm run format:check`                                                                                                    | 涵蓋 md / ts / tsx / js / json / yaml;改根 scripts 時直接跑 script 本人                                        |
| help.md 有沒有被打包          | `pnpm --filter @repo/admin build` → `pnpm --filter @repo/admin check:help-bundle`                                                          | 新增 / 改 help.md 的票交件前跑;Dockerfile 也跑這一步                                                           |
| 查套件最新版                  | `npm view <pkg> version`                                                                                                                   | 不照記憶寫版本號                                                                                               |

新專案初始化驗證依賴順序分開跑:先建置共用套件,再對改到的 package 各跑 lint、型別、測試與 build。不要在本機以 `turbo run lint check-types test build --force` 同時重建與讀取同一份 `dist`:大量平行任務可能讀到建置中的產物或造成測試逾時。需跑全 repo 時按任務分階段,資源有限可用 `--concurrency=1`;正式 CI 的 job 與快取仍依其 workflow 執行。

只跑一個測試檔一律用上表「單檔測試」的 `pnpm --filter <pkg> exec …` 寫法(本段是全 repo 的正本,其他文件指回這裡)。三個不要:

- **不要 `pnpm run test -- <旗標> <路徑片段>`、`pnpm --filter <pkg> test -- …`**:pnpm 會把 `--` 原樣傳給 script,jest 把 `--` 之後的東西全當成路徑 pattern,旗標沒生效(輸出是 `Ran all test suites matching --maxWorkers=2|<路徑片段>`);api 會因此跑整包、十幾分鐘沒輸出像卡住。
- **不要 `pnpm exec jest`**(admin / ui):少了 `test` script 裡的 `--experimental-vm-modules`,ESM 測試直接炸,看起來像測試壞了。
- **不要 `--testPathPattern`(單數)**:那是 jest 29 以前的名字,jest 30 是 `--testPathPatterns`(複數),三個 package 都一樣。

正本:根 `package.json`、`apps/admin/package.json`、`apps/api/package.json`、`packages/ui/package.json`、`turbo.json`、`docs/standards/testing/testing.md`(TEST-08)

## 本機跑 E2E

| 情境                             | Bash                                             | PowerShell                                                       |
| -------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| 第一次:裝 chromium               | `pnpm --filter @repo/e2e e2e:browser`            | 同左                                                             |
| 全部劇本                         | `pnpm e2e`                                       | 同左                                                             |
| 只跑一條                         | `E2E_GREP="劇本 7" pnpm e2e`                     | `$env:E2E_GREP="劇本 7"; pnpm e2e`                               |
| 換埠(預設 api 5101 / admin 4301) | `E2E_API_PORT=5102 E2E_ADMIN_PORT=4302 pnpm e2e` | `$env:E2E_API_PORT="5102"; $env:E2E_ADMIN_PORT="4302"; pnpm e2e` |
| 反覆跑同一條,不重 build          | 加 `E2E_SKIP_BUILD=1`                            | 加 `$env:E2E_SKIP_BUILD="1";`                                    |
| 接在自己起好的 stack 上除錯      | 加 `E2E_SKIP_STACK=1`                            | 加 `$env:E2E_SKIP_STACK="1";`                                    |

- `pnpm e2e` 自己做完 build → 起 Mongo(`mongodb-memory-server`)→ update → 起 api 與 admin → 跑完收掉;報告在 `apps/e2e/playwright-report/`。
- 劇本 11 / 15 要 Docker Desktop 開著(fake GCS 容器),沒有就這兩條 skip、其餘照跑。
- `--` 之後的旗標穿不過 `pnpm --filter`,所以選劇本走 `E2E_GREP`;agent 在 worktree 裡用 Bash 下 `VAR=…` 前綴會被守衛擋,用 PowerShell 那一欄。
- 埠一改,admin 要重 build(api 端點是 build 時烘進 bundle 的),不要同時加 `E2E_SKIP_BUILD`。
- 多專案並行時,在各自的 `apps/e2e/.env` 分別設定 DB、port、bucket 與 `E2E_COMPOSE_PROJECT`;fake GCS up/down 都顯式指定該 Compose 專案。

正本:`apps/e2e/README.md`、`apps/e2e/.env.example`、`apps/e2e/src/config.ts`

## mock 模式

新 checkout 或依賴有改動時,先執行[建置前置步驟](#pnpm--turbo建置測試格式)的「讓 `@repo/*` 型別與出口解得開」指令,再直接啟動 admin 或 mock。Vite 設定載入時就會讀取 `@repo/project-config/public`;`dev:mock` 會先建置 project-config 再啟動 Vite,但不經 Turbo,其他 workspace 依賴仍須先建置。

| 情境                      | 指令                                                              | 提醒                                                                                      |
| ------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 起 admin 的 mock 模式     | `pnpm --filter @repo/admin dev:mock --port <自選埠> --strictPort` | **不要在 `--port` 前加 `--`**(加了 vite 會忽略,照樣從 3002 靜默跳埠);網址以 `Local:` 為準 |
| 換租戶管理員視角 / 登入頁 | 網址加 `?view=tenant` / `?auth=off`                               | 預設自動登入 root、各頁都有假資料                                                         |
| PR 截圖                   | 見 issue-tracker「admin 票的交付要求」                            | 截圖前確認畫面裡看得到自己的改動                                                          |

正本:`apps/admin/package.json`(`dev:mock`)、`apps/admin/vite.mock.config.ts`、`docs/standards/testing/testing.md`(TEST-08「mock 開發模式」)

## codegen 與資料庫(本機)

API 與受管定義 CLI 的 `MONGODB_URI` 必填,不回退到內建 DB。schema 產生器與測試 harness 會自行提供隔離 URI;一般本機啟動依[架構](../architecture.md#本地開發)準備 `.env`。

| 情境                             | 指令                                                                                                                                                                                                 | 提醒                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 改了 api 的 GraphQL schema       | `pnpm --filter @repo/api schema:generate` → `pnpm --filter @repo/graphql generate`(依序)                                                                                                             | `apps/api/schema.gql` 與 `packages/graphql/src/generated` 同一個 commit(GQL-05);先依上方建置前置步驟準備 workspace 產物 |
| 本機設定與資料更新               | `pnpm --filter @repo/db-migrator run update`                                                                                                                                                         | 先依 [deployment](../deployment.md#設定與資料更新)建置同一 checkout 的 API CLI;需要 `MONGODB_URI` 與 `ROOT_ADMIN_*`     |
| 查更新狀態 / 單支 migration 還原 | `pnpm --filter @repo/db-migrator migrate:status`、`… migrate:down`                                                                                                                                   | status 唯讀;down 只還原 migration,不回滾 seed 或定義。限制與續跑見 deployment                                           |
| 本機還原資料庫(Bash)             | `RESET_ALLOW_ENV=dev MONGODB_URI=mongodb://127.0.0.1:27017/project-dev pnpm --filter @repo/db-migrator run reset --environment=dev --mode=data --confirm=reset:dev:project-dev:data`                 | 先完成 update 的建置及 root 環境變數準備;環境須明示,不由 DB 名尾碼推測                                                  |
| 本機還原資料庫(PowerShell)       | `$env:RESET_ALLOW_ENV="dev"; $env:MONGODB_URI="mongodb://127.0.0.1:27017/project-dev"; pnpm --filter @repo/db-migrator run reset --environment=dev --mode=data --confirm=reset:dev:project-dev:data` | 改為 full 時,模式參數與確認字串都須改為 full                                                                            |

正本:`apps/api/package.json`、`packages/graphql/package.json`、`apps/db-migrator/package.json`、`apps/db-migrator/src/reset/reset-safety.ts`、`docs/env-registry.md`

GraphQL 文件登記負例用 `pnpm --filter @repo/graphql test:documents`,CI 的 `format-codegen` 執行它。這是 Node test,不接共用 Jest 的 `--forceExit`;一般 `turbo run test` 不會執行此專用指令。`generate` 本身仍會先檢查正式文件來源,失敗不寫產物。

## Figma 品牌同步

專案各有自己的 Brand Library 與 Screens；共用元件由 [wowgo-base Design System](../branding.md#設計資源登記) 發布，Screens 使用它的遠端實例。品牌值的唯一維護來源是 `packages/project-config/src/project/public.ts` 的 `projectPublic.brand`；本機外掛沿用 `@repo/ui` 推導六個 primary 色階及 `Shadow/Primary`。程式碼版本用正式 Git tag 與 `base-sync upgrade` PR 採用，Figma Library 則由 Figma 發布、加入檔案並接受更新；兩者的版本連結記在升級 PR。

### 第一次建立與換品牌

1. 將專案的品牌名稱和 `#RRGGBB` 主色寫入 `projectPublic.brand`，另建 `<專案> Brand Library` Figma 檔並取得網址 `/design/` 後的 file key。在專案 repo 建置後，產生可丟棄的小型輸入檔：

   ```bash
   pnpm exec turbo run build --filter=@repo/ui --filter=@repo/project-config
   node scripts/figma-local/export-brand.mjs --file-key <brand-file-key> --out .artifacts/figma-local/brand.json
   ```

2. 在 Figma **桌面版**的 `Plugins → Development → Import new plugin from manifest…` 選 `scripts/figma-local/manifest.json`。在 Brand Library 開啟 `wowgo-base Brand Sync`，選上一步 JSON，預覽核對 file key 與待變更數，再套用並重預覽至待處理 0。外掛建立或更新 `Brand`、`Color` 兩個 Light 集合，各六個 `primary/*`；`Color` 指向 `Brand`，另建立或更新 `Shadow/Primary`。在 Figma 原生介面發布此 Brand Library。換電腦時從 repo 重新匯入 manifest；外掛不需要 token、本機服務或 MCP 傳送生成程式。
3. 專案 Screens 使用獨立檔案，從**已連結遠端底座元件**的 Screens 範本複製，或從已發布的底座 Library 插入實例組成畫面。直接複製底座 Design System 檔會把主元件留在本檔，不能當作可升級的 Screens。到 Screens 的 `Assets → Libraries` 加入底座與本專案 Brand Library，並接受可用更新。在 Screens 開外掛，輸入當前檔案 key，選底座與專案 Library、檢查範圍，先「檢查綁定」再「補綁專案色」；重檢待處理應為 0、例外為 0。初建可選「全部頁面」，日常選受影響頁面。
4. 在 Screens 用 Figma 原生 **Swap libraries** 將底座 `Shadow/Primary` 換成本專案樣式，並覆寫品牌示例文字、商標及業務內容。這些不是六色變數；外掛刻意不改文字、私人色、圖、排版或元件實例。核對一個 Primary Button、巢狀側欄與一張代表畫面：主色、陰影、文字、布局，以及遠端底座主元件連結。新專案的檔案 key、Library 權限和維護者登記在[品牌註冊表](../branding.md)。

### 底座升級與共用改良回收

底座發布 Library 更新後，引用專案在相應的 `base-sync upgrade` PR 中先審查程式碼合併，再於 Screens 接受 Figma Library 更新。對受影響頁面重跑外掛預覽；新增或回到底座主色的 fill/stroke 會列為待補綁，已有專案色及私人覆寫保留。補綁後重檢並看受影響的 Button、側欄或其他代表元件；元件身分相同不代表已接受某次發布。將 Git tag、底座與專案 file key、Figma 發布版本、接受範圍及代表畫面結果記在升級 PR。純程式碼更新且 Figma 來源與範圍未變時，沿用仍有效的設計驗證，不重跑全檔。

專案新增可共用元件時，先確認不含專案品牌或業務依賴；程式碼用 `base-sync inspect` / `contribute` 提交到底座，Figma 主元件則經審查移入底座 Library、發布並登記版本。其他專案只透過正式底座版本及 Library 更新採用，專案 Screens 不整份回收。

外掛中斷或預覽狀態改變時，重新預覽當前檔案再套用；它依現值只列待變更位置，不靠上次操作序號。`SELECTION_EMPTY` 時改選「目前頁面」或先選取畫布物件。離線測試是 `node --test scripts/figma-local/code.test.mjs scripts/figma-local/export-brand.test.mjs`；Figma 實際發布與接受不由 CI 代辦。舊 `scripts/figma-sync/prepare.mjs` 與既有 `deploy/project/figma/receipts/` 只保留歷史用途；**新流程不建立或要求 receipt**。外掛限制與範例見 [figma-local README](../../scripts/figma-local/README.md)，設計規範見 [Figma 規範](../standards/general/figma.md)。

## 第三方依賴

不是每個套件都列:這裡只記**為了某個功能特地引進、選型有講究**的依賴(誰用、為什麼是它、授權)。版本一律 `npm view <pkg> version` 查 registry,不照記憶寫,並對齊既有同家族套件的主 / 次版本。

| 套件             | 版本(寫進 package.json) | 授權 | 誰用                                        | 用途                                                                   |
| ---------------- | ----------------------- | ---- | ------------------------------------------- | ---------------------------------------------------------------------- |
| `@xyflow/react`  | `^12.12.0`              | MIT  | `apps/admin`(流程設計器)                    | 畫流程圖(節點、連線、縮放);不開放自由拉線,節點是審核關卡卡片與匯合菱形 |
| `@dagrejs/dagre` | `^3.1.1`                | MIT  | `apps/admin`(`lib/workflow/flow-layout.ts`) | 流程圖自動直式排版,節點位置不讓使用者手擺                              |

- 兩者只在流程管理頁用,頁面懶載入,不進首屏 bundle。
- React Flow 在 jest(jsdom)要 `ResizeObserver` / `DOMMatrixReadOnly` 替身(`apps/admin/src/test/react-flow.ts` 的 `setupReactFlowEnvironment()`);點節點用 `fireEvent.click`(d3-drag 的指標事件在 jsdom 會炸)。
- 表單設計器的拖拉是 dnd-kit(`@dnd-kit/core`、`@dnd-kit/sortable`,MIT),測試替身在 `apps/admin/src/test/dnd-kit-double.tsx`。

正本:`apps/admin/package.json`

## Claude Code skill 對照表

`project-bootstrap` 在 `.claude/skills/` 與 `.agents/skills/` 都有版控入口,共用 [project-bootstrap.md](project-bootstrap.md) 的步驟;Claude 與 Codex 可各自接手新專案初始化,不依賴本機記憶或另一個工具。

「用哪個」欄是在 Claude Code 裡的呼叫名稱。三個外部 skill 的版控來源在 `.agents/skills/`(版本鎖在 `skills-lock.json`),Claude 入口 `.claude/skills/<名稱>/` 是未版控的連結。新 clone、底座升級後與初始化重跑均在 repo 根執行 `node scripts/project-settings/restore-claude-skills.mjs`;Windows 建 junction,其他系統建目錄 symlink。重跑會檢查既有連結,遇到同名但來源不同的內容會停止,不覆寫。repo 自製的 Claude skill 放在 `.claude/skills/<名稱>/`;Codex 的 `module-scaffold` 入口另在 `.agents/skills/module-scaffold/` 指向共同操作文件。

| 情境                                                 | 用哪個                                                        | 一句提醒                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 自己交件前掃一次 diff 的 bug                         | `/code-review`(內建)                                          | 可指定 PR 號或分支;`--fix` 會直接改工作目錄,文件票不需要                                                     |
| review 一張 PR 是否守規範、是否照票做                | `mattpocock-skills:code-review`                               | Standards / Spec 兩軸並行;給它比較的起點(如 `origin/main`)與票號,引用規則編號回報                            |
| 改完後清理重複、過度複雜的程式                       | `/simplify`(內建)                                             | 只管品質不找 bug;會直接套用修改,跑完重看 diff                                                                |
| 動到登入、權限、上傳、金鑰相關的程式                 | `/security-review`(內建)                                      | 針對目前分支的待合變更                                                                                       |
| 產生 CLAUDE.md                                       | `/init`(內建)                                                 | 本 repo 已有 `CLAUDE.md`,**不要跑**;要改入口文件開獨立文件票                                                 |
| 先寫紅燈測試再實作                                   | `mattpocock-skills:tdd`                                       | 測試只呼叫 spec 指定的接縫;api 打真的 `/graphql`(TEST-07)、admin 走 MSW(TEST-08)                             |
| 難纏的 bug、效能退化                                 | `mattpocock-skills:diagnosing-bugs`                           | 先重現再下手;先查 pitfalls,很多「壞掉」其實是快取或埠                                                        |
| 查官方文件 / API 事實                                | `mattpocock-skills:research`                                  | 它會在 repo 寫一份 Markdown,先講好路徑,不要混進本票 commit                                                   |
| 改 `CONTEXT.md` 詞彙或寫 ADR                         | `mattpocock-skills:domain-modeling`                           | 規則本文由文件票寫;新詞連 `_Avoid_` 一起寫                                                                   |
| 設計模組介面、決定接縫放哪                           | `mattpocock-skills:codebase-design`                           | 結論要寫回模組文件或規範,不留在對話裡                                                                        |
| rebase / merge 衝突                                  | `mattpocock-skills:resolving-merge-conflicts`                 | 衝突對象是還沒 release 的 feat 時改走疊分支,不要 rebase 到 `dev`(pitfalls)                                   |
| 新增後台 CRUD 模組(固定欄位)                         | `/module-scaffold`(repo 自製)                                 | 先選 `plan`(四輪問答 → 規格卡 → 可產 issue)或 `build`(照規格卡與 module-scaffold.md 實作);動態表單模組不適用 |
| 在動手前把計畫問到底                                 | `mattpocock-skills:grilling`                                  | 適合拆票前、裁決「二選一」前                                                                                 |
| 寫給 agent 看的文件(skill、`AGENTS.md`、`CLAUDE.md`) | `mattpocock-skills:writing-for-agents`                        | 每段附正本路徑                                                                                               |
| 只有人能做的步驟(建 Secret、第三方後台)              | `mattpocock-skills:wizard`                                    | 產出互動式腳本讓人跑;agent 不經手任何密碼 / 金鑰                                                             |
| 狀態模型或 UI 走向拿不定                             | `mattpocock-skills:prototype`                                 | 丟棄式原型,不進正式程式碼                                                                                    |
| 照 Figma 稿實作畫面                                  | `figma:figma-design-to-code`                                  | 呼叫 `get_design_context` 前必載;節點 id 給到列層級,規範 `docs/standards/general/figma.md`                   |
| 在 Figma 裡改稿、建元件                              | `figma:figma-use`(寫入前必載)+ `figma:figma-generate-library` | 動到品牌文字 / 色彩同步 `docs/branding.md`                                                                   |
| 把程式裡的頁面畫進 Figma                             | `figma:figma-generate-design`(搭配 `figma:figma-use`)         | 用設計系統的元件與變數,不要寫死數值                                                                          |
| mock 模式截圖、看畫面                                | `claude-in-chrome`                                            | 開自己的分頁、連自己起的埠;截圖前確認看得到本次改動                                                          |
| review 文件的文字                                    | `writing-guidelines`(repo 自帶)                               | 本 repo 另有「文件不寫日期、段落、票號」的通則(`docs/standards/general/structure.md`)                        |
| review UI 的可及性與介面慣例                         | `web-design-guidelines`(repo 自帶)                            | 結論引用 `docs/standards/react/` 的規則編號                                                                  |
| 寫 / review React 元件的效能                         | `vercel-react-best-practices`(repo 自帶)                      | 與 `docs/standards/react/` 衝突時以 repo 規範為準                                                            |

正本:`.agents/skills/`、`skills-lock.json`、`.claude/skills/`;內建與外掛 skill 以 Claude Code 當下列出的清單為準

## 派工模板(給無 session 的 agent)

主流程派工時複製下面這段,把 `<…>` 換掉。重點是讓 agent 只靠 repo + issue 就能做完。

```
你是無本地對話 session 的接手 agent,實作 GitHub issue <目前 repo>#<票號>(<一句話標題>)。以繁體中文工作與回報。

## 接手順序
1. 讀根目錄 CLAUDE.md → docs/agents/issue-tracker.md(SOP、交件報告格式)→ docs/agents/pitfalls.md → gh issue view <票號> --json title,body,comments(票面的「可改 / 不可改」嚴格遵守)。
2. 讀相關文件:<docs/modules/<key>.md、docs/concepts/<檔>、規範索引 docs/standards/README.md 裡相關的檔>。
3. 指令查 docs/agents/toolbox.md,與 package.json / workflow 對不上時以後者為準。

## 範圍
- 要做:<逐條;裁決寫死,不留二選一>
- 不可改:<檔案清單;CLAUDE.md 明確寫可改或不可改>
- 並行的票:<票號與它負責的檔案,避免撞檔>

## 分支 / 交件
- 你在獨立 worktree;git fetch origin && git checkout -b <feat|docs>/<票號>-<描述> origin/main(有依賴就從依賴票的分支切)。
- 開工:pnpm install;程式票依 docs/agents/toolbox.md「pnpm / turbo:建置、測試、格式」的建置前置步驟執行。看板移 In Progress、assign 自己。
- commit 訊息結尾照 session 提供的 attribution 行。
- PR base dev,內文含 Closes #<票號>,內文先寫成檔再 --body-file;看板票卡移 In Review。
- 不 merge、不動 main / dev / staging;不處理任何密碼 / 金鑰。

## 交件報告
PR 連結、改動檔案清單、測試結果(與基準比較)、截圖或 E2E 建議、文件與程式不合處、規則回饋、CI 狀態、接手體驗(找不到 / 矛盾 / 用猜的)。
```

正本:[issue-tracker.md](./issue-tracker.md)「實作一張票」與「交件報告格式」

## 批次 release(指路)

以下是已啟用雲端的流程;底座與停用雲端的專案依 [deployment](../deployment.md#release-步驟)以 CI、本機應用與資料驗收發布程式版本。

- 一批票各自合 `dev`、各自合 `staging`,累積後走一次 `staging → main` 的 release PR + 一次 production 部署;例外只有「產物依賴」才單獨先 release。
- 步驟:逐一合 `staging` → `gh workflow run Deploy --ref staging -f environment=staging` + smoke → release PR 合 `main` → `gh workflow run Deploy --ref main -f environment=production` + smoke → 對齊 `dev` / `staging` → 關票、刪已合併的遠端分支。
- 每一步的前置檢查與指令細節**只在 deployment.md 寫**,這裡不重複。

正本:`docs/deployment.md`(二、分支模型與 CI/CD 流程 → Release 步驟)

## 底座升級與回收

人員、Claude 與 Codex 共用同一 Node CLI，不需要另一個工具在線。`node scripts/base-sync/run.mjs --help` 或 `<命令> --help` 顯示用法，不需 repo 或網路；`-h` 同義。先核對本次 repo、正式版本與差異，依[deployment](../deployment.md#底座首次接軌與版本升級)整合與驗收，再沿既有 gh/PR 流程交付。

| 工作                 | 指令                                                                                                                           | 結果                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| 看完整差異與回收候選 | `node scripts/base-sync/run.mjs inspect --project <路徑> --from <commit> --to <commit>`                                        | 唯讀分類，候選仍需語意審查                   |
| 準備正式版本升級     | `node scripts/base-sync/run.mjs upgrade --project <路徑> --tag <版本> --worktree-root <父目錄>`                                | 隔離分支與未提交 merge；批次重複 `--project` |
| 準備共用改良回收     | `node scripts/base-sync/run.mjs contribute --project <來源路徑> --commit <完整SHA> --base <底座路徑> --worktree-root <父目錄>` | common-only contribution，不帶整個專案歷史   |
| 看累積未部署變更     | `node scripts/project-settings/preflight.mjs --environment <環境> --target <完整SHA>`                                          | 實際 app/DB 基準、累積差異與未核對事項       |
| 讀資料狀態 JSON      | `pnpm --silent --filter @repo/db-migrator run migrate:status --json`                                                           | 現有 plan/journal/lock 的唯讀投影            |

新 clone 沿用 `gh repo clone <owner/repo> <路徑>`，版本身分沿根 `package.json.wowgoBase`。CLI 的 JSON 報告不另作人工維護正本；不自動 push、開 PR、接受回收或部署。preflight/status 的 exit 0 只表示成功讀取或生成，須審查 issues 與資料恢復限制，不能當作部署核准。

正本：`scripts/base-sync/`、`scripts/project-settings/preflight.mjs`、`apps/db-migrator/src/update/`；操作與驗收：[deployment](../deployment.md#發布前環境與資料核對)。
