# 專案初始化索引

本索引指出新專案要設定的內容、值的正本與驗證責任,不保存第二份設定值。維護歸屬見[架構](architecture.md#底座與專案的維護歸屬),品牌與部署設定分別見 [branding](branding.md) 與 [deployment](deployment.md#專案部署設定deployproject)。建立與接續初始化依[共用操作文件](agents/project-bootstrap.md);跨專案升級與回收依[部署操作](deployment.md#底座首次接軌與版本升級)。

狀態必須分開記錄:「已提供」表示輸入已完整;「已建立」表示檔案或外部資源已存在;「已驗證」表示該專案的實際讀取或連線檢查通過。來源設定不代表新專案已具備資源,以下不替未建立的專案填入成功狀態。

## 採用的底座版本

引用專案在根 `package.json` 的 `wowgoBase` 記錄底座 Git URL、正式 tag 與完整 commit;初始化及升級在同一 PR 更新,並核對該 commit 確實是專案祖先。底座 repo 自己不填此欄位。格式與 Git 操作見[初始化操作](agents/project-bootstrap.md#3-寫入專案值),升級見 [deployment](deployment.md#底座首次接軌與版本升級)。

## 品牌與公開設定

| 項目                                                            | 現有正本                                                                                         | 初始化驗證                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 名稱、主色、HTML title、前台 metadata、穩定識別(slug)與側欄舊鍵 | `packages/project-config/src/project/public.ts`(逐項登記於 `docs/branding.md`)                   | `@repo/project-config` 的測試通過(格式驗證與專案值);admin、Storybook、front 讀到專案值;slug 不因顯示名稱修改而變動 |
| 信件寄件信箱與署名                                              | `packages/project-config/src/project/mail.ts`                                                    | api 的信件測試通過(四類信件與 Resend 的 from);寄件網域在 Resend 的驗證屬外部資源,見下節                            |
| 瀏覽器儲存鍵                                                    | 由 slug 生成(`packages/project-config/src/base/admin-storage-keys.ts`),清單見 `docs/branding.md` | 新專案的 `legacySideNavStorageKey` 為 null;不讀寫其他專案留在瀏覽器的鍵                                            |
| 前台業務文案                                                    | `packages/i18n/messages/<locale>/front.json`(`meta` 以外;`meta` 由專案設定注入)                  | 支援語系完整,文案符合專案                                                                                          |
| 前台風格與 favicon                                              | `apps/front/src/app/[locale]/styles.css`、各 app 的 public 目錄                                  | 資產可讀,前台風格由專案決定                                                                                        |

專案值集中在 `packages/project-config/src/project/`:底座維護同套件 `src/base/` 的契約、驗證與各 app 的讀取接線,底座升級不覆寫專案值。換專案只改 `src/project/public.ts` 與 `src/project/mail.ts` 兩個值檔,共用測試不需要改:讀正式設定的測試只驗通用契約,既有專案的歷史值另以固定夾具驗。品牌名與 metadata 照寫原文,不必懂 ICU 語法(注入字典時自動編碼)。本節只指路,不貼設定值;上表的驗證只涵蓋本機測試與 build,部署後的畫面與信件仍依發布流程驗收。

## 功能與專案內容

底座與專案分來源登記,由固定入口組裝;建立專案時新增或修改 project 來源,不覆寫底座原檔。頁面與資料契約見[前端架構](concepts/frontend-architecture.md)及[資料層組裝](concepts/data-layer-and-isolation.md#底座與專案資料的組裝)。

| 項目         | 專案來源                                                                      | 初始化與升級驗證                                                                                                 |
| ------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 後台新增頁   | `apps/admin/src/pages/project/`、`app/project/module-pages.ts`                | 與 `app/base/module-pages.ts` 一起組裝;固定頁與表單展開頁均驗 key,新增不碰底座清單                               |
| 客製治理頁   | `apps/admin/src/app/project/page-replacements.ts` 與 `pages/project/`         | 指定既有底座頁,原頁保留;同網址、授權與頁籤守門不變,省略 minWidth 繼承原版                                        |
| 表單模組設定 | 專案 module-pages 來源的 `forms`                                              | options 與四頁同一來源,經 RootProviders 注入;不同組裝互不污染,不寫全域 Map                                       |
| 模組說明     | `apps/admin/src/md/module-help/project/additions/`、`project/replacements/`   | 新增與替換分開,無替換則沿用底座;重複/未知/空白替換拒絕,三區真 build 與 help bundle check 通過                    |
| API 功能     | `apps/api/src/project/api-modules.ts`、`project.module.ts`、`project/<業務>/` | 真 AppModule 掛入普通 ProjectModule;feature key/module identity 不撞底座,核心 guards 不變                        |
| API 資料     | `apps/api/src/project/database/registrations.ts` 及該目錄的 schema/repository | 新租戶 model 的 schema、repository、org check 一起登記;驗 plugin、識別與實際綁定,資料不能漏掉刪組織/撤銷開通檢查 |
| GraphQL 文件 | `packages/graphql/src/documents/project/`                                     | 與 base 文件生成同一份型別/hooks;operation 名稱與 fragment 名稱各自全域唯一,拒絕匿名、根目錄散檔及 symlink       |
| 前台業務     | `apps/front/src/app/`、`components/` 及專案前台文案                           | 依專案設計完整畫面與風格;新增或替換業務內容時,一併核對 API 與 documents                                          |

API 的新租戶資料遵守 BaseRepository、baseFields 與 tenantScope 契約,不自行注入 raw Model 或繞過資料隔離。底座的 project 功能與資料登記預設為空,新模組沿既有租戶資料契約登記。底座不提供核心 module/provider 替換介面。

功能登記不會寫入授權或建立 seed 模組;仍須依[新增模組流程](agents/module-scaffold.md)完成 seed 宣告。前台目前是中性首頁,業務畫面與風格由專案設計;只換品牌不等於完成業務功能。

GraphQL 的 `generate` 在寫產物前檢查兩份文件來源,負例驗證使用 `pnpm --filter @repo/graphql test:documents`;schema 從真 AppModule 生成。建置前置與指令順序見 [toolbox](agents/toolbox.md#codegen-與資料庫本機)。

## 部署與工具識別

| 項目                                                 | 現有正本                                                                                   | 初始化驗證                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Repo、Actions 與看板識別                             | `deploy/project/github.json`(`expectedRepository`、`projectStatus`)                        | 讀取器 github scope 以新 repo 身分解析成功;新 repo 有實際 CI run;不用看板時 `projectStatus.enabled` 設為 `false` |
| 標籤與流程                                           | `docs/agents/issue-tracker.md`、`.github/workflows/project-status.yml`                     | 新看板的狀態選項與流程對得上;`GH_PROJECT_TOKEN` 與預設分支另行設定                                               |
| GCP/WIF、registry、Cloud Run、Secret 名稱、seed 帳號 | `deploy/project/cloud.json`;說明見 `docs/deployment.md`「專案部署設定」                    | 讀取器 cloud scope 三環境解析成功;目標為新專案,部署身分與執行身分的權限分別核對                                  |
| API 非機密執行期設定                                 | `deploy/env/*.yaml`、`docs/env-registry.md`                                                | 每環境都有適合的網域、bucket、開關及其他必要值                                                                   |
| Secret 值                                            | `docs/env-registry.md` 所列 Secret Manager / GitHub Secrets                                | 啟用雲端的四類必需 Secret 各有可讀版本;寄信未啟用時 `resendApiKey: null`;值不回寫文件、repo 或公開設定           |
| Vercel front/Storybook                               | `docs/deployment.md`                                                                       | 專案、root directory、build 與各環境 endpoint 均已設好                                                           |
| DNS、Resend、GCS、資料庫                             | `docs/deployment.md`、`docs/env-registry.md`                                               | DNS/寄件網域、bucket IAM/CORS、DB 帳號與環境隔離逐項驗證                                                         |
| 設定讀取與驗證                                       | `scripts/project-settings/`(`read-config.mjs` 兩個入口、測試);CI 的 `project-settings` job | `node --test scripts/project-settings/*.test.mjs` 通過;以新專案的 repo 名稱跑兩個入口都成功                      |

本節每一項要分三種狀態記錄,互不代替:

- **已提供**:兩份 JSON 填的是新專案的值(repo、GCP 專案、服務名、網址、Secret 名稱、看板 ID),讀取器解析成功。這只證明檔案內容完整、格式正確。
- **已建立**:GCP 專案、Artifact Registry、WIF pool / provider、部署用 service account 與 IAM、Cloud Run 服務與網域對應、Secret Manager 的各個 secret、GitHub 看板與 `GH_PROJECT_TOKEN`、預設分支,都由初始化工作在外部建立;設定檔不會建立任何資源。Cloud Run 服務與網域對應可在首次部署後建立,未建立時照實記錄。
- **已驗證**:新 repo 有實際 Actions CI run;啟用的環境先核對 preflight,再以新專案實際跑過 Deploy(認證、build、部署、update)與看板移卡。首次空環境的 `CLOUD_STATUS_UNAVAILABLE` / `DATA_BASELINE_MISSING` 要核實原因並記錄,不直接當成部署失敗。讀取器與離線測試通過不算部署已驗證。

新專案複製 repo 後,`expectedRepository` 不符會使 workflow 在認證前失敗。外部資源須另行建立;新專案使用自己的密鑰,不可沿用來源專案的值。不使用的整合須明確停用或移除專案引用,避免讀寫原專案目標。尚未啟用雲端時,`cloud.json` 只保留 `schemaVersion: 1` 與 `enabled: false`;CI 可驗設定,Deploy/Reset 在認證前停止。這表示停用狀態已驗證,不代表雲端資源已建立。格式與啟用方式見 [deployment](deployment.md#專案部署設定deployproject)。

## 本機與測試環境

- 根 `package.json` 名稱、各 app `.env.example` 與未追蹤的本機 `.env` 必須按專案設定;範例不含真正憑證。
- 根 `.env.example` 是 Compose 設定範本。新專案的根 `.env` 指定獨立 `COMPOSE_PROJECT_NAME`、`LOCAL_MONGO_DB` 及三個 `LOCAL_*_PORT`;容器、網路與 `mongo-data` volume 由 Compose 依專案名管理。既有專案維持原專案名與 volume key,不能因調整而改接空庫。離線 `docker compose config` 可核對渲染結果,實際啟動/停止的隔離另行驗證。
- API 與受管定義 CLI 的 `MONGODB_URI` 必填,沒有本地 fallback。主機執行 API 時,在其 `.env` 對齊 Compose host port/DB;db-migrator 也要明確指定同一目標。reset 核對操作者指定的環境、實際 DB 名稱與模式,不以名稱尾碼推測環境。
- E2E 在自己的 `.env` 設定 `E2E_COMPOSE_PROJECT`、DB 名、API/admin/GCS port 與 bucket namespace。fake GCS up/down 都以 `-p` 指定該名稱,不受 shell 的 `COMPOSE_PROJECT_NAME` 蓋過;Compose 檔的 name 使用相同 E2E 變數作為直接執行時的預設。
- 測試環境變數與命令見 `docs/agents/toolbox.md`、`apps/e2e/.env.example`、`apps/e2e/src/config.ts`;測試使用隔離資料庫及各專案的 DB、port、bucket namespace,不沿用正式 URI,也不將測試假憑證當正式設定。

不同專案同機開發時,須分別驗證資料庫與儲存資源隔離。

## 初始資料

專案種子放在 `apps/db-migrator/seeds/project/`,建立專案時檢視兩個入口:

- `settings.ts`:指定 `rootOrg` 的名稱、描述與 settings,以及 `moduleInitialValues` 中各模組的 `enabled`、`icon`、`settings` 初值。一般部署保留已有值與 UI 修改,完整還原才依專案初值重建。
- `registry.ts`:在 `moduleDeclarations` 登記專案模組,在 `seeds` 登記其他種子。底座與專案由固定入口合併、檢查引用及重名,不直接修改底座清單。

共用表單與流程的跨環境設定使用 `revisions/*.seed.ts`,由上述 registry 匯入當前版本;歷史快照保留給明示 migration 使用。初始化須在隔離空庫驗證完整建立與重跑,並確認兩環境得到相同定義內容。資料庫 ID、版號、人員與分派可各自不同,不搬入來源環境的組織或帳號資料。操作與續跑見[種子資料與遷移](concepts/data-layer-and-isolation.md#種子資料與遷移)。

ROOT_ADMIN 輸入與欄位政策見[種子資料與遷移](concepts/data-layer-and-isolation.md#種子資料與遷移)。根初始帳號由環境變數提供,不放進上述檔案;既有帳號不重設密碼,更換 ROOT_ADMIN_ACCOUNT 會建立另一帳號,不是原帳號改名。

示範模組初建啟用,開關與租戶分配由人員維護;授權關聯只補不刪。初始化、一般 seed 與 data/full reset 的差別見上述概念文件,操作見 [deployment](deployment.md#資料庫還原reset)。

## 設計與開發工具

- Figma 啟用時提供底座來源、本專案 Brand Library 與 Screens 的 fileKey、權限及維護者,登記見[品牌註冊表](branding.md);品牌值沿用 `projectPublic.brand`。操作見 [toolbox](agents/toolbox.md#figma-品牌同步):用本機外掛套用品牌庫與 Screens 主色,原生發布/接受 Library,另處理陰影與品牌示例文字。資源存在只算已建立,本專案的代表畫面與元件連結驗證通過才是已驗證;不靠來源 repo 或舊 receipt 冒認結果。未提供、停用與已驗證分開記錄。
- `skills-lock.json` 的三個外部 skill 原檔在 `.agents/skills/`,Claude Code 的入口須由 `node scripts/project-settings/restore-claude-skills.mjs` 還原到 `.claude/skills/`;Windows 會建立 junction。新 clone、升級後與重跑初始化均執行並核對可讀,不以來源檔已版控代替 Claude 實際可用。
- agent 入口為 `CLAUDE.md`,共同接手規則見 `docs/agents/collaboration.md`;必要設定不得僅存在某工具私有記憶。
- skills、共用文件與專案文案的分離隨對應工作包維護。初始化 skill 指向[共同操作文件](agents/project-bootstrap.md),不能用「檔案都改完」取代完整建立/驗證紀錄。
