# 應用底座架構

多租戶應用底座,包含完整前台、後台與 API;專案的業務來源預設為空。Turborepo monorepo(pnpm workspace),workspace 套件名一律 `@repo/` 前綴(GEN-06)。

## Apps

| App                 | 技術                                                              | 用途                                                                                                                                                            | Port              |
| ------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `@repo/api`         | NestJS + GraphQL(Apollo / Express,code-first)+ Mongoose + MongoDB | 後端 API,front 與 admin 都打這個服務                                                                                                                            | 5001              |
| `@repo/front`       | Next.js(App Router)                                               | 前台。SEO 頁面走 Server Component + ISR,不使用 Next API Routes                                                                                                  | 3002              |
| `@repo/admin`       | Vite + React SPA                                                  | 後台管理,不需 SEO                                                                                                                                               | 3001              |
| `@repo/storybook`   | Storybook(react-vite)                                             | 設計系統目錄 + Palette Lab;元件的 stories 住在 `packages/ui`                                                                                                    | 6006              |
| `@repo/db-migrator` | migrate-mongo + update / reset runner                             | 資料庫遷移、種子、還原工具;不部署、不常駐,CI 在部署 api 後呼叫(ADR-0002)                                                                                        | —                 |
| `@repo/e2e`         | Playwright(只裝 chromium)                                         | 權限劇本的 E2E(`docs/testing/permission-scenarios.md`);不部署,**只手動觸發**(`pnpm e2e` / `e2e.yml`,TEST-05);harness 自己起 Mongo → update → api → admin 靜態檔 | 5101 / 4301(可改) |

### 技術棧版本

下表只列主版本,確切版本以各 `package.json` 為準。

| 類別     | 套件                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 執行環境 | Node 22(CI / 部署;`engines` 下限 20)、pnpm 10、Turborepo 2、TypeScript 5.9                                                             |
| 後端     | NestJS 11、`@nestjs/graphql` 13、Apollo Server 5、graphql 16、Mongoose 9、migrate-mongo 14                                             |
| 前端     | React 19、MUI 9、Vite 8、Next.js 16、React Router 8、TanStack Query 5、TanStack Table 9、graphql-request 7、`use-intl` / `next-intl` 4 |
| 工具     | Storybook 10、Jest 30、Playwright 1、ESLint 9、Prettier 3、bunchee 6                                                                   |

## Packages

