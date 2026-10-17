# 十分鐘掌握底座

wowgo-base 是多租戶應用底座,提供完整 front、admin、api,以及治理、權限、表單、審核流程和示範模組。引用專案在自己的 repo 維護品牌與業務。本頁是文件的入口:先看系統地圖,再看七個核心概念,最後照你的角色挑一條閱讀路線。

## 系統地圖

Turborepo monorepo(pnpm workspace),套件名一律 `@repo/` 前綴。

| 位置                                         | 做什麼                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `apps/api`                                   | NestJS + GraphQL + MongoDB;front 與 admin 都打它                                                       |
| `apps/admin`                                 | Vite + React SPA 後台;殼、治理模組、表單引擎、審核流程、申請中心、示範模組                             |
| `apps/front`                                 | Next.js 前台(SEO、ISR)                                                                                 |
| `apps/db-migrator`                           | 遷移、種子、還原(reset)工具;不部署,部署 api 後由 CI 呼叫                                               |
| `apps/e2e`                                   | Playwright 權限劇本;只手動觸發                                                                         |
| `apps/storybook`                             | 設計系統目錄;stories 住在 `packages/ui`                                                                |
| `packages/ui`                                | 設計系統:tokens、主題、共用元件                                                                        |
| `packages/graphql`                           | 讀 api 的 schema 產生型別與 TanStack Query hooks                                                       |
| `packages/domain`                            | 前後端共用純邏輯:權限 key 與矩陣、密碼規則、模組圖示白名單、表單定義 / 計算 / 檢查器、流程定義與檢查器 |
| `packages/i18n`                              | 多語訊息檔                                                                                             |
| `packages/project-config`                    | `/public`:admin / front / Storybook;`/mail`:僅 api。專案維護值,底座維護契約與讀取接線                  |
| `packages/logger`                            | 共用 logger(唯一可用 `console` 的地方)                                                                 |
| `packages/config-*`、`packages/jest-presets` | ESLint / Prettier / TypeScript / Jest 共用設定                                                         |

