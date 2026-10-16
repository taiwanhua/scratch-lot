# 專案結構與依賴邊界(STRUCT)

## STRUCT-01 依賴方向單向:apps → packages

- app 之間禁止互相 import(admin 不准 import front 的任何東西)。
- packages 禁止 import apps。
- packages 之間保持最小依賴。循環依賴由 `import-x/no-cycle` 強制擋下。

## STRUCT-02 共用 UI 的歸屬

被兩個以上 app 使用(或明確預期會被共用)的元件 → `@repo/ui`;單一 app 專用的元件留在該 app 內。搬移時機:第二個使用者出現的那個 PR。

- **`@repo/ui` 只放底座的底層元件,每個都要有 stories**;Storybook 只收 `@repo/ui` 與工具頁。
- **專案元件放 admin 的 `components/project/`**,用元件測試驗證,不進 Storybook。日後發現可共用 → 搬進 `@repo/ui`、補 stories、走底座回收。
- **專案程式不能放進 `packages/ui`**(底座同步工具會把它當共用改良):`packages/ui` 不得 import `apps/` 的任何路徑或 app 套件、不得有 `project/` 目錄。lint:`@repo/eslint-config/frontend-style` 的 `uiOwnership`;負例與目錄掃描:`packages/ui/scripts/check-ownership-lint.mjs`(接在 ui 的 `lint` 後面)。
- 已定的歸屬:

  | 元件                                                           | 位置                        |
  | -------------------------------------------------------------- | --------------------------- |
  | Section、MonthCalendar、RosterGrid、Stepper、58mm 單據版面零件 | `@repo/ui`(有 stories)      |
  | AudiencePicker、OrgTreeSelect、列印按鈕、通知鈴 / 清單         | admin `components/base/`    |
  | 張數格子、面額清點、看板卡片                                   | admin `components/project/` |

## STRUCT-03 app 內分層:`app / pages / components / hooks / stores / lib / test`,import 只能往下

(決策見 ADR-0012;lint:`@repo/eslint-config/frontend-style` 的 `import-x/no-restricted-paths`,正本 `packages/config-eslint/frontend-style.js`)

```
apps/<app>/src/
├── app/          組裝層:main.tsx、routes.tsx、providers/、guards/(RequireAuth、ModuleRoute、ForbiddenPage)、
│                 AdminShell/(AppBar / SideNav / RouteTabs 版面)、module-pages.tsx。不含業務內容
├── pages/        admin 分 base/ 與 project/,各自依功能分目錄:
│                 base/auth/LoginPage/、base/OverviewPage/、base/system/OrgManagerPage/ …
│                 一個頁面一個資料夾,只有這頁用的元件放在頁底下
├── components/   兩個以上頁面共用、但還不到進 @repo/ui 的元件;CRUD 共版型在 base/crud/
├── hooks/        跨頁 hook(base/useMe、base/useSession)
├── stores/       zustand store(base/useXxxStore.ts)
├── lib/          純工具、client、paths(不含 React)
└── test/         MSW、renderApp 等測試支援
```

admin 的 `components/`、`hooks/`、`stores/`、`lib/` 底下**只有 `base/`(底座維護)與 `project/`(專案內容)兩個子目錄**,不在層的根目錄放檔案(`app/`、`pages/` 的分法見 STRUCT-12);以下說的「放 `components/`」等,在 admin 指該層的 `base/` 或 `project/`。由 `apps/admin/scripts/check-ownership-lint.mjs` 檢查(接在 admin 的 `lint` 後面)。

