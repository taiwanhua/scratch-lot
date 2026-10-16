# 前端架構(現況說明)

回答「admin 的程式怎麼分層、殼長什麼樣、頁面怎麼接上權限與資料」。決策理由見 ADR-0012(程式碼風格與分層)與 ADR-0011(路由與判斷)。條文在 `docs/standards/`(GEN-01、STRUCT-03、REACT-01 / 02 / 07、DATA-01 起)。

## 程式碼風格(admin / front / ui 同一套)

| 項目           | 規則                                                                   |
| -------------- | ---------------------------------------------------------------------- |
| 跨元件狀態     | zustand(`stores/`);context 只做注入(theme、QueryClient、Intl、session) |
| 伺服器資料     | 只走 TanStack Query(`@repo/graphql` 的 codegen hooks)                  |
| URL 表達得了的 | 放 URL;admin 一律經 `useUrlState`(REACT-14)                            |
| 檔名           | 元件 `PascalCase.tsx`、hook `useXxx.ts`、其餘 kebab-case               |
| 一檔一元件     | 有子元件才開同名資料夾;不用 `index.ts` barrel                          |
| 寫法           | 箭頭函數;props 用 `export interface XxxProps`                          |
| 檔案大小       | 目標 300 行,lint 上限 400(不計註解與空行)                              |

- lint 規則集中在 `@repo/eslint-config/frontend-style`。
- 框架強制的例外:Next.js `app/` 路由檔、ui 的 story 三件套。

正本:`docs/standards/general/naming.md` GEN-01、`docs/standards/react/components.md`、`packages/config-eslint/frontend-style.js`

## admin 的分層

```
app/        組裝層:路由、守門、殼、providers(不含業務內容)
pages/      base/ 放底座頁,project/ 放專案頁;各自依功能分目錄
components/ 跨頁共用元件:base/(crud/、表單引擎、流程元件、選擇器…)、project/(專案元件)
hooks/      跨頁共用 hook:base/、project/
stores/     zustand store:base/、project/
lib/        純函式與基礎設施:base/(auth、module-tree、route-tabs、form-engine、workflow…)、project/
test/       測試支援
```

- import 只能往下。
- 殼(`AdminShell`)不是頁面,住 `app/`。
- `components/`、`hooks/`、`stores/`、`lib/` 底下只有 `base/` 與 `project/` 兩個子目錄:`base/` 是底座維護的共用內容,`project/` 放專案內容;層的根目錄不放檔案,也不另建頂層 `src/project/` 繞過分層。
- `pages/base/` 保留底座的登入、治理、示範與申請中心頁;專案新增或客製頁放 `pages/project/`。
- 專案元件放 `components/project/`,用元件測試驗證、不進 Storybook;`@repo/ui` 只放底座的底層元件(STRUCT-02)。
- 專案頁使用共用的 components/hooks/lib,不 import 底座頁內部。固定欄位 CRUD 共版型在 `components/base/crud/`,底座與專案頁都可使用。
- 底座不可反向 import 專案來源;只有頁面組裝入口 `app/module-pages.tsx` 與 help 組裝入口 `lib/base/help-registry.ts` 讀兩方來源。`src/test/**` 只豁免這項所有權限制,分層與循環依賴檢查仍適用。

正本:`apps/admin/src/`、`docs/standards/general/structure.md` STRUCT-03

## 殼

殼 = 側欄 + AppBar + 路由頁籤列 + 內容區。`AdminShell` 等 `me` 載入後交給 `ShellLayout` 排版。

| 區塊      | 做什麼                                                                                                                                                                                              | 程式                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| SideNav   | `me.modules` 以 `parentId` 組樹;`group` 可展開、`link` 可點、`hidden` 不顯示;頂部是當前組織的商標(自己沒有就沿 `ancestors` 由近到遠繼承上層的商標,整條鏈都沒有才顯示組織名);可收合;模組列可掛待辦數 | `app/AdminShell/SideNav/`、`stores/base/useSideNavStore.ts`      |
| AppBar    | 頁名、「?」模組說明、當前組織切換器、頭像選單                                                                                                                                                       | `app/AdminShell/AppBar/`                                         |
| RouteTabs | 開過的路由各一個頁籤;可關閉、可拖曳排序、鍵盤可操作                                                                                                                                                 | `app/AdminShell/RouteTabs/`、`stores/base/useRouteTabsStore.ts`  |
| 內容區    | `<main>`:高度由殼給、自己捲動;有最小寬度                                                                                                                                                            | `app/AdminShell/ShellLayout.tsx`、`AdminShell/shell-geometry.ts` |