| Package                                                                                            | 用途                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@repo/graphql`                                                                                    | GraphQL codegen 共用套件:讀 `apps/api/schema.gql` + `src/documents/{base,project}/**/*.graphql`,產生 TypeScript 型別與 TanStack Query hooks(fetcher 為 graphql-request),front / admin 共用                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `@repo/ui`                                                                                         | 設計系統:兩層 tokens(`src/theme/`:品牌層由呼叫端以 `createBrandFromPrimary` 傳入名稱與主色,`brands/default.ts` 是不讀專案設定的通用預設;加上語意層)、`createAppTheme`(MUI cssVariables、light / dark)、共用元件(元件 + 測試 + story 三件套同居),另含模組圖示白名單 `@repo/ui/icons` 與 `@repo/ui/module-icon-picker`。**子路徑清單不在此列舉**,正本是 `packages/ui/package.json` 的 `exports`(STRUCT-08 第 5 點)                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `@repo/logger`                                                                                     | 共用 logger(全 repo 唯一可用 `console` 的地方,其他地方被 `no-console` 擋)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `@repo/i18n`                                                                                       | 多語訊息檔(`messages/<locale>/<namespace>.json`)+ locale 定義;front 以 `next-intl`、admin 以 `use-intl` 消費(同生態);規範見 `standards/general/i18n.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `@repo/domain`                                                                                     | 前後端共用純邏輯(STRUCT-07)。子路徑:`/permission` 權限 key 與矩陣、`/password` 密碼規則、`/module-icon` 圖示白名單、`/form` 表單型別/驗證/表達式/摘要、`/form-regex-safety` 可按需載入的 ReDoS 檢查、`/form-keys` 不帶表達式依賴的輕量格式檢查、`/workflow` 流程型別/驗證/推進判斷、`/seed` 種子契約/可攜性驗證/穩定 hash/TypeScript 匯出。bunchee 輸出雙格式,api 走 cjs + `typesVersions`,admin 走 es;表單的 `regexSafety` 由呼叫端注入,admin 設計器懶載入。新增子路徑同步本列(STRUCT-08)。                                                                                                                                                                                                                                                                                                                                                                                          |
| `@repo/project-config`                                                                             | 專案公開設定:`@repo/project-config/public`(`projectPublic`:slug、品牌名、主色、admin HTML title、前台 metadata、側欄舊鍵;`createAdminStorageKeys(slug)` 生成 admin 的瀏覽器儲存鍵;admin / front / Storybook 使用,可進瀏覽器)、`@repo/project-config/mail`(`projectMail`:寄件信箱、署名、品牌名;只給 api,不進瀏覽器、不含機密)。`src/base/` 是底座維護的契約、驗證與純函式,`src/project/` 是專案值;沒有匯總所有值的根出口,`/public` 不依賴 `/mail`、環境讀取或 Node API,`@repo/ui` 與 `@repo/i18n` 不反向依賴它。bunchee 雙格式:api 走 cjs + `typesVersions` 且放在 `dependencies`(image 建置後只裝正式依賴),admin / front / Storybook 走 es;Vite 設定檔載入時就會讀它的 dist,沒 build 會直接啟動失敗:admin 的 `dev:mock` script 自己先 build 本套件;其餘直接啟動(admin `dev`、Storybook `dev`)走 root 的 `turbo dev`(依賴先 build),或先 build 該 app 的依賴。**新增子路徑要補進本列** |
| `@repo/eslint-config` / `@repo/prettier-config` / `@repo/typescript-config` / `@repo/jest-presets` | 共用開發設定(單一入口,各 app 不自訂規則)。jest-presets 三種:`node`(純邏輯 / api)、`browser`(純元件庫 `ui`)、`browser-esm`(admin:jsdom + MSW 需要的 Node 全域 + ts-jest ESM,TEST-08)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## 品質約束(三層)

1. **機器強制**:ESLint(typescript-eslint strictTypeChecked + import-x + unicorn + sonarjs + jsx-a11y,入口 `@repo/eslint-config`)、TS strict(含 `noUncheckedIndexedAccess`)、Prettier(`@repo/prettier-config`,@trivago import 排序)。`only-warn` + `--max-warnings 0`:編輯器顯示警告,CI / CLI 全擋。
2. **可審查清單**:`docs/standards/`(編號規則 GEN / STRUCT / REACT / STYLE / DATA / GQL / I18N / TEST / FIGMA)+ vercel-labs skills(`.agents/skills/`)。
3. **原則層**:`CLAUDE.md`。

## 資料流

```
瀏覽器 ── front (Next.js SSR/ISR, SEO) ──┐
瀏覽器 ── admin (Vite SPA) ──────────────┤──> api (NestJS GraphQL :5001/graphql) ──> MongoDB(本地 Docker :27017 / 雲端 Atlas)
        (TanStack Query + graphql-request hooks 來自 @repo/graphql)
```

## 型別打通流程(codegen)