- **import 方向只能往下**:`app → pages → components → hooks / stores → lib`;下層不准 import 上層,同層的頁面之間不准互相 import(要共用就往上提到 `components/` 或 `hooks/`)。
- **元件放在唯一使用它的那層**:只有一頁用 → 該頁資料夾底下;兩頁以上用 → `components/`;兩個 app 用 → `@repo/ui`(STRUCT-02)。殼(AdminShell)只被 `routes.tsx` 用,所以住 `app/`。
- **頁面一律資料夾**(如 `pages/base/OverviewPage/OverviewPage.tsx`),即使目前只有一個檔;非頁面的單檔元件不開資料夾(GEN-01)。
- **路由群組資料夾可放該群組共用的元件**:`pages/base/auth/AuthCard.tsx` 給四個登入線頁面用、之後 `pages/base/system/` 也可以放治理模組共用的東西;跨群組才上提到 `components/`。「同層頁面不互相 import」指的是頁面資料夾之間(`LoginPage/` 不 import `SetPasswordPage/` 的檔)。
- **非 React 程式碼要碰 store**(如 `lib/base/auth/auth-fetch.ts` 要讀 access token、失效時 `clear()`):lib 不准 import `stores/`,改由 app 層把 store 實例注入(`createAuthSession(endpoint, useSessionStore)`),lib 只認 zustand 的 `StoreApi<T>` 介面(型別放 `lib/`)。先例 `apps/admin/src/lib/base/auth/auth-fetch.ts`。
- **跨路由群組要共用就上提到 `components/`**,不要複製一份:`pages/base/auth/NewPasswordFields/` 的密碼欄位若要給 `pages/base/system/` 的新增使用者彈窗用,正確做法是搬到 `components/base/NewPasswordFields/`。已知的重複:使用者管理的 `UserManagerPage/UserFormDialog/ActivationFields.tsx` 另有一份單欄位版的密碼規則提示,與 `NewPasswordFields` 待合併。
- **`pages/` 為什麼取代 `features/`**:admin 的業務單位是模組(側欄每一項),「一個頁面 = 一個模組」已是產品定義(ADR-0004),不需要再一層沒定義的 feature。

底座與專案的所有權限制另見 STRUCT-12;`base/`、`project/` 不改變以上分層。注入用 context 與 hook 同檔放 `hooks/`,Provider 放 `app/providers/`(REACT-02),包括表單模組 options。

其他包的對應:`packages/ui` 沒有分層,`src/<Component>/<Component>.tsx` 平鋪(`theme/`、`icons/` 維持);`apps/front` 的 `app/` 是 Next.js 路由目錄(框架例外),其餘 `components / hooks / lib` 同上。front 沒有 `pages/` 層,**單一路由專用的元件放 `components/<RouteView>/`**(如 `components/HomeView/HomeView.tsx` + 它的子元件),路由檔 `app/**/page.tsx` 只剩組裝;兩個路由共用的才是一般的 `components/`。

## STRUCT-04 GraphQL 產物只走 `@repo/graphql` 的出口

```ts
✅ import { useModuleTreeQuery } from "@repo/graphql";
❌ import { useModuleTreeQuery } from "@repo/graphql/src/generated";
```

`src/generated` 是 codegen 產物(lint 也忽略它),永遠不手改、不深層 import。

## STRUCT-05 ESLint 豁免:檔案第一行、附原因與到期條件

需要豁免某條 lint 規則時,一律寫在**該檔案第一行**的 `/* eslint-disable ... */`,且註解**必附原因與到期條件**;禁止在 ESLint config 以路徑白名單豁免(刪檔後留殭屍設定、讀檔案的人看不見豁免)。

```ts
/* eslint-disable <規則> -- <具體原因>;解除條件:<何時移除> */
```

**已知會誤判、豁免時照抄理由的規則**(碰到就在該行寫 `// eslint-disable-next-line`,別為了閃它改寫程式):

- `unicorn/no-array-callback-reference` 對 **mongodb driver 的 `collection.find(filter)`** 會誤判:規則假設 `find` 是 `Array.prototype.find`、傳進去的是 callback,而 driver 的 `find` 收的是查詢條件物件。`apps/db-migrator` 的 reset 直接操作 driver,整支都會踩到。理由寫「mongodb driver 的 `find` 收的是 filter 不是 callback」。

## STRUCT-06 輸出與 log 依執行環境分三種,都不直接 `console.*`