- 殼的設計稿節點登記在 `docs/branding.md`。

正本:`apps/admin/src/app/AdminShell/`、`apps/admin/src/lib/base/module-tree.ts` 的 `buildNavTree`

### 側欄

- **兩種寬度**:展開 240px、收合成 64px 圖示列(`NavRail`)。收合態的群組以浮層展開子項;圖示格的提示就是模組名稱(REACT-10 的例外)。
- 收合狀態存 localStorage,是這台瀏覽器的偏好,不分使用者。
- 側欄只有模組樹那一格捲動,底部的收合開關永遠看得到。
- **待辦數(badges)**:`ShellLayout` 傳入「模組 key → 數字」,數字大於 0 才顯示;展開態畫數字(`@repo/ui/badge`)、收合態畫小圓點。目前只有申請中心一項:待我處理的任務數,來自 `applyCenterCounts`(`hooks/base/useApplyCenterCounts.ts`)。沒有申請中心檢視權限時不發請求。進站取一次,之後由送出、審核、改派、撤回、作廢、刪除這些寫入主動失效重查,不輪詢。

### 內容區的寬度與內距

- **最小寬度**:只在 `sm` 以上套用。內容區最小寬度 = 主題斷點 − 側欄寬(隨收合狀態)− 左右內距。殼層預設 `lg`;表單管理與流程管理(兩個設計器)在 `app/base/module-pages.ts` 的頁面宣告設定 `minWidth: "xl"`,組裝後由 `app/module-pages.tsx` 的 `modulePageMinWidths` 交給殼。客製替換未寫 `minWidth` 時繼承底座值。視窗比斷點窄時由 `<main>` 水平捲動,不擠壓內容;document 本身不出現水平捲軸。
- **內距**:手機寬(< `sm`)8px,其餘 24px(`MAIN_PADDING`)。
- **高度**:殼外框固定 `100vh`,`<main>` 以 `flex: 1` + `minHeight: 0` 取得確定的高度,頁面可以撐滿(STYLE-08)。

正本:`apps/admin/src/app/AdminShell/shell-geometry.ts`、`apps/admin/src/app/AdminShell/ShellLayout.tsx`

### AppBar 與頭像選單

- **頁名**:目前網址對上的模組名。`/` 與群組路由會立刻轉到底下第一個能進的頁面(`firstLinkRoute`),轉走前標題留空,不閃「沒有權限進入此頁面」。群組底下一個都進不去時停在無權限頁,標題顯示「沒有權限進入此頁面」,其他對不上模組的網址也一樣;`/` 一個都進不去時標題維持留空。
- **「?」模組說明**:只有模組路由才有。內容由底座與專案 help 合成,Markdown 原文在 build 時打包;開啟彈窗才懶載入渲染元件。表單模組沒有專屬檔時用通用的 `form-module.help.md`;都沒有就停用。
- **當前組織切換器**:`SelectField`;切換後換發 access token,並失效 `me`;同時立即換發即時通道的訂閱憑證(換到別的租戶時改連新租戶的 Durable Object)。
- **頭像選單**(`Popover`):使用者卡(姓名、帳號 · 當前組織)、**外觀**與**語言**兩組 `SegmentedControl`(切了立刻生效、不關選單)、登出 / 登出所有裝置。用 `Popover` 而不用 `Menu`,是因為 `Menu` 按 Tab 就關、分段按鈕鍵盤到不了;只有登出兩項是 `MenuList`。

### 模組說明的來源與替換

檔名一律是 `<moduleKey>.help.md`,三個來源都在 `apps/admin/src/md/module-help/`:

| 來源     | 目錄                    | 用途                                        |
| -------- | ----------------------- | ------------------------------------------- |
| 底座     | `base/`                 | 底座原版說明,含通用的 `form-module.help.md` |
| 專案新增 | `project/additions/`    | 底座沒有同 key 說明時新增專屬內容           |
| 專案替換 | `project/replacements/` | 替換已存在的底座說明,底座原檔保留           |

`lib/base/help-registry.ts` 是唯一 Vite glob 入口,用三份 `eager: true`、`?raw` glob 讀取原文,交給 `lib/base/module-help.ts` 的純函式 `composeHelpRegistry` 合成。重複 key、新增撞底座、替換不存在的底座 key、重複或空白替換都會失敗。替換的是 help key,不要求有同 key 的頁面登記。

殼只經 `moduleHelpMarkdown(module)` 取內容:先專屬說明,`FORM` 模組再退到 `form-module`,最後才是沒有內容。客製替換頁未另放說明時,原版說明仍可使用;若底座只有通用說明,專案專屬檔應放 `additions/`。

`scripts/check-help-bundle.mjs` 掃描三個來源,保留 `.md` 錯命名檢查與必備底座通用檔檢查;專案目錄可空。建置與 Docker 都要驗證原文進入 bundle。bundle 有文字只證明收檔,替換內容是否真的顯示仍由 HelpButton 測試驗證。

正本:`apps/admin/src/lib/base/help-registry.ts`、`apps/admin/src/lib/base/module-help.ts`、`apps/admin/scripts/check-help-bundle.mjs`

### 外觀(跟隨系統 / 亮 / 暗)

- 預設跟隨系統。選擇由 `@repo/ui` 的 `AppThemeProvider` 存 localStorage(`useColorMode` 讀寫,STYLE-04);另存亮 / 暗各用哪組配色。
- **首幀腳本**:React 起來前先依 localStorage 把 `<html>` 的 class 設成 `light` / `dark`,重新整理時不會先閃亮色。腳本在 `lib/base/color-mode-init.ts`,由 `vite.config.ts` / `vite.mock.config.ts` 以 `transformIndexHtml` 注入 `index.html` 的 `<head>`;與 `AppThemeProvider` 用同一組 key 常數(`lib/base/color-mode.ts`)。不用 MUI 的 `InitColorSchemeScript`,因為 React 插入的內嵌 script 不會執行。

正本:`apps/admin/src/lib/base/color-mode.ts`、`apps/admin/src/lib/base/color-mode-init.ts`、`packages/ui/src/AppThemeProvider/`

## 守門與路由

```
/login、/forgot-password、/set-password      公開
/change-password                             RequireAuth
/settings/personal                           RequireAuth → AdminShell → 個人設定頁(殼層固定路由)
/ 與其餘路徑                                  RequireAuth → AdminShell → ModuleRoute
```

- `RequireAuth`:未登入回登入頁;`me.mustChangePassword` 導去改密碼頁。
- **殼層固定路由**(目前只有個人設定 `/settings/personal`):開在殼裡,但不是模組、不分配給角色、不經 `ModuleRoute`,所有登入者都能開。`lib/base/shell-routes.ts` 的 `withShellRoutes` 把它以一筆不在側欄的頁面形狀(`link`、精準比對)併進殼用的路由集合,AppBar 頁名、「?」說明(key `personal-settings`)與路由頁籤因此和模組頁走同一條路;`ModuleRoute` 的權限判斷不吃這份。
- `ModuleRoute`:把網址對上 `me.modules`,決定顯示哪一頁。
- 模組 key → 頁面元件由 `app/module-pages.tsx` 組裝;有路由授權但沒登記元件的模組顯示佔位頁。登記不會新增路由授權。

正本:`apps/admin/src/app/routes.tsx`、`apps/admin/src/app/guards/`、`apps/admin/src/app/module-pages.tsx`

### 頁面登記與客製替換