1. `api` 使用 code-first,由真 AppModule 組裝底座與專案;GraphQLModule 在啟動時輸出 `apps/api/schema.gql`(`NODE_ENV=test` 除外)。只重產不開服務用 `pnpm --filter @repo/api schema:generate`;新工作樹先依 [toolbox](agents/toolbox.md#pnpm--turbo建置測試格式)建置依賴
2. `packages/graphql/src/documents/{base,project}/**/*.graphql` 定義前端要用的 query / mutation
3. `pnpm --filter @repo/graphql generate` 先驗兩區文件,再產生唯一的 `src/generated/index.ts`(型別 + hooks);operation 與 fragment 的名稱各自全域唯一,不靠載入順序覆寫
4. front / admin import `@repo/graphql` 取得型別安全的 hooks(如後台使用的 `useModuleTreeQuery`)

後端 schema 變更後依序跑步驟 1 與 3,兩份產物同一個 commit(GQL-05;CI 的 `format-codegen` job 會擋)。

## 底座與專案的維護歸屬

| 範圍                 | 底座維護                                            | 專案維護                                                    |
| -------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| 權限、租戶與治理     | 登入、RBAC、隔離、治理 API、後台殼與守門            | 品牌、模組宣告及客製頁                                      |
| 表單、審核與申請中心 | 引擎、共用型別及預設畫面                            | 表單模組的頁面與 options 宣告                               |
| UI 與文案            | 共用元件、語意 tokens、色盤算法、中性預設與共用訊息 | 品牌值、前台畫面與風格、業務文案和資產                      |
| 稽核、儲存與寄信     | 服務機制及共用模板                                  | bucket、網址、寄件識別與外部資源                            |
| 功能與資料           | 組裝、repository 基礎、組織資料檢查、示範藍本       | project 來源中的頁面、API、schema、repository、GraphQL 文件 |
| 工具與部署           | 共用規範、測試工具、設定讀取器及 workflow           | 依賴擴充、專案測試、repo／看板／雲端／環境設定              |
| Figma 同步           | 品牌投影、本機外掛與底座共用 Library                | 品牌值、Brand Library、Screens 與客製內容                   |

上表是 repo 內容的維護歸屬;人員、角色授權、租戶分派、綁定與業務資料由各環境管理。專案值的正本見[初始化索引](project-initialization.md)。`project-config` 是 build 輸入,不讀 `process.env`、瀏覽器全域或遠端服務;公開欄位的型別與驗證在 `packages/project-config/src/base/public-config.ts`。前台自行設計版型與風格,可選用共用 UI,不要求接後台主題。示範程式是底座藍本,專案業務另建模組。

底座以正式 annotated tag 與 GitHub Release 交付,引用專案的採用版本記在 `package.json.wowgoBase`。`scripts/base-sync/` 準備隔離升級/回收分支與差異報告,不改變上述歸屬或自動接受內容。向下升級保留共同祖先,向上回收只移植經審查的共用改良;操作與驗收見 [deployment](deployment.md#底座首次接軌與版本升級)。發布前讀取實際應用/資料狀態,不另存人工環境版本帳。

Figma 品牌同步讀取 `packages/project-config/src/project/public.ts` 的 `projectPublic.brand`,沿用 `@repo/ui` 的色盤與陰影函式,不另填六色色票。本機 Figma 外掛在專案 Brand Library 建立六色與陰影,在獨立 Screens 檔補綁底座主色變數;畫面使用遠端底座元件,文字、商標與私人覆寫留給專案。Library 的發布、接受與陰影樣式換庫由 Figma 原生介面完成,結果記於初始化或升級 PR,不生成 receipt。底座升級保留專案 Figma 資源與客製;操作見 [toolbox](agents/toolbox.md#figma-品牌同步),資產身分見[品牌註冊表](branding.md)。

### 功能來源與組裝

後台頁面在各層分 `base` 與 `project`,由 `app/module-pages.tsx` 組裝;頁面新增與替換分開登記,底座原版保留。Help 由 `lib/help-registry.ts` 讀底座、專案新增、專案替換三區。API 功能與資料分別經 AppModule、DatabaseModule 組裝,專案來源在 `src/project/`;新增租戶 model 的 repository 與組織資料檢查一起登記。登記不授權,既有路由及 API 守門仍生效。

頁面、表單設定及 help 見[前端架構](concepts/frontend-architecture.md),API 登記與碰撞檢查見[資料層組裝](concepts/data-layer-and-isolation.md#底座與專案資料的組裝),固定入口與 import 方向見 STRUCT-12。新增模組照 [module scaffold](agents/module-scaffold.md)。

## 部署

三環境:`dev` → dev、`staging` → staging(預發布)、`main` → production。底座預設停用雲端與看板;引用專案啟用後,api / admin 由 `deploy.yml` 手動部署至 Cloud Run,front 可接 Vercel,資料庫可用 MongoDB Atlas。設定、資源與 release 步驟見 `docs/deployment.md`。

## 本地開發

```bash
docker compose up -d        # 啟動 MongoDB
pnpm install
pnpm dev                    # turbo 同時啟動 api / front / admin / storybook
pnpm --filter @repo/storybook dev   # 只開設計系統(http://localhost:6006)
```

執行前先依各 app 的 `.env.example` 建立自己的 `.env`;已有檔案時核對內容,不要覆寫。API 的 `MONGODB_URI` 必填,缺值、空字串或純空白都會在連線 factory 拒絕,不使用內建 DB 預設。schema 產生器與測試 harness 自行提供隔離 URI。

根 `.env.example` 提供 Compose 的 `LOCAL_MONGO_PORT`、`LOCAL_API_PORT`、`LOCAL_ADMIN_PORT`、`LOCAL_MONGO_DB`;複製為根 `.env` 後可覆寫。`COMPOSE_PROJECT_NAME` 決定容器、網路與 volume 前綴,新專案使用獨立名稱;既有專案保留原名與 `mongo-data` volume key,避免改接空庫。API 在主機執行時,其 `.env` 的 URI 必須對應 host port 與 DB;根 `.env` 不會自動替 API 設定連線。`--profile full` 的 admin build endpoint 會跟隨 host API port。變數清單見 `docs/env-registry.md`,新專案逐項檢查見[初始化索引](project-initialization.md#本機與測試環境)。

## 技術選型

尚未寫成 ADR 的選型與理由(已寫成 ADR 的在 `docs/adr/`):

- **MongoDB + Mongoose**(`@nestjs/mongoose`):文件模型可保存巢狀業務資料與表單/流程定義;Mongoose 的 schema、plugins 與 repository 組成目前資料層,遷移使用 migrate-mongo。
- **graphql 固定在 v16**:Apollo Server 5 與 `@nestjs/graphql` 13 不支援 graphql 17。
- **front 不用 Apollo Client**:SEO 頁面在 Server Component 用 `useXxxQuery.fetcher` 直接抓;瀏覽器端互動用 TanStack Query hooks。
- **codegen 產物修正**:`typescript-react-query` plugin 會產生 graphql-request v4 的型別路徑,`packages/graphql/scripts/fix-generated.mjs` 在 generate 後自動修正。
- **程式碼是設計的唯一真實來源**:設計系統先存在於 `@repo/ui`(tokens + MUI theme + 元件),Figma 是它的投影。品牌同步沿用程式的品牌推導,共用元件的原生發布與接受另行驗證;不買現成 Figma kit 或模板。
- **設計風格走 Minimal 方向**:以 MUI theme 客製(柔和陰影、大圓角、冷灰階)重現,不購買模板。
- **版本統一**:同一套件全 repo 同一版本(見上面「技術棧版本」);已知例外 `eslint-plugin-unicorn` 釘 65(最後支援 ESLint 9 的版本)。
- **TS 編譯目標統一**:`@repo/typescript-config` 各範本一律 `lib` ES2024、`target` ES2022(執行環境 Node 22 與現代瀏覽器都支援;不用 `ESNext`,因為它隨 TS 版本變動),各 app / package 不自訂這兩項,只補 `DOM` 之類的環境差異。
- **apps 不直接 import MUI / Emotion,一律經 `@repo/ui`**:由 `@repo/eslint-config` 的 `designSystemWall`(`no-restricted-imports`)在 vite / next 設定裡強制(STYLE-05);缺的元件先到 `packages/ui` 包一層。