| 環境                         | 用什麼                                          | 為什麼                                                                                          |
| ---------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| CLI 工具(`apps/db-migrator`) | `process.stdout.write` / `process.stderr.write` | 摘要輸出(新增 N / 更新 M / 認養 A / 未變 K)就是它的介面;tsx 直跑的腳本不該依賴需先 build 的套件 |
| api(NestJS)                  | Nest 內建 `Logger`(`new Logger(ClassName)`)     | 框架自帶等級、前綴與輸出管道,與 Nest 的啟動 log 一致;不另接 `@repo/logger`                      |
| front / admin(瀏覽器、Next)  | `@repo/logger`                                  | 全 repo 唯一允許碰 `console` 的地方,集中管理                                                    |

`no-console` 一律開著;三種以外的寫法都算違規。

## STRUCT-07 前後端共用的純邏輯放 `@repo/domain`,按主題分資料夾,不一個共用開一個包

前端與後端都要用、而且**沒有框架依賴**的邏輯(密碼規則、權限 key 切分與同層 wildcard 比對、表單驗證規則…)統一放 `packages/domain`,以子路徑匯出、按主題分資料夾:

```
packages/domain/src/password/     → import { validatePassword } from "@repo/domain/password"
packages/domain/src/permission/   → import { ownerModuleKey } from "@repo/domain/permission"
```

入包門檻(三個都要符合):①純函式 / 純型別,不碰 React、Nest、Mongoose ②api 與 admin(或 front)都會用 ③規則只能有一份、兩邊漂移會出事。不符合的留在各自 app;只有一邊用的不進來。

**同一個主題長到第二個檔時,`index.ts` 只當出口,實作檔不可回指 index**:
`permission/` 從一個檔變成 `keys.ts` + `matrix.ts` 時,`matrix.ts` 要用 key 工具、`index.ts` 又要
re-export `matrix.ts`,若 `matrix.ts` 寫 `from "./index"` 就是 `import-x/no-cycle`。規則:
實作檔之間**互相直接引用檔名**(`from "./keys"`),`index.ts` 只有 `export * from "./…"` 幾行。
這樣拆檔不動對外 API,**子路徑與 `package.json` 都不必改**。