| 來源     | 檔案(`apps/admin/src/`)            | 維護內容                                             |
| -------- | ---------------------------------- | ---------------------------------------------------- |
| 底座     | `app/base/module-pages.ts`         | `baseModulePages` 的固定頁與表單模組                 |
| 專案新增 | `app/project/module-pages.ts`      | `projectModulePages` 的固定頁與表單模組              |
| 專案替換 | `app/project/page-replacements.ts` | `projectPageReplacements` 的底座目標 key 與客製 Page |
| 固定入口 | `app/module-pages.tsx`             | 合成三份來源,匯出頁面、寬度及表單設定                |

新增專案功能改專案來源即可。`ModulePageSource.pages` 收 `{ key, Page, minWidth? }`,`forms` 收 `{ moduleKey, options?, pageOverrides? }`;型別與 `composeModulePages` 在 `app/module-page-registry.ts`。組裝先展開表單四頁,再檢查空 key、來源內重複、底座與專案碰撞、表單與固定頁碰撞;錯誤包含 key 與來源,不以物件 spread 靜默覆蓋。查詢只接受登記表自身的 key,不把物件原型的同名成員當作頁面。

客製底座頁在替換清單寫 `{ target, Page, minWidth? }`。目標必須是既有底座頁,同一目標不能替換兩次;省略寬度繼承底座,明寫 `lg` / `xl` 才變更。原版檔案與登記保留,移除替換即恢復原版,不另開一條原版網址。登入相關頁不提供這個替換介面。