正本:`docs/architecture.md`、根目錄 `package.json`、`pnpm-workspace.yaml`;專案值與底座契約的歸屬見[架構](architecture.md#底座與專案的維護歸屬),設定位置見[初始化索引](project-initialization.md)。

## 七個核心概念

**1. 租戶與組織。** 組織是一棵樹。根組織是平台營運方;根的直接子組織是一個租戶,底下可再分部門或分店。組織是所有租戶資料的隔離邊界。開通租戶會一次建好租戶頂層、角色副本與首任管理員。
正本:`docs/concepts/accounts-and-tenants.md`、`apps/api/src/orgs/`

**2. 使用者與帳號。** 使用者(後台)與會員(前台)是兩套帳號,分表、分登入、分 token。使用者可屬多個組織,同一時刻以一個「當前組織」操作。當前組織只決定新資料寫到哪,不參與權限。
正本:`docs/concepts/accounts-and-tenants.md`、`apps/api/src/auth/`

**3. 角色與權限。** 模組 = 頁面,權限 = 頁面裡的按鈕 / 欄位。角色綁模組就進得去,綁權限就用得了。`X.*` 只涵蓋同一層。解析是純加法的聯集,每次請求現查。只能授出自己有的(防越權)。
正本:`docs/concepts/authorization.md`、`apps/api/src/permission/permission-resolver.ts`

**4. 資料範圍與可見範圍。** 新增專案租戶資料經 BaseRepository,自動加上「組織 ∈ 範圍」;底座專用資料介面由固定資料層管理。業務資料看**可見範圍**(所屬組織 + 可見性開關);治理頁看**管理範圍**(持有角色的擁有組織子樹)。資料範圍規則在可見範圍內再縮小。
正本:`docs/concepts/data-layer-and-isolation.md`、`apps/api/src/database/plugins/tenant-scope.plugin.ts`

**5. 設定資料。** 模組、權限、種子角色、欄位選項,以及明確登記的共用表單與流程,由 TypeScript seed 交付到各環境。普通設定以 key 同步,表單與流程沿版本生命週期發布。業務資料不跨環境搬。
正本:`docs/concepts/data-layer-and-isolation.md`「種子資料與遷移」、`apps/db-migrator/seeds/`

**6. 稽核與儲存。** 模組層把變更寫進只增不改的 `audit_logs`。檔案由瀏覽器直傳 GCS,DB 存路徑、看時現簽;交易信件走 Resend。
正本:`docs/concepts/authorization.md`「稽核」、`docs/concepts/storage-and-mail.md`、`apps/api/src/audit/`、`apps/api/src/storage/`

**7. 表單模組與審核流程。** 欄位由使用者在後台設計的模組走表單引擎:表單版本化發布,提交綁版本、每次修改留完整修訂;表單可綁審核流程,送出後由流程實例推進關卡,申請人與審核者在申請中心操作。共用定義可納入專案 seed;租戶客製內容、分派與綁定仍在各環境獨立管理。
正本:`docs/concepts/form-engine.md`、`docs/concepts/workflow-engine.md`、`apps/api/src/forms/`、`apps/api/src/workflows/`

## 閱讀路線

| 你是     | 照這個順序讀                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新手     | 本頁 → `CONTEXT.md` + `CONTEXT-PROJECT.md`(詞彙)→ `docs/concepts/` 七份(順序見下)→ 感興趣的 `docs/modules/<key>.md`                                           |
| 開發者   | 新手路線 → `docs/standards/README.md`(只載入相關規範)→ `docs/agents/module-scaffold.md`(新增模組;要人機問答出規格卡用 `/module-scaffold`)→ 需要理由時讀 ADR   |
| AI agent | 新手路線 → `docs/agents/collaboration.md`(分工與接手)→ `docs/agents/toolbox.md`(工具與環境)→ `docs/agents/issue-tracker.md`(票與 PR 流程)→ 依改動範圍載入規範 |

concepts 的順序:`accounts-and-tenants` → `authorization` → `data-layer-and-isolation` → `storage-and-mail` → `frontend-architecture` → `form-engine` → `workflow-engine`。

正本:`docs/agents/domain.md`「概念導讀」

## 文件目錄

| 文件                                                                                        | 是什麼                                           | 什麼時候讀                 |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------- |
| `CLAUDE.md`                                                                                 | 分支流程、規範入口、文件地圖                     | 第一次進 repo              |
| `CONTEXT.md`                                                                                | 底座詞彙表                                       | 寫文件、命名、開票前       |
| `CONTEXT-PROJECT.md`                                                                        | 專案詞彙表(只新增,不重新定義底座名詞)            | 寫文件、命名、開票前       |
| `docs/README.md`                                                                            | 本頁                                             | 入口                       |
| `docs/concepts/accounts-and-tenants.md`                                                     | 帳號、組織樹、租戶開通、擁有者保護               | 動登入、使用者、組織       |
| `docs/concepts/authorization.md`                                                            | 模組、權限、解析流程、防越權、稽核               | 動權限、角色、任何守門     |
| `docs/concepts/data-layer-and-isolation.md`                                                 | 三類資料、租戶隔離、兩種範圍、資料範圍、種子     | 動資料層、查詢、seed       |
| `docs/concepts/storage-and-mail.md`                                                         | GCS 上傳與讀取、寄信                             | 模組要存檔或寄信           |
| `docs/concepts/frontend-architecture.md`                                                    | admin 分層、殼、路由、頁籤、共版型、快取         | 動 admin 前端              |
| `docs/concepts/form-engine.md`                                                              | 表單模組、版本、分派、提交、欄位級權限、引擎零件 | 動表單模組或表單引擎       |
| `docs/concepts/workflow-engine.md`                                                          | 審核流程、綁定、實例與推進、阻擋、申請中心       | 動審核流程或申請中心       |
| `docs/adr/`                                                                                 | 決策與理由(12 份)                                | 想知道「為什麼這樣做」     |
| `docs/data-model.md`                                                                        | collection 地圖                                  | 找某張表的用途與 schema 檔 |
| `docs/architecture.md`                                                                      | 技術棧、port、品質約束                           | 設定開發環境               |
| `docs/modules/<key>.md`                                                                     | 各模組的權限表、api 介面、畫面                   | 動某個模組                 |
| `apps/admin/src/md/module-help/{base,project/additions,project/replacements}/<key>.help.md` | 租戶使用者看的模組說明                           | 改模組的使用者文案         |
| `docs/standards/README.md`                                                                  | 程式碼規範索引(規則編號)                         | 寫或 review 程式碼         |
| `docs/testing/permission-scenarios.md`                                                      | 29 條權限驗收劇本                                | 驗收、寫 E2E               |
| `docs/testing/handover-quiz.md`                                                             | 接手自測題                                       | 讀完文件後自我檢查         |
| `docs/agents/toolbox.md`                                                                    | agent 的工具與環境須知                           | AI agent 開工前            |
| `docs/agents/collaboration.md`                                                              | Claude、Codex 與人員共用的分工、工作樹與接手規則 | 派工、恢復或換手           |
| `docs/agents/issue-tracker.md`                                                              | issue、看板、PR 的流程                           | 開票、接票、交件           |
| `docs/agents/pitfalls.md`                                                                   | 指令與流程的已知坑                               | 指令跑出怪現象時           |
| `docs/agents/module-scaffold.md`                                                            | 新增 CRUD 模組的檔案清單與步驟                   | 新增模組                   |
| `docs/agents/domain.md`                                                                     | 領域文件怎麼用、概念導讀                         | 探索 codebase 前           |
| `docs/agents/triage-labels.md`                                                              | triage 標籤                                      | 分類 issue                 |
| `docs/deployment.md`                                                                        | 部署、release、分支對齊、reset                   | 部署或 release             |
| `docs/env-registry.md`                                                                      | 環境變數登記                                     | 新增或改環境變數           |
| `docs/branding.md`                                                                          | 品牌文字、色彩、網域、儲存鍵登記                 | 動品牌元素或儲存鍵         |
| `docs/agents/project-bootstrap.md`                                                          | 建立引用專案與接續初始化的共用操作               | 新專案初始化               |
| `docs/project-initialization.md`                                                            | 初始化設定的正本索引與驗證責任                   | 建立專案與核對初始化設定   |
| `docs/tmp/dis.md`                                                                           | 底座進行中討論與待辦                             | 查尚未定案的事             |
| `docs/tmp/project-dis.md`                                                                   | 專案進行中討論與待辦                             | 查尚未定案的事             |

正本:`docs/` 目錄本身;新增文件時在本表補一行。