**api 的型別、執行期與測試分開解析**:TypeScript 使用 `moduleResolution: node`,型別解析不讀 `package.json` 的 `exports`,子路徑靠 `typesVersions` 指向宣告檔。套件用 bunchee 出雙格式;Node 執行期依 `exports.require` 載入 `dist/cjs`。Jest 則以 `apps/api/jest.config.mjs` 的 `moduleNameMapper` 將已登記的共用套件導向原始碼,不依賴它們的 dist。新增套件時的出口與 mapping 清單見 STRUCT-08;建置及測試指令見 [toolbox](../../agents/toolbox.md#pnpm--turbo建置測試格式)。

## STRUCT-08 新增 workspace 套件的清單

新開 `packages/<name>` 時照這份做,不要拼湊既有套件猜:

1. `package.json`:`"name": "@repo/<name>"`(GEN-06)、`"type": "module"`、`"private": true`、`"files": ["dist"]`;`exports` 一律**子路徑**(`"./<主題>"`)並附 `import` / `require` 兩組 `types` + `default`;同一組子路徑再寫一份 `typesVersions`(給 api 這種 node10 解析用);scripts 固定 `build: bunchee`、`lint`、`check-types`、`test`
2. `tsconfig.json` extends `@repo/typescript-config/base.json`;`eslint.config.js` 只有一行 `export { config as default } from "@repo/eslint-config"`;jest 用 `@repo/jest-presets/node`(純邏輯)或 `browser-esm`(瀏覽器);`turbo.json` 宣告 `build` 輸出 `dist/**`
3. 消費端:在需要它的 app 宣告 `workspace:*`,直接 `import "@repo/<name>/<主題>"`。**api 執行期會用到的套件必須列入 `dependencies`**;`apps/api/Dockerfile` 建置後執行 `pnpm install --prod`,只列在 `devDependencies` 會被移除。僅供測試或開發工具使用的套件才列 `devDependencies`
4. api 測試:在 `apps/api/jest.config.mjs` 的 `moduleNameMapper` 補上新套件子路徑到 `src/` 的對應。現有 `@repo/domain` 與 `@repo/project-config` 都走原始碼,讓 CI 直接跑 Jest 時不必先 build 這些套件;這不取代正式建置的 `exports`、`typesVersions` 或 production 依賴驗證
5. 登記:`docs/architecture.md` 的 packages 表加一列,寫「誰用、怎麼用」

**既有套件新增一個子路徑匯出(最常見:往 `@repo/ui` 加一個元件)要動五處**:

1. 元件三件套:`src/<元件>/<元件>.tsx` + `<元件>.test.tsx` + story(GEN-01 / TEST-09)
2. `src/<主題>.ts` 出口檔(對外 API 的那一行 `export`)
3. `package.json` 的 `exports`;**被 api 消費的套件(`@repo/domain`、`@repo/project-config`)再補同名的 `typesVersions`**。前者供 Node 執行期選擇產物,後者供 api 的 TypeScript node10 型別解析;並確認 `apps/api/jest.config.mjs` 的既有 source mapping 能對到新出口。`@repo/ui` 只被 admin / front 以 bundler 解析消費,不用補 `typesVersions`
4. `package.json` 的 `dependencies`(包了新的外部庫時)+ 用到新版外部庫時先 `npm view <pkg> version` 查最新
5. 登記 `docs/architecture.md` 的 packages 表:**`@repo/domain` 那列逐一列出子路徑,新增時要補上**;`@repo/ui` 那列**不列舉**子路徑(四十餘個,正本是 `package.json` 的 `exports`),只維持用途概述

漏第 3 點的症狀是「本地 import 得到、`check-types` 在別的包紅」;漏第 5 點的症狀是 architecture.md 的子路徑列悄悄過期。

### 新增一個 app workspace(`apps/<name>`)的清單

app 與 package 不同:它不出 `dist` 給別人 import,但**會被 turbo 排程、被 CI 掃到、被 lint 與 prettier 管**。照這份做:

1. `package.json`:`"name": "@repo/<name>"`、`"private": true`;scripts 至少 `lint`、`check-types`,有測試再加 `test`。**不要**宣告 `files` / `exports`(沒人 import 它)
2. `tsconfig.json` extends `@repo/typescript-config/` 底下對應的那一份
3. **eslint 設定檔的副檔名先看自己 `package.json` 有沒有 `"type": "module"`,不要照抄鄰居**:沒有(目前只有 `apps/api`)就**必須**寫 `eslint.config.mjs`,否則 node 會把它當 CommonJS 載入而炸;有就兩種都載得起來。現況是 `apps/admin` / `apps/front` / `apps/storybook` 用 `.js`、`apps/api` / `apps/db-migrator` / `apps/e2e` 用 `.mjs`(db-migrator 與 e2e 其實有 `"type": "module"`,`.mjs` 只是沿用 api 的寫法)。這個不一致不是 bug,不要為了對齊去改既有的檔;新 app 挑一種、與性質最近的那個 app 一致即可(正本:各 app 的 `package.json` 與 `eslint.config.*`)
4. `turbo.json`(`extends: ["//"]`)宣告自己的 `build` 輸出;**build 時烘進產物的環境變數一定要登記進 `env`**,見下一條
5. 登記:`docs/architecture.md`、`docs/env-registry.md`(新變數)、CI 的 job 清單(如果它要進 `ci.yml`)

### build 時烘進產物的變數要登記進該 package 的 turbo `env`

`VITE_*` / `NEXT_PUBLIC_*` 這類變數會被**編譯進產物**,所以它們是 build 的**輸入**。沒登記進該 package `turbo.json` 的 `tasks.build.env`,turbo 的 build 快取就不含它 —— **換一個值重 build 會直接 `cache hit`,拿到烘著舊值的產物**,而且沒有任何一步會失敗。

```jsonc
// apps/admin/turbo.json
{
  "extends": ["//"],
  "tasks": {
    "build": { "env": ["VITE_GRAPHQL_ENDPOINT"], "outputs": ["dist/**"] },
  },
}
```

admin 每個環境各建一顆 image,正是最容易吃到這個坑的形狀(`VITE_GRAPHQL_ENDPOINT` 就漏登記過)。新增這類變數時三處一起動:該 package 的 `turbo.json` 的 `env`、`docs/env-registry.md`、該環境的 build 參數(`deploy/env/<環境>.yaml` 或 deploy.yml 的 `--build-arg`,見 `docs/deployment.md`)。**執行期才讀的變數不在此列**(api 的那些),它們不影響產物。正本:`apps/admin/turbo.json`

## STRUCT-09 全 repo 都走 prettier,CI 守門:表格與 import 由它排版,不手排

全 repo 的 `.md` 與 `.ts` / `.tsx` / `.js`(含 `.mjs` / `.cjs`)/ `.json` / `.yaml` 都受 CI 的 `prettier --check` 檢查(`pnpm run format:check`,與 `pnpm format` 同一組副檔名、同一套設定)。`ci.yml` 與 `docs.yml` 都跑同一個腳本,排除清單的正本是 `.prettierignore`(`pnpm-lock.yaml`、`dist` / `build` / `.next` / `coverage` 等產物、`**/src/generated`、`.agents` 的 skill 正本、Claude Code 的本機目錄)。

- **交件前跑一次 `pnpm format`**,未格式化的檔案 CI 會擋下來;`.ts` 的 import 排序由 `@trivago` 外掛統一處理,不要手排。
- 表格的分隔列與欄寬對齊一律交給 prettier:寫完跑 `pnpm format`,不要手動對齊、也不要為了省寬度刻意寫緊湊式 `|---|---|`(prettier 會展開,產生與內容無關的大 diff)。

例外都要附原因:

1. **清單編號是跨文件引用的穩定 ID**(清單的編號被其他文件以「第 N 項」指路時)— prettier 會把非連續編號重排成連號,在該清單前一行放 `<!-- prettier-ignore -->`。
2. **不歸我們管的內容** — 外部安裝、由 `skills-lock.json` 以 hash 校驗的 `.agents/`,以及 Claude Code 的本機目錄,整目錄列在 `.prettierignore`。
3. **種子快照的固定輸出** — `@repo/domain/seed` 的 `serializeSeedSet` 在 `seed` 宣告前產生 `// prettier-ignore`,讓匯出與版控內容一致,已發布快照不被重新排版。只豁免該宣告,不排除整個 seed 目錄。

**擴大檢查範圍(加副檔名)時,會冒出兩類「本來看不到」的檔案**:

1. **被 global gitignore 擋住、但 prettier 看得到的本機檔** —— prettier **不讀 `.gitignore`**,所以 `.claude/settings.local.json` 這種「不入版控卻真實存在於工作目錄」的檔會讓本機 `format:check` 紅、CI 卻綠(CI 的 checkout 沒有那個檔),很難自己想通。擴 glob 後在自己機器上跑一次 `pnpm run format:check`,冒出來的本機檔案加進 `.prettierignore`。
2. **外部工具產生、由上游決定長相的檔** —— `msw init` 產的 `apps/admin/mock-public/mockServiceWorker.js` 不合我們的 prettier 設定,重排會與 msw 上游漂移(下次 `msw init` 又被改回去)。這類檔案一律進 `.prettierignore` 並註明來源,不要手動改格式。

順帶:字面星號(例如 wildcard 權限「全部(\*)」)要寫成 `\*`,否則成對的 `*` 會被當成強調符號,prettier 會把它改寫成 `_` 讓問題浮現。

正本:根 `package.json`(`format` / `format:check`)、`.prettierignore`、`.github/workflows/ci.yml`、`.github/workflows/docs.yml`

## STRUCT-10 `localeCompare` 一律明給 `zh-Hant`

全 repo(api、admin、db-migrator 都算)排字串一律寫 `a.localeCompare(b, "zh-Hant")`,**不留給執行環境決定**。

```ts
✅ rows.toSorted((a, b) => a.name.localeCompare(b.name, COLLATION_LOCALE)); // const COLLATION_LOCALE = "zh-Hant"
❌ rows.toSorted((a, b) => a.name.localeCompare(b.name));
```

不給語言時 `localeCompare` 吃的是執行環境的預設語言:開發機通常是 `zh-TW`、**CI runner 通常退回 `en-US`**,中文字的先後跟著不一樣 —— 排序斷言於是「本機綠、CI 紅」,而且看起來像偶發。先例與理由註解在 `apps/admin/src/lib/base/role-options.ts`(`COLLATION_LOCALE`)。同一支檔案裡排多處時抽成模組層常數,不要逐處重打字串。

## STRUCT-11 正式文件寫現況,完成的計畫歸回正本

適用 `docs/**` 與根目錄的 `CLAUDE.md`、`CONTEXT.md`、`CONTEXT-PROJECT.md`(給人與 AI 讀的文件)。`apps/admin/src/md/module-help/{base,project/additions,project/replacements}/` 的 `.help.md` 是租戶使用者說明,另守詞彙與受眾規則(FIGMA-04、`docs/agents/module-scaffold.md`),不在本條範圍 —— 但同樣不該出現票號。

- **不寫**「(2026-09-xx 裁決)」「第 N 段」、`#` 加票號、PR 號這類註記,也不寫「原本 A、後來改 B」:只寫 B。
- **決策理由照寫**,寫進正文(「為什麼這樣做」「不這樣會怎樣」),但不帶時間與票號。理由是規則的一部分,刪了理由的規則沒人敢改也沒人知道能不能改。
- **需要歷史時查 git / PR**(`git log -S "<關鍵字>" -- <檔>`、`git blame`、PR 內文),文件不代為保存。
- 規則被推翻時**直接改寫該條**,不留「已退場」「原條文」這類殭屍段落;規則編號(`REACT-02`…)是穩定 ID,保留不重編。
- **依用途維護唯一正本**:CONTEXT 定義詞彙,ADR 留理解現行決策所需的理由與取捨,concepts/architecture 說明目前機制,standards 規定開發約束,模組文件說明畫面與 API,操作放 deployment/toolbox。入口和 skills 只指路,不複製規則。
- **`docs/plans/` 與 `docs/tmp/` 只留未完成工作**:開發規格先清楚標明目標,不能冒充現有能力。實作驗收後,將必要內容精簡改寫到既有正本,刪除已完成的計畫與盤點,同步修正所有引用;跨包計畫只保留未完成範圍及正式文件索引,不另建 archive 或第二套需求文件。
- **讓讀者直接知道現在怎樣、怎麼用**:不保留「本次新增」「原本怎樣」「開發階段」「已完成」等交付過程,不將規格整份搬進正式文件。進度、逐次測試、commit 與發布證據留 issue/PR;程式型別及生成物已有正本時以連結指路。
- 例外:引用外部版本號(套件版本、Node 版本)與規則編號不算註記。

為什麼:註記一多,新讀者(與沒有對話 session 的 AI)得自己從「誰在哪一段改了什麼」裡剝出現況,讀完仍不確定哪句還算數;歷史本來就完整地存在 git 與 PR 裡,文件只需要回答「現在是什麼、為什麼」。

檢查指令(交件前對自己改到的文件跑一次,應為 0 筆;規則編號不會命中):

```
grep -rnE "20[0-9]{2}-[0-9]{2}-[0-9]{2}|第 [0-9一二三四五六] 段|#[0-9]{2,3}" <改到的檔>
```

## STRUCT-12 底座與專案分來源,只有固定入口組裝

專案新增功能改專案來源;客製替換另列目標,保留底座原檔與宣告。底座不可反向 import 專案內容,只允許下列固定入口讀兩方來源。頁面與表單設定見[前端架構](../../concepts/frontend-architecture.md),資料登記與碰撞檢查見[資料層組裝](../../concepts/data-layer-and-isolation.md#底座與專案資料的組裝)。

### seed

- 底座宣告與 helper 在 `apps/db-migrator/seeds/base/`,專案宣告在 `seeds/project/`;只有 `seeds/registry.ts` 讀兩方來源。根組織與模組的專案初值在 `project/settings.ts`,底座維護結構與初始值保護政策。
- 專案模組登記在 `project/registry.ts` 的 `moduleDeclarations`,其他種子登記在 `seeds`。合併後只推導一次模組、權限、資料目標與租戶管理員模板;不另用普通文件宣告這些推導結果。
- 寫入前檢查重名、引用、循環與來源政策。表單、流程、版本、安裝紀錄及動態權限不得用一般 documents seed 繞過發布機制。
- 共用宣告、可攜性驗證與 TypeScript 匯出以 `@repo/domain/seed` 為唯一來源。匯出的 `.seed.ts` 直接作專案 seed,程序間的 JSON 只作傳輸,不另建人工維護的設定格式。
- 版本定義由 `apps/api/src/seed/` 沿原設計服務發布,使用真實操作者、權限與稽核。其 CLI 經最小 Nest runtime 啟動,不開 HTTP 或應用背景工作;其他 app 透過受控子程序呼叫,不互相 import 或複製發布生命週期。

正本:`apps/db-migrator/seeds/registry.ts`、`apps/db-migrator/src/seed/seed-composition.ts`;新增模組步驟見 [module scaffold](../../agents/module-scaffold.md)。

### admin

- 頁面分 `pages/base/` 與 `pages/project/`;其他層既有共用內容仍由底座維護,專案內容放該層 `project/`,不另開頂層 `src/project/`。專案頁不可引用底座頁內部,共用能力走 components/hooks/lib;CRUD 模板在 `components/base/crud/`。
- `app/module-pages.tsx` 組裝 `app/base/module-pages.ts`、`app/project/module-pages.ts` 與 `app/project/page-replacements.ts`。專案新增或替換不改底座清單;表單 options 與四頁來自同一筆 `forms` 宣告。
- `lib/base/help-registry.ts` 組裝 `md/module-help/base/`、`project/additions/`、`project/replacements/`。原文由 Vite 打包,驗證與查詢放純函式,不以檔案順序決定覆蓋。
- `src/test/**` 只豁免所有權方向,仍守 STRUCT-03 與循環依賴檢查。固定入口是個別檔案的例外,不放寬整個 app 層。

### api

- 功能來源為 `base/api-modules.ts` 與 `project/api-modules.ts`,專案功能由 `project/project.module.ts` 掛載;`app.module.ts` 是底座讀取專案功能的固定入口,不提供核心 module/provider 替換。
- 資料來源為 `database/base/registrations.ts` 與 `project/database/registrations.ts`,只由 `database/database.module.ts` 組裝。業務服務使用 repository,不自行以 Mongoose 注入或註冊 Model。
- repository providers 與 Nest exports 由登記導出,不匯出 Model provider 或整個 MongooseModule。底座 repository 實作放 `database/base/` 等 leaf 檔,不回指組裝入口;`database.module.ts` 保留既有 repository 的 TypeScript re-export 相容出口。
- 新專案租戶資料沿用 BaseRepository 與隔離 plugins,同時登記組織歸屬檢查;刪組織與撤銷開通共用 `OrgBusinessDataReader`,不能新增可繞過檢查的 callback。專案資料登記不提供略過隔離的開關。
- 測試 fixture 只豁免所有權方向,不新增 raw query 或 Mongoose 任意注入的例外;正式來源不得引用 fixture。驗收入口見 TEST-07 / TEST-08。

## STRUCT-13 方案設計先核對現況,優先延伸既有機制

適用方案討論、規格設計、實作與審查。先確認專案如何運作,再提出設計,避免每個功能各自增加一套格式、工具或流程。

- **提案前查實作與用例**:閱讀相關正本、資料格式與宣告型別、登記及執行入口,並核對既有使用範例。提案指出依據的檔案、可沿用的能力及實際缺口;尚未查證的事項標成待確認,未實作的能力不得描述成現況。
- **優先沿用或擴充**:先評估既有格式、契約、登記入口、驗證器及生命週期能否延伸。不同處理行為可透過既有機制的類型或處理器區分,不因新增功能就另造一套平行的維護格式或操作流程。
- **同一內容只有一份人工維護正本**:匯出、匯入與部署優先共用既有宣告契約,不要求同一設定維護兩份再人工轉抄或雙向同步。允許自動生成不同用途的產物,但須明確指出來源、生成與驗證方式。
- **新機制要交代必要性與相容方式**:既有機制確實不足時,說明限制的證據、沿用與新建的取捨,以及既有資料與呼叫端如何遷移、驗證。替代舊機制時明訂退場方式;需長期並存時說明各自不重複的責任,避免同一內容出現兩套正本。