頁面登記只選 renderer。網址、名稱、permissions 與 engine 仍以 `me.modules` 為準,客製頁照樣經過 `RequireAuth`、`ModuleRoute` 與頁籤守門。專案自有表單的單頁客製寫在 `pageOverrides`(四個 slot:`list`、`viewPage`、`createPage`、`editPage`),不重複登記相同 key;詳見[表單引擎](form-engine.md#前端引擎零件與預設組裝)。

### 表單設定的注入

`ModulePageSource.forms` 同時供應預設四頁與模組 options,不另外維護 key 清單。純函式 `lib/base/form-engine/form-module-options.ts` 的 `composeFormModuleOptions` 產生唯讀設定表;`formModulePages(moduleKey)` 只產生四個懶載入預設元件,不在載入時修改全域 Map。替換底座表單頁會保留原模組 options。

`app/providers/RootProviders.tsx` 讀取固定入口的設定表,以既有 `AppProviders` 包住 `FormModuleOptionsProvider`。正式 `App.tsx` 與 `test/test-app.tsx` 共用這個入口。依 REACT-02,context 與 `useFormModuleOptions(moduleKey)` 同檔放在 `hooks/base/useFormModuleOptions.ts`,Provider 放在 `app/providers/FormModuleOptionsProvider.tsx`;components 往下用 hook,不反向 import app。

Provider 內找不到模組設定時使用預設模板 `{{title}}`;缺少 Provider 則明確報接線錯誤。一般元件測試經 test-app 或 hooks 層的 context 注入。表單自身模板優先於模組模板,申請中心詳情也讀同一份設定;模板細節見[forms](../modules/forms.md#頁籤--標題模板)。

## 路由與導向

可進入路由集合 = `me.modules` 中有 route 的 `link` 與 `hidden` 模組。可進 = 有那個模組路由,僅此一條。

| 網址                   | 行為                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| 模組路由               | 顯示該模組頁面                                                                             |
| 群組路由(如 `/system`) | 轉到該群組下側欄順序深度優先第一個 `link`;沒有 → 無權限頁                                  |
| `/`                    | 整棵側欄樹第一個 `link`(有總覽權限即 `/overview`);沒有 → 無權限頁                          |
| 隱藏頁路由 + 尾端一段  | 如 `/…/edit-page/<id>`:去掉最後一段後對上 `hidden` 模組才放行,那段以 `routeParam` 傳給頁面 |
| 其餘                   | 無權限頁(明示是權限問題)                                                                   |

- 尾端一段的退路只給 `hidden`;`link` 後面多一段就是打錯網址。
- 群組路由與 `/` 是同一個函式 `firstLinkRoute`,只差起點。
- 「總覽」是正式模組(`overview`),由角色授權。
- 殼(`ShellLayout`)用的集合另外併入殼層固定路由(`withShellRoutes`),頁名、「?」說明與路由頁籤因此認得個人設定;`ModuleRoute` 與側欄只看 `me.modules`。殼層固定路由後面多一段不算命中。

正本:`apps/admin/src/lib/base/module-tree.ts` 的 `enterableRouteMap` / `matchModuleRoute` / `firstLinkRoute`、`apps/admin/src/lib/base/shell-routes.ts`、`docs/testing/permission-scenarios.md` 劇本 7 / 13

## 頁籤兩種

判準:它是不是一個網址。

| 種類     | 是什麼                        | 規則                                                                                             |
| -------- | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| 路由頁籤 | 殼的 `RouteTabs`;一個網址一個 | 與路由防守同一個比對;以完整網址去重;關閉切相鄰;sessionStorage 以使用者分 key 保留;進不去的被剔除 |
| 頁內分頁 | `PageTabs`;同一網址內切換區塊 | 不是路由、不進頁籤列;目前分頁記在網址參數(`?tab=`),重新整理、分享網址都回到同一頁                |

- 帶識別碼的詳情 / 編輯頁是**詳情子頁籤**:每筆一個,標籤「所屬模組名 — 項目名」。項目名由頁面拿到資料後經 `useRouteTabItemLabel` 提供,殼不查業務資料。
- 項目名最前面接頁面種類(「檢視・項目名」「編輯・項目名」),同一筆的詳情與編輯分得出來。組法是字典 `admin.formEngine.pages.tabLabelWithAction`,文字是 `admin.formEngine.pages.actions`:
  - 固定欄位模組:頁面把頁面種類傳給 `useRouteTabItemLabel` 的第二個參數(`"view"` / `"edit"`),由它組。
  - 表單模組與申請中心詳情:項目名由頁籤模板算出(`lib/base/form-engine/tab-label.ts` 的 `renderTabLabel`,模板沒寫 `{{action}}` 時自動接在最前面),呼叫端傳組好的字串、不給第二個參數;見 `docs/modules/forms.md`。
- 刪除成功後,那一筆的詳情與編輯子頁籤一起關掉(以 `<隱藏頁路由>/<id>` 網址前綴比對,別筆不動):在詳情頁刪除 → 導向所屬模組的列表頁(沒綁列表頁 → 導向 `/`,與關掉最後一個頁籤的落點一致);從列表刪除 → 當前頁籤不變。做法是 `useRouteTabsStore` 的 `closeItemTabs`,各刪除流程成功後經 `hooks/base/useCloseItemTabs` 呼叫,不自己導向列表。
- 要出現在頁籤列、有自己的網址 → 做成(隱藏頁)路由。只是同一頁的不同面向 → 頁內分頁。

正本:`apps/admin/src/lib/base/route-tabs.ts`、`apps/admin/src/stores/base/useRouteTabsStore.ts`、`apps/admin/src/app/AdminShell/RouteTabs/useRouteTabs.ts`、`apps/admin/src/hooks/base/useRouteTabItemLabel.ts`、`apps/admin/src/hooks/base/useCloseItemTabs.ts`

## 頁面狀態放網址(useUrlState)與頁內分頁(PageTabs)

任何頁面都能用,不限有頁內分頁的頁面。新頁面一律用 `useUrlState`,不自行讀寫 `useSearchParams`(REACT-14)。

| 項目       | 做法                                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 介面       | `useUrlState(key, schema)` 回 `[值, 寫入]`;寫入可給新值或 `(目前值) => 新值`                                                       |
| 一個 key   | 一包值:物件寫 JSON(`?list={"status":"done","page":2}`),字串直接寫(`?tab=mine`);同一頁對應不同 API 的區塊用不同 key                 |
| 驗證與預設 | zod schema,預設值寫在 schema 的 `.default(…)`;網址沒有這個 key、或被改壞(JSON 壞掉、值不合 schema)時回預設值,不報錯                |
| 寫入       | `replace`,不堆上一頁紀錄;寫回預設值時 key 從網址拿掉;經 react-router 的 navigate,`useLocation` 讀到的網址與畫面一致                |
| 套件       | `nuqs`(adapter `nuqs/adapters/react-router/v8`),由 `app/providers/RootProviders.tsx` 最外層的 `NuqsAdapter` 接上;頁面不直接用 nuqs |

放與不放網址的判準見 REACT-14 的表:篩選、關鍵字、排序、頁碼、頁內分頁、打開的詳情放;未存的輸入、敏感資料、大量勾選、暫時性介面狀態不放。

**`PageTabs`**(`components/base/PageTabs/`)建在 `@repo/ui/tabs` 上,只多兩件事:

- **目前分頁記在網址**:內部用 `useUrlState`,預設 key 是 `tab`(同一頁有兩組分頁時用 `urlKey` 換);網址上的分頁不存在或看不到時顯示第一個看得到的分頁,不寫回網址。
- **分頁權限**:分頁設 `permission`,`hasPermission` 不成立就不顯示;只剩一個分頁時不顯示分頁籤、直接顯示內容(右側動作 `actions` 仍在);一個都看不到時整個不渲染。

只有選到的分頁內容會掛載。放不下時分頁籤維持單列、橫向捲動:還有分頁的那一側顯示漸層 + ‹ / ›(點了捲一段),捲到底的那一側兩者都消失;選到的分頁(含從網址打開)自動捲進可視範圍。捲動是 `@repo/ui/tabs` 的 `scrollable`,窄寬同一行為。與殼的 `RouteTabs` 無關。

正本:`apps/admin/src/hooks/base/useUrlState.ts`、`apps/admin/src/lib/base/url-state.ts`、`apps/admin/src/components/base/PageTabs/`、`packages/ui/src/Tabs/Tabs.tsx`、`docs/standards/react/components.md` REACT-14

## 頁內權限判斷

- `usePermissions().hasPermission(key)`:`me.modules` 的 permissions 組成集合,判斷規則來自 `@repo/domain/permission`。
- 業務模組的 `item.abilities` 直接讀,不與 `usePermissions` 相乘;治理模組的 `Role.abilities` 要相乘。見 `docs/concepts/authorization.md`「abilities 的兩種語意」。

正本:`apps/admin/src/hooks/base/usePermissions.ts`、`packages/domain/src/permission/keys.ts`

## 表格兩種

| 種類        | 用在哪                                                    | 欄位渲染              | 入口                  |
| ----------- | --------------------------------------------------------- | --------------------- | --------------------- |
| `Table`     | 治理頁的小表、彈窗裡的表、有分頁的清單                    | `render(row, ctx)`    | `@repo/ui/table`      |
| `DataTable` | 大量資料的列表:列虛擬捲動、欄寬拖拉、左右固定欄、表頭排序 | `render(ctx)`(可省略) | `@repo/ui/data-table` |

- 兩者的 `ctx` 是同一個型別 `CellRenderContext`(`{ value, row, rows, index, column }`)。

正本:`docs/standards/react/components.md` REACT-13、`packages/ui/src/DataTable/`、`packages/ui/src/Table/`

## 共版型(CRUD 模組的前端藍本)

一個 CRUD 模組 = 一份 `DemoModuleConfig`。列表、詳情、表單三頁是共用元件,不用改。

| 誰負責   | 內容                                                                                   |
| -------- | -------------------------------------------------------------------------------------- |
| 共用元件 | 版型、兩層權限判斷、分頁、未儲存離開、刪除確認、錯誤擺放                               |
| 設定物件 | 模組 key、權限 key、欄位定義、`useRows` / `useItem` / `useSave` 三個 hook、slot 與開關 |

- 共用元件不認得任何模組的 GraphQL 型別。
- 兩個實例:`SampleOneModule.tsx`(全選配)、`SampleTwoModule.tsx`(最小可行)。
- 實例在 `pages/base/demo/`,專案實例放 `pages/project/`;兩方直接使用 `components/base/crud/`,專案不用引用或修改示範頁。
- 新增模組的完整步驟見 `docs/agents/module-scaffold.md`。
- 欄位由使用者在後台自訂的模組不走共版型,走表單引擎(`docs/modules/forms.md`)。

正本:`apps/admin/src/components/base/crud/demo-module-config.ts`、`apps/admin/src/components/base/crud/`

## 操作結果提示(Snackbar)

- 每支 mutation 都經 `useMutationFeedback`:成功或失敗各跳一則。
- 狀態在 `stores/base/useSnackbarStore`;`AppProviders` 裡的 `SnackbarProvider` 是全站唯一出口。
- 位置:電腦 / 平板右下角距邊 24;手機底部左右 16 滿寬(有底部導覽時放在它上面)。
- 堆疊:所有提示(操作結果、可撤銷、新通知)一律往上疊,新的在下面;最多 3 則,第 4 則出現時最舊的那則消失。
- 時間:一般 4 秒、有動作(例 [撤銷])8 秒自動消失;滑鼠移上去或鍵盤焦點在卡片內時暫停,移開(焦點離開)後重新計時;點畫面其他地方不關。
- 可撤銷與新通知提示經 `useSnackbar()` 的 `show(severity, message, { title, action })`,各模組不另寫提示元件。
- 一次操作只跳一則;多步流程自己在最後呼叫一次。
- 成功文案 key:`<ns>.feedback.<action>Success`。失敗文案用該頁的錯誤解讀(回 `AdminError`)。
- 彈窗開著時提示被 `aria-hidden`,由 `SnackbarAnnouncer` 以 `role="status"` 補念最新一則。

正本:`apps/admin/src/hooks/base/useMutationFeedback.ts`、`apps/admin/src/app/providers/SnackbarProvider.tsx`、`@repo/ui/snackbar`、`apps/admin/src/lib/base/errors.ts`、`docs/standards/react/data-fetching.md` DATA-06

## 快取規則

| 資料           | 規則                                                                         |
| -------------- | ---------------------------------------------------------------------------- |
| `me`           | `staleTime: Infinity`、`retryOnMount: false`;要更新一律主動 invalidate       |
| 模組陣列與權限 | 在 `me` 裡;角色或授權異動後,自己的改動主動失效 `me`,別人的改動重新整理才看到 |
| mutation 之後  | 先用回傳 payload `setQueryData`,再精準 invalidate 清單與單筆                 |
| query key      | 一律用 codegen 的 `getKey`,不自創字串                                        |

- 禁止整站 refetch 或重新整理頁面來同步資料。
- 登出或換人:清 react-query 快取(見 `docs/concepts/accounts-and-tenants.md`「多分頁」)。

正本:`apps/admin/src/hooks/base/useMe.ts`、`docs/standards/react/data-fetching.md` DATA-02 / DATA-04

## zustand store 與瀏覽器儲存

| store                   | 內容                       | 保存位置                       |
| ----------------------- | -------------------------- | ------------------------------ |
| `useSessionStore`       | access token(只在記憶體)   | 記憶體                         |
| `useLocaleStore`        | 語言                       | localStorage                   |
| `useSideNavStore`       | 側欄收合                   | localStorage(不分使用者)       |
| `useRouteTabsStore`     | 路由頁籤                   | sessionStorage(以使用者分 key) |
| `useSnackbarStore`      | 目前那一則提示             | 記憶體                         |
| `useDesignerDraftStore` | 表單設計器有沒有未存的變更 | 記憶體                         |
| `useWorkflowDraftStore` | 流程設計器有沒有未存的變更 | 記憶體                         |

- 外觀不在 zustand:由 `AppThemeProvider` 存 localStorage(見上方「外觀」)。
- 儲存鍵由 `@repo/project-config/public` 的 `createAdminStorageKeys(projectPublic.slug)` 產生,格式是 `<slug>-admin-<用途>`;分使用者的鍵再加 `:<userId>`。slug 是專案的穩定識別,品牌更名不跟著改,變更 slug 會換掉整組瀏覽器儲存鍵。鍵與相容搬移設定登記在 `docs/branding.md`。

正本:`apps/admin/src/stores/`
