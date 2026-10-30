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

| 區塊      | 做什麼                                                                                                                                                                                                                     | 程式                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| SideNav   | `me.modules` 以 `parentId` 組樹;`group` 可展開、`link` 可點、`hidden` 不顯示;頂部是當前組織的商標(自己沒有就沿 `ancestors` 由近到遠繼承上層的商標,整條鏈都沒有才顯示組織名);可收合;精簡版(< `md`)改成抽屜;模組列可掛待辦數 | `app/AdminShell/SideNav/`、`stores/base/useSideNavStore.ts`      |
| AppBar    | 頁名、「?」模組說明、當前組織切換器、頭像選單;精簡版(< `md`)說明與頭像選單移到側欄抽屜                                                                                                                                     | `app/AdminShell/AppBar/`、`components/base/OrgSwitcher/`         |
| RouteTabs | 開過的路由各一個頁籤;可關閉、可批次關閉、可拖曳排序、鍵盤可操作                                                                                                                                                            | `app/AdminShell/RouteTabs/`、`stores/base/useRouteTabsStore.ts`  |
| 內容區    | `<main>`:高度由殼給、自己捲動;宣告 `lg` / `xl` 的頁有最小寬度                                                                                                                                                              | `app/AdminShell/ShellLayout.tsx`、`AdminShell/shell-geometry.ts` |

- 殼的設計稿節點登記在 `docs/branding.md`。

正本:`apps/admin/src/app/AdminShell/`、`apps/admin/src/lib/base/module-tree.ts` 的 `buildNavTree`

### 側欄

- **兩種寬度**:展開 240px、收合成 64px 圖示列(`NavRail`)。收合態的群組以浮層展開子項;圖示格的提示就是模組名稱(REACT-10 的例外)。
- **精簡版(< `md`,手機與直拿平板)改成抽屜**:側欄放進從左側滑出的 `NavDrawer`(`@repo/ui/drawer`),預設收起;AppBar 最左的主選單鈕打開,點遮罩、按 Esc、點了模組連結就關(點群組列只展開子項)。抽屜裡一律展開、沒有收合開關;底部放精簡版頂部列移走的頭像選單與「?」模組說明(`SideNav/MobileNavFooter`,沿用同一組元件),從那裡換頁(個人設定)也會關。開關狀態在 `useSideNavStore`,不存檔;視窗拉寬到 `md` 以上時重設為收起。`md` 以上(橫拿平板、電腦)維持左欄(含收合)。頂部列精簡、側欄抽屜、抽屜底部三者用同一個界線(`shell-geometry.ts` 的 `SHELL_COMPACT_BELOW` / `useIsShellCompact`),主題斷點沿用 MUI 預設(sm 600 / md 900 / lg 1200)。
- 收合狀態存 localStorage,是這台瀏覽器的偏好,不分使用者。
- 側欄只有模組樹那一格捲動,底部的收合開關永遠看得到。
- **側欄計數(badges)採登記制**:`ShellLayout` 把「模組 key → 數字 + 說明」傳給 `SideNav`,數字大於 0 才顯示;展開態畫數字(`@repo/ui/badge`,超過 99 顯示 `99+`)、收合態畫小圓點,抽屜沿用展開態。登記了說明的數字,滑鼠移到數字上(觸控裝置長按數字)出現「數什麼」的提示(`@repo/ui/tooltip`,補充說明、不換掉數字的無障礙名稱;REACT-10);收合態的小圓點不提示說明,提示仍是模組名稱。數字一律來自 `sidebarBadges`(`hooks/base/useSidebarBadges.ts`),前端不寫死任何模組。

#### 側欄計數登記制

| 環節     | 做法                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 登記     | api 的功能模組(底座或專案)匯入 `SidebarBadgesModule`,在 `onModuleInit` 呼叫 `SidebarBadgeRegistry.registerBadge({ moduleKey, count(operator), requires?, descriptionKey? })`(`requires` 選填,見下一列;`descriptionKey` 選填,是「數什麼」說明文字在 admin 訊息檔的完整 key,通知設定頁「側欄數字」區塊顯示、側欄數字的提示也用它,沒給 = 設定頁顯示「—」、側欄不提示);模組 key 空白或重複、`descriptionKey` 空白 → app 起不來                                                                                                                                                                                                                                                                                                                                        |
| 查詢     | `sidebarBadges: [{ moduleKey, count, descriptionKey }]` 一次回傳登入者看得到的所有模組;「看得到」看登記時的門檻:**預設(沒填 `requires`)** = 角色綁了那個模組就算(`me.modules` 有它,與進得去那一頁同一個判斷,ADR-0011);**填了 `requires`(權限 key)** = 綁了模組而且持有那條權限(`holdsPermission`,同層 `*` 照常展開),例:申請中心填 `apply-center.view`,數字與列表一致。**租戶調整過「誰看得到」**(通知設定頁「側欄數字」區塊,存 `sidebar_badge_settings`;`docs/modules/notification-settings.md`「側欄數字」)= 綁了模組仍是前提,之後改用那份人員條件(`AudienceService.matchesAudience`)判斷、不再看 `requires`;還原預設回到上面兩種。看不到的模組不回傳;某一筆計算失敗只略過那一筆並記 log。數字本身的租戶、可見範圍、資料範圍由 `count` 自己負責,底座只依門檻過濾 |
| 送出信號 | 數字變了,寫入端在交易後呼叫 `RealtimePublisher.publishBadge(tenantId, moduleKey, userIds)`,對那些人送 `badge:<模組 key>`(一次 `/publish` 帶多個 `user:` 頻道);每天才變的計數由專案排程每天送一次                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 重抓     | 底座的信號登記 `badge:*`(`app/base/realtime-signals.ts`,結尾 `:*` 是前綴登記)收所有 `badge:<模組 key>` → 重抓 `sidebarBadges`;專案新增計數不必在前端登記。連線中不輪詢;斷線時跟 `RealtimeProvider` 每 60 秒重抓、重連後先補抓一次,收到信號約 2.5 秒後再補抓一次。同一份登記表也登記 `notification`(新的站內通知):重抓 🔔 的未讀數與開著的通知清單,右下角的新通知提示由通知鈴的 `useNotificationAlerts` 處理                                                                                                                                                                                                                                                                                                                                                       |
| 本人寫入 | 自己的寫入改變了數字時,由寫入端失效重查(申請中心:`useInvalidateApplyCenterCounts` 同時失效頁籤與側欄的數字)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**申請中心**登記為 `apply-center`(`workflows/apply-center/apply-center-badge.ts`):側欄只顯示 `myTasks`(待我處理的任務數);兩個頁籤的數字(含 `myApplications`)繼續用 `applyCenterCounts`(`hooks/base/useApplyCenterCounts.ts`),進申請中心或切頁籤重取到的 `myTasks` 比側欄快取新時寫進側欄那一筆,頁籤與側欄不會一新一舊,也不會被較舊的頁籤快取拉回去。流程任務建立、結束、改派時,流程引擎對相關審核者送 `badge:apply-center`,同時重抓頁籤與側欄的數字。

### 內容區的寬度與內距

- **最小寬度**:頁面以 `minWidth` 宣告「排得下的最窄視窗」(主題斷點 `md` / `lg` / `xl`,`shell-geometry.ts` 的 `ShellMinWidth`),在 `app/base/module-pages.ts`(專案頁在 `app/project/`)的頁面宣告設定,組裝後由 `app/module-pages.tsx` 的 `modulePageMinWidths` 交給殼;客製替換未寫 `minWidth` 時繼承底座值。
  - **殼層預設 `md`:平板寬(含橫拿平板 1024)就完整顯示、不需水平捲動**,內容隨視窗縮放,寬表格靠表格自己的橫向捲動(STYLE-11),放不下的區塊由頁面自己換版(篩選收進抽屜、設計器左清單收起等)。新頁一律做到這一級;`md` 在 ≥ `md` 的視窗本來就放得下,所以不產生下限。底座頁都是這一級(1024 實測每一頁的 `<main>` 都不水平捲動)。
  - **`lg` / `xl`:例外宣告**,給還沒做平板版、比該斷點窄就排不下的頁。只在完整版殼(視窗 ≥ `md`,與側欄抽屜同一條界線 `SHELL_COMPACT_BELOW`)套用:內容區最小寬度 = 斷點 − 側欄寬(隨收合狀態)− 左右內距,視窗介於 `md` 與該斷點之間時由 `<main>` 水平捲動,不擠壓內容。宣告時在登記那一行註明排不下的理由。
  - **精簡版(< `md`,手機與直拿平板)一律不設下限**,不論宣告哪一級;頁面自己處理窄版(REACT-17)。
  - 目前底座頁都沒有宣告:表單管理與流程管理(兩個設計器)在 `xl` 以下由設計器自己換版(`pages/base/system/designer-layout.ts`),平板寬(`sm`–`lg`)改成左清單收起、屬性面板右側抽屜(REACT-17「平板設計器」)。document 本身不出現水平捲軸。
- **內距**:手機寬(< `sm`)8px,其餘 24px(`MAIN_PADDING`)。
- **高度**:殼外框固定 `100vh`,`<main>` 以 `flex: 1` + `minHeight: 0` 取得確定的高度,頁面可以撐滿(STYLE-08)。

正本:`apps/admin/src/app/AdminShell/shell-geometry.ts`、`apps/admin/src/app/AdminShell/ShellLayout.tsx`

### AppBar 與頭像選單

- **精簡版(< `md`,手機與直拿平板)**:頂部列只留主選單鈕、頁名(放不下以省略號截斷)、通知鈴與精簡版組織切換(當前組織名稱首字的小按鈕,點了展開同一份組織清單、走同一個切換流程);「?」模組說明與頭像選單移到側欄抽屜底部。界線與側欄抽屜相同(`SHELL_COMPACT_BELOW`);頂部列左右內距只在手機寬(< `sm`)縮小。`md` 以上維持下列完整版面。
- **頁名**:目前網址對上的模組名。`/` 與群組路由會立刻轉到底下第一個能進的頁面(`firstLinkRoute`),轉走前標題留空,不閃「沒有權限進入此頁面」。群組底下一個都進不去時停在無權限頁,標題顯示「沒有權限進入此頁面」,其他對不上模組的網址也一樣;`/` 一個都進不去時標題維持留空。
- **「?」模組說明**:只有模組路由才有。內容由底座與專案 help 合成,Markdown 原文在 build 時打包;開啟彈窗才懶載入渲染元件。表單模組沒有專屬檔時用通用的 `form-module.help.md`;都沒有就停用。
- **當前組織切換器**:`SelectField`(精簡版頂部列是首字小按鈕,點了展開 `@repo/ui/menu` 的 `Menu`,走同一個切換流程);切換後換發 access token,並失效 `me`;同時立即換發即時通道的訂閱憑證(換到別的租戶時改連新租戶的 Durable Object)。
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
- **殼層固定路由**(目前只有個人設定 `/settings/personal`):開在殼裡,但不是模組、不分配給角色、不經 `ModuleRoute`,所有登入者都能開。`lib/base/shell-routes.ts` 的 `withShellRoutes` 把它以一筆不在側欄的頁面形狀(`link`、精準比對)併進殼用的路由集合,AppBar 頁名、「?」說明(key `personal-settings`)與路由頁籤因此和模組頁走同一條路;`ModuleRoute` 的權限判斷不吃這份。做成殼層路由而不是模組,是因為個人設定只放本人的通知開關與代理人;做成模組就得分配給每個角色,漏掉的角色裡的人就不能設代理人。
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

### 站在根組織時的提示(RootOrgNotice / withTenantRequired)

根組織不屬於任何最上層組織,只在最上層組織底下有意義的功能(租戶自己的設定、業務資料)站在根組織時,api 回 `FORBIDDEN` + reason `TENANT_ONLY`。前端統一用 `components/base/RootOrgNotice/` 先講清楚,並附當前組織切換器(與 AppBar 同一個 `OrgSwitcher`),切換後原處換成那個組織的內容。

| 用法                                             | 何時用                                                      | 例                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| `withTenantRequired(Page)`                       | 整頁都只對最上層組織底下有意義:登記頁面時套上               | 站在根組織 → 只顯示提示卡片,不掛頁面本身(不發頁面的查詢);`me` 未載入照常 |
| `<RootOrgNotice variant="inline" message={…} />` | 頁面在根組織仍可看(例如只讀預設值),只有部分操作要切到組織裡 | 通知設定頁的根組織唯讀說明                                               |
| 同上,放在錯誤位置                                | api 回 `TENANT_ONLY`(例如別的分頁剛切到根組織)              | 通知設定 / 側欄數字的編輯與還原預設、表單管理的流程綁定                  |

- 不給 `message` / `hint` 用預設字串 `admin.shell.rootOrgNotice.*`;專案要換說法寫進 `project/admin.replacements.json`(I18N-06),不另做一份元件。
- 這只是提示,守門仍在 api;要不要顯示租戶專屬 / 根組織專屬的按鈕看 `useIsAtRootOrg()`。

正本:`apps/admin/src/components/base/RootOrgNotice/`、`apps/admin/src/hooks/base/useIsAtRootOrg.ts`

### 殼上的常駐元件

登入後一直存在、不屬於任何頁面的元件(例:全域的鍵盤或掃描監聽、跟著它開的小視窗),登記成殼上的常駐元件,不掛在某一頁。

| 來源     | 檔案(`apps/admin/src/`)           | 維護內容                                       |
| -------- | --------------------------------- | ---------------------------------------------- |
| 底座     | `app/base/shell-extensions.ts`    | `baseShellExtensions`(目前沒有)                |
| 專案     | `app/project/shell-extensions.ts` | `projectShellExtensions`                       |
| 固定入口 | `app/module-pages.tsx`            | 合成兩份為 `shellExtensions`,交給 `AdminShell` |

- 每一筆是不收 props 的元件,`AdminShell` 依登記順序渲染在即時通道與審核擴充的 provider 裡面、`ShellLayout` 旁邊;登出(殼卸載)就跟著卸載。
- 元件自己讀 `useMe()` / `usePermissions()` 決定要不要做事,沒有權限時不登記監聽、不渲染內容。要開的對話框由元件自己渲染(MUI Dialog 經 portal 疊在頁面上)。

正本:`apps/admin/src/app/module-pages.tsx`、`apps/admin/src/app/AdminShell/AdminShell.tsx`

### 條碼槍掃描(useScanner)

條碼槍是鍵盤輸入:字元間隔不超過 `SCANNER_KEY_INTERVAL_MS`(30ms)、長度至少 `SCANNER_MIN_LENGTH`、以 Enter 結尾,就視為一次掃描。門檻是程式常數,不放租戶設定或個人偏好。

- 頁面以 `useScanner(purpose, handler)` 宣告掃描用途;掛上期間讀到的碼交給它,同時有多頁宣告時最後掛上的優先。
- 沒有頁面宣告時,交給 `registerDefaultScanHandler(handler)` 登記的預設處理(只有一個,再登記換掉前一個;通常由[殼上的常駐元件](#殼上的常駐元件)登記)。
- 游標在一般輸入框時也攔截,確認是掃描後輸入框還原成原值;標記 `data-scanner-field`(自己或祖先)的輸入框自己處理掃描,不攔。輸入法組字中不判斷。
- `injectScan(code)` 走同一條分派(測試、相機掃描用);沒有任何處理者時回 `false`。
- 有登記時才在 `globalThis` 掛一個 capture 階段的 keydown 監聽,全部撤銷後拆掉。

正本:`apps/admin/src/hooks/base/useScanner/`

### 閃爍提示(useFlashTarget)

掃到某一筆、剛加進清單的那一列等「告訴使用者剛才動到哪裡」的提示,統一用一次性的外框主色光暈淡出,不另做動畫。

- `useFlashTarget<T>()` 回 `{ target, flash, clear }`:`flash(目標)` 記下要閃的目標並給遞增的 `nonce`,同一個目標連續觸發也會換序號。
- 畫面上的元件比對 `target` 決定自己要不要閃:要閃的套 `FLASH_HIGHLIGHT_SX`(`lib/base/flash-highlight.ts`),並以 `target.nonce` 當 `key` 讓元件重掛,動畫才會重播;另標 `data-flash="true"` 給測試確認。
- 要捲到目標旁邊由使用處自己在 `target` 變了時做(`scrollIntoView`),hook 不碰 DOM。

正本:`apps/admin/src/hooks/base/useFlashTarget.ts`、`apps/admin/src/lib/base/flash-highlight.ts`

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

| 種類     | 是什麼                        | 規則                                                                                                                           |
| -------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 路由頁籤 | 殼的 `RouteTabs`;一個網址一個 | 與路由防守同一個比對;以完整網址去重;每個頁籤記「路徑 + 網址參數」;關閉切相鄰;sessionStorage 以使用者分 key 保留;進不去的被剔除 |
| 頁內分頁 | `PageTabs`;同一網址內切換區塊 | 不是路由、不進頁籤列;目前分頁記在網址參數(`?tab=`),重新整理、分享網址都回到同一頁                                              |

- **路由頁籤記住網址參數**:頁面以 `useUrlState` 寫進網址的篩選、頁碼、頁內分頁,由殼的同步(`syncEntries`)記到目前頁籤上(`search`,與路徑存在同一筆、同一把 sessionStorage key)。切回頁籤、從側欄點已開著的那一頁,都回到它記下的參數(側欄連結的網址由 `SideNav/useNavLinkHref` 帶上);頁籤關掉後再從側欄打開是預設條件。頁面內的「返回列表 / 取消 / 存完離開」同樣帶回列表頁籤記下的參數(`hooks/base/useRouteTabHref`,與關閉頁籤、刪除後回列表同一個規則)。用帶參數的網址打開時以網址為準:頁籤已開著就換掉原本的條件,沒開就開新的;參數被 `useUrlState` 清掉(格式錯誤)時頁籤記下的也跟著清。
- **批次關閉選單**(`RouteTabs/RouteTabMenu.tsx`):關閉左側 / 右側 / 其他所有分頁,沒有可關的那一項停用。叫出方式共用同一份選單:右鍵;觸控長按約 0.5 秒(按住不動才算,移動超過拖曳門檻 6px 就交給拖曳,長按放開後不切換頁籤);頁籤列最右的「⋯」(作用在目前頁籤,沒有目前頁籤時停用);焦點在頁籤時按選單鍵或 Shift+F10。目前頁沒被關 → 畫面不動;目前頁被關 → 切到按右鍵 / 長按的那一頁(帶回它記下的網址參數;用「⋯」時作用頁就是目前頁,不會被關)。單一關閉照舊切相鄰。狀態規則是 `lib/base/route-tabs.ts` 的 `closeLeftOf` / `closeRightOf` / `closeOthers`(回 `{ entries, navigateTo }`,同 `closeEntry`),store 的 `closeBatch` 呼叫它們。
- **拖拉排序的共用設定**(`hooks/base/useSortableItem.ts`;路由頁籤與表單設計器共用):`usePointerDragSensors` 只有 dnd-kit 的指標感應器(滑鼠、觸控、筆),移動超過 `DRAG_START_DISTANCE`(6px)才算拖曳,之內是點擊;`useSortableItem(id)` = `useSortable` + 拖曳中的樣式 `dragSx`(位移、過場、浮到上層、抓取游標、`touchAction: none`),元件面板這種只拖不排的用 `dragTranslateOf`。鍵盤不走 dnd-kit(頁籤以 Shift+方向鍵搬,設計器以點擊與屬性面板操作)。`DndContext` / `SortableContext`(碰撞偵測、排序策略、無障礙播報)仍由各處自己包:頁籤列是一條橫列加播報,設計器是多分區網格加外部拖入,兩者差在這一層,硬抽成一個元件反而要開一堆開關。測試以 `test/dnd-kit-double.tsx` 換掉整個 dnd-kit 模組(共用 hook 也跟著吃替身)。
- 帶識別碼的詳情 / 編輯頁是**詳情子頁籤**:每筆一個,標籤「所屬模組名 — 項目名」。項目名由頁面拿到資料後經 `useRouteTabItemLabel` 提供,殼不查業務資料。
- 項目名最前面接頁面種類(「檢視・項目名」「編輯・項目名」),同一筆的詳情與編輯分得出來。組法是字典 `admin.formEngine.pages.tabLabelWithAction`,文字是 `admin.formEngine.pages.actions`:
  - 固定欄位模組:頁面把頁面種類傳給 `useRouteTabItemLabel` 的第二個參數(`"view"` / `"edit"`),由它組。
  - 表單模組與申請中心詳情:項目名由頁籤模板算出(`lib/base/form-engine/tab-label.ts` 的 `renderTabLabel`,模板沒寫 `{{action}}` 時自動接在最前面),呼叫端傳組好的字串、不給第二個參數;見 `docs/modules/forms.md`。
- 刪除成功後,那一筆的詳情與編輯子頁籤一起關掉(以 `<隱藏頁路由>/<id>` 網址前綴比對,別筆不動):在詳情頁刪除 → 導向所屬模組的列表頁(沒綁列表頁 → 導向 `/`,與關掉最後一個頁籤的落點一致);從列表刪除 → 當前頁籤不變。做法是 `useRouteTabsStore` 的 `closeItemTabs`,各刪除流程成功後經 `hooks/base/useCloseItemTabs` 呼叫,不自己導向列表。
- 要出現在頁籤列、有自己的網址 → 做成(隱藏頁)路由。只是同一頁的不同面向 → 頁內分頁。

正本:`apps/admin/src/lib/base/route-tabs.ts`、`apps/admin/src/stores/base/useRouteTabsStore.ts`、`apps/admin/src/app/AdminShell/RouteTabs/useRouteTabs.ts`、`apps/admin/src/hooks/base/useRouteTabItemLabel.ts`、`apps/admin/src/hooks/base/useCloseItemTabs.ts`

## 頁面狀態放網址(useUrlState)與頁內分頁(PageTabs)

任何頁面都能用,不限有頁內分頁的頁面。新頁面一律用 `useUrlState`,不自行讀寫 `useSearchParams`(REACT-14)。

| 項目       | 做法                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 介面       | `useUrlState(key, schema)` 回 `[值, 寫入]`;寫入可給新值或 `(目前值) => 新值`                                                                                             |
| 一個 key   | 一包值:物件寫 JSON(`?list={"status":"done","page":2}`),字串直接寫(`?tab=mine`);同一頁對應不同 API 的區塊用不同 key                                                       |
| 驗證與預設 | zod schema,預設值寫在 schema 的 `.default(…)`;網址沒有這個 key、或被改壞(JSON 壞掉、值不合 schema、舊格式)時回預設值,不報錯,並以 `replace` 把壞掉的那一個 key 從網址清掉 |
| 寫入       | `replace`,不堆上一頁紀錄;寫回預設值時 key 從網址拿掉;經 react-router 的 navigate,`useLocation` 讀到的網址與畫面一致                                                      |
| 套件       | `nuqs`(adapter `nuqs/adapters/react-router/v8`),由 `app/providers/RootProviders.tsx` 最外層的 `NuqsAdapter` 接上;頁面不直接用 nuqs                                       |

放與不放網址的判準見 REACT-14 的表:篩選、關鍵字、排序、頁碼、頁內分頁、打開的詳情(主從版面選中的那一筆、唯讀的檢視彈窗)放;未存的輸入、敏感資料、大量勾選、暫時性介面狀態,以及新增 / 確認類(刪除、停用、撤銷)彈窗不放;編輯彈窗只放那一筆的 id(`?edit=<id>`),內容不放。

- **key 的慣例**:列表的篩選、關鍵字、排序、頁碼放一包 `list`;主從版面選中的那一筆放 `detail`(`hooks/base/useUrlSelectedId`,`?detail=<id>`;網址上的 id 不在清單裡時退回預設的那一筆);頁內分頁 `tab`;唯讀的檢視彈窗 `dialog`(值是彈窗名,例 `?dialog=retired`);編輯彈窗 `edit`(只記那一筆的 id,打開時讀最新資料;`hooks/base/useUrlEdit`,情境表見 REACT-14);某一筆底下的子清單頁碼(成員、持有人)連同那一筆的 id 一起存(`{ org, page }`),換一筆自然回第一頁。`view` 不用:mock 開發模式以 `?view=tenant` 切視角(`mock/browser.ts`)。
- **入口清單**:每個路由頁面都要登記它放進網址的 key —— 底座頁在 `app/base/url-state-inventory.ts`、專案頁在 `app/project/url-state-inventory.ts`,`app/url-state-inventory.test.ts` 各自比對自己的來源(新頁面沒登記就失敗)。`useUrlState` 以外直接 import `useSearchParams` 或 nuqs 由 `apps/admin/eslint.config.js` 的 `no-restricted-imports` 擋下。

### 既有頁面改用的盤點

每個既有頁面放進網址的內容(REACT-14;程式端登記在 `apps/admin/src/app/base/url-state-inventory.ts`,由入口清單測試把關)。「不放」欄寫刻意留在畫面狀態的東西與理由。

| 頁面                                                | 放進網址                                                                                                                                                                                                                                                                                           | 不放(理由)                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 登入、變更密碼                                      | `next`(登入 / 改完要回去的網址,唯讀)                                                                                                                                                                                                                                                               | 帳號、密碼輸入(未存輸入、敏感)                                                                                                                                                                                                                                                                                   |
| 設定密碼                                            | `token`(信裡的連結,唯讀)                                                                                                                                                                                                                                                                           | 新密碼輸入(未存輸入、敏感)                                                                                                                                                                                                                                                                                       |
| 忘記密碼                                            | —                                                                                                                                                                                                                                                                                                  | Email 輸入(未存輸入)                                                                                                                                                                                                                                                                                             |
| 總覽                                                | —                                                                                                                                                                                                                                                                                                  | 沒有篩選                                                                                                                                                                                                                                                                                                         |
| 個人設定                                            | `tab`(`PageTabs`)、`list`(代理人清單頁碼)                                                                                                                                                                                                                                                          | 偏好表單的輸入(未存輸入)                                                                                                                                                                                                                                                                                         |
| 示範模組1 / 2 列表、表單模組列表(預設組裝)          | `list`:搜尋、模組自有篩選 / 表單 / 狀態、頁碼                                                                                                                                                                                                                                                      | 刪除確認、啟用切換中的那一列(暫時性);選表單(`FormPicker`)彈窗(暫時性)                                                                                                                                                                                                                                            |
| 示範模組詳情 / 新增 / 編輯頁、表單模組新增 / 編輯頁 | —(識別碼已在路徑上)                                                                                                                                                                                                                                                                                | 表單輸入(未存輸入)                                                                                                                                                                                                                                                                                               |
| 表單模組詳情頁                                      | `dialog=revisions`(修訂紀錄,唯讀檢視彈窗)、`revision`(正在檢視的舊修訂,`FormSubmissionDetail`)                                                                                                                                                                                                     | 刪除 / 作廢確認(確認類彈窗)                                                                                                                                                                                                                                                                                      |
| 組織管理                                            | `detail`(選中的組織)、`tab`(組織資料 / 成員,`PageTabs`)、`members`(成員頁碼)、`edit`(編輯組織彈窗;編的就是選中的那一個,`?edit=` 同時決定選中)                                                                                                                                                      | 新增子組織 / 開通彈窗(未存輸入;開通的模組勾選是大量勾選)、停用 / 刪除 / 撤銷(確認類)、編輯彈窗的內容、加入成員的已選名單(未存輸入)、樹的展開(暫時性)                                                                                                                                                             |
| 使用者管理                                          | `list`:左樹選的組織、搜尋、頁碼;`edit`(編輯使用者彈窗,以 id 讀最新單筆)                                                                                                                                                                                                                            | 新增彈窗、編輯彈窗的內容(含身分證字號,敏感)、所屬組織 / 角色 / 複製彈窗(未存輸入)、停用確認(確認類)                                                                                                                                                                                                              |
| 角色管理                                            | `list`:搜尋、擁有組織、頁碼;`detail`(選中的角色);`tab`;`users`(持有人頁碼);`edit`(編輯角色彈窗,以 id 讀最新單筆)                                                                                                                                                                                   | 權限矩陣的未存勾選(未存輸入、大量勾選)、新增 / 加入使用者彈窗、編輯彈窗的內容(未存輸入)、停用 / 刪除確認(確認類)、矩陣樹的收合(暫時性)                                                                                                                                                                           |
| 模組與權限                                          | `detail`(選中的節點)、`dialog=retired`(退役權限清單,唯讀檢視彈窗)                                                                                                                                                                                                                                  | 列表欄位配置彈窗(設定類彈窗,改的是模組層的列表設定,不是編輯某一筆資料,`?edit=` 不適用)、停用確認與退役權限的刪除確認(確認類)、樹的收合(暫時性)                                                                                                                                                                   |
| 欄位管理                                            | `detail`(選中的類別)、`edit`(編輯選項彈窗,從選中類別的最新清單取那一筆)                                                                                                                                                                                                                            | 新增選項 / 新增類別彈窗、編輯彈窗的內容(未存輸入);編輯類別彈窗(編的是左欄選中的那個類別,同一頁的 `edit` 已給選項用,不另開 key —— 見盤點備註)                                                                                                                                                                     |
| 資料範圍                                            | `detail`(選中的資料目標)                                                                                                                                                                                                                                                                           | 規則編輯器的草稿(未存輸入)、放棄變更確認(確認類);套用對象下拉裡權限樹的搜尋(`PermissionTreePanel` 的 `keyword`:下拉選單裡的暫時性篩選,收起就沒了,編的又是未存的草稿)                                                                                                                                             |
| 表單管理                                            | `list`:搜尋;`detail`(選中的表單 key);`edit`(編輯名稱與標題彈窗;`?edit=` 同時決定選中)                                                                                                                                                                                                              | 右欄「設計 / 版本」頁籤與檢視中的版本(綁在選中的那一張表單上,換表單回第一頁;設計器有未存變更時要攔下 —— REACT-14 的兩類例外)、建新表單 / 以此為基底(新增類,還沒有那一筆)、分派 / 列表欄位彈窗(設定類彈窗,改的是分派對象與模組層的列表設定,不是編輯某一筆資料)、平板寬左清單的收起 / 展開與屬性抽屜的開關(暫時性) |
| 流程管理                                            | `list`:搜尋;`detail`(選中的流程 key);`edit`(改名稱彈窗;`?edit=` 同時決定選中)                                                                                                                                                                                                                      | 同表單管理:右欄頁籤與檢視中的版本、建流程 / fork(新增類)、分派彈窗(設定類,不是編輯某一筆資料)、平板寬左清單的收起 / 展開與屬性抽屜的開關(暫時性)                                                                                                                                                                 |
| 阻擋清單                                            | `list`:篩選(阻擋 / 需要推進)、頁碼                                                                                                                                                                                                                                                                 | 改派 / 新增審核者彈窗(未存輸入)                                                                                                                                                                                                                                                                                  |
| 通知設定                                            | `list`:搜尋、頁碼;`edit`(編輯收件人彈窗,以類型 key 讀最新那一筆);`badge`(側欄數字的修改彈窗,以模組 key 對上區塊清單那一列)                                                                                                                                                                         | 還原預設確認(確認類)、編輯彈窗的條件(未存輸入)                                                                                                                                                                                                                                                                   |
| 申請中心                                            | `tab`(我的申請 / 待我審核,`PageTabs`)、`list`:模組、表單、狀態或處理狀態、頁碼                                                                                                                                                                                                                     | 新申請彈窗(暫時性);兩個分頁共用 `list`,切分頁時清回預設                                                                                                                                                                                                                                                          |
| 申請中心詳情                                        | —(識別碼已在路徑上)                                                                                                                                                                                                                                                                                | 審核意見、退回原因(未存輸入)                                                                                                                                                                                                                                                                                     |
| 印表機管理                                          | `tab`(印表機 / 代理程式 / 列印紀錄,`PageTabs`)、`list`:三個分頁共用一個 key(印表機:組織、狀態;代理程式:顯示已停用;列印紀錄:印表機、結果;各含頁碼),切分頁時清回預設;`edit`(編輯印表機彈窗,值是印表機 id;只從目前這一頁的清單找那一台 —— api 沒有單筆查詢,只帶 `?edit=`、那台不在這一頁時判成找不到) | 新增印表機 / 新增代理程式(新增類;配對碼不該出現在網址)、重新配對 / 停用(確認類)、測試列印(一次性動作,結果只在彈窗裡)                                                                                                                                                                                             |

稽核:底座目前沒有稽核頁面,沒有可盤點的對象;做稽核頁時照同一套登記。

**`PageTabs`**(`components/base/PageTabs/`)建在 `@repo/ui/tabs` 上,只多兩件事:

- **目前分頁記在網址**:內部用 `useUrlState`,預設 key 是 `tab`(同一頁有兩組分頁時用 `urlKey` 換);網址上的分頁不存在或看不到時顯示第一個看得到的分頁,不寫回網址。
- **分頁權限**:分頁設 `permission`,`hasPermission` 不成立就不顯示;只剩一個分頁時不顯示分頁籤、直接顯示內容(右側動作 `actions` 仍在);一個都看不到時整個不渲染。

分頁殼(`PageTabs` 外面那張卡片)的高度依目前分頁決定:列表分頁(`PageTabItem.isList`)在寬 ≥ `md` 且視窗高 ≥ 720px 時釘高、表格在卡片裡捲;手機寬、寬但矮的視窗與其餘分頁整頁捲(`usePageTabsShellSx`;條件的正本是 `lib/base/list-page-layout.ts` 的 `listPagePinMediaQuery`,規則見 STYLE-08)。

只有選到的分頁內容會掛載。放不下時分頁籤維持單列、橫向捲動:還有分頁的那一側顯示漸層 + ‹ / ›(點了捲一段),捲到底的那一側兩者都消失;選到的分頁(含從網址打開)自動捲進可視範圍。捲動是 `@repo/ui/tabs` 的 `scrollable`,窄寬同一行為。與殼的 `RouteTabs` 無關。

正本:`apps/admin/src/hooks/base/useUrlState.ts`、`apps/admin/src/lib/base/url-state.ts`、`apps/admin/src/components/base/PageTabs/`、`packages/ui/src/Tabs/Tabs.tsx`、`docs/standards/react/components.md` REACT-14

### 組織選擇器

選組織一律照下表挑元件與設定(規範 REACT-15);不在表上的用途先補進這張表再做。

| #   | 用途           | 元件                                                                               | 設定                                                                                                                                                     | 例子                                                                                |
| --- | -------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| ①   | 切換目前組織   | `OrgSwitcher`(`components/base/OrgSwitcher/`;殼的頂列,< `md` 是精簡版 `isCompact`) | 列操作者的所屬組織;切換後整個 app 換當前組織                                                                                                             | 頂列「當前組織」                                                                    |
| ②   | 治理頁的組織樹 | `OrgTreePicker`                                                                    | 管理範圍(`orgTree`),樹本身就是頁面主體                                                                                                                   | 組織管理、使用者管理的左側樹                                                        |
| ③   | 治理設定挑組織 | `OrgTreeSelect`,`scope="managed"`(預設)                                            | 只列管理範圍(`orgTree`,要組織 / 使用者管理的檢視權),單選或多選                                                                                           | 人員條件的所屬組織、資料範圍的套用對象、流程的跳過組織                              |
| ④   | 業務表單欄位   | `OrgTreeSelect`,`scope="visible"`                                                  | 列**整棵租戶樹**(`tenantOrgTree`),只有可見範圍內的能選,其他反灰並註明「不在你的可見範圍內」;單選;呼叫端的 `disabledReasons` 疊加(例「已由 王小明 對應」) | 業務資料的所屬組織、人員可負責的組織                                                |
| ⑤   | 頁面篩選       | `OrgTreeSelect`,`scope="visible"`                                                  | 同 ④;預設目前組織(值放網址),單選,或多選加 `maxCount` 上限                                                                                                | 報表的組織(多選、上限)、依組織設定的規則 / 行事曆;表單列表的組織(單選、不給 = 全部) |
| ⑥   | 共用給其他組織 | `OrgTreeSelect`,`scope="tenant"`                                                   | 整棵租戶樹都能選;多選、「含下層」選項(之後由資料共用的票做)                                                                                              | (之後)資料共用                                                                      |

- `tenantOrgTree`:當前組織所屬租戶的整棵樹,每個節點只帶名稱、上層、停用狀態與「可見 / 可管理」兩個旗標;釘在當前組織的租戶(別的租戶不出現),根組織成員從根組織起整棵樹。只要登入。
- 已選但樹上沒有的組織(別的租戶、範圍外)欄位顯示「不在你的管理範圍內」(`managed`)/「不在你的可見範圍內」(`visible` / `tenant`),可以取消。

正本:`apps/admin/src/components/base/OrgTreeSelect/OrgTreeSelect.tsx`、`apps/admin/src/lib/base/org-tree.ts`(`tenantTreeToOrgNodes`)、`docs/modules/org-manager.md`「api 介面」

**列表篩選 `FilterDrawer`**(`components/base/FilterDrawer/`;規格 RW-01 / RW-01b):電腦(≥ `lg`)把篩選欄位攤在列表上方、改了立刻套用;平板(`sm`–`lg`)[篩選 (N)] 從右側滑出抽屜、手機(< `sm`)從底部升起。抽屜裡是同一組欄位(`renderFields(value, change)`,呼叫端只寫一份)+ [清除] [套用]:改的是草稿,[套用] 才寫回(通常是 `useUrlState` 的篩選),關掉不套用;關鍵字搜尋框(`search`)一直留在外面。抽屜外框是 `@repo/ui/drawer`。先例:表單模組的預設列表(`FormListPage` 的 `FormListToolbar`)。

**日期篩選欄 `DateFilterPicker`**(`components/base/DateFilterPicker/`):篩選列(含抽屜)的日期欄一律用它,不直接用 `@repo/ui/date-picker`。鍵盤打到一半(年份沒打滿、只填部分區段、2/31)畫面保留打的字、查詢不動,打完或清空才回呼;打到一半就離開欄位,畫面還原成套用中的值。值是當地日期 `YYYY-MM-DD`,沒條件是 `null`。

正本:`apps/admin/src/components/base/FilterDrawer/FilterDrawer.tsx`、`apps/admin/src/components/base/DateFilterPicker/DateFilterPicker.tsx`、`packages/ui/src/Drawer/Drawer.tsx`

`Drawer` 另有**非遮罩**模式(`isModal={false}`,MUI `persistent`,就地渲染、不開 portal):不蓋遮罩、不鎖焦點,抽屜外照樣能看、能點,給「邊看邊改」的用途;元件自己補上打開時焦點移進抽屜、抽屜裡按 Esc 關閉、關閉時焦點還給打開前的元素,內容是以標題命名的 region;`topOffset` 讓紙面從殼的頂部兩列下面開始(admin 給 `lib/base/shell-header-geometry.ts` 的 `SHELL_HEADER_HEIGHT` = 頂部列 + 頁籤列,不蓋通知、頭像與頁籤列的「⋯」);右側抽屜寬預設 `DRAWER_SIDE_WIDTH`(360,匯出讓呼叫端算要讓出多寬),內容放不下時以 `width` 改(例:要並排月曆的抽屜給 460),非遮罩抽屜的呼叫端讓出空間時要用同一個值。就地渲染的好處是 Tab 順序跟著頁面位置、祖先藏起來時抽屜跟著藏;代價是祖先不能有 `transform` / `filter`(紙面是 `position: fixed`)。先例:兩個設計器在平板寬的屬性面板(`pages/base/system/DesignerPropertyPanel.tsx`,REACT-17「平板設計器」)。

## 頁內權限判斷

- `usePermissions().hasPermission(key)`:`me.modules` 的 permissions 組成集合,判斷規則來自 `@repo/domain/permission`。
- 業務模組的 `item.abilities` 直接讀,不與 `usePermissions` 相乘;治理模組的 `Role.abilities` 要相乘。見 `docs/concepts/authorization.md`「abilities 的兩種語意」。

正本:`apps/admin/src/hooks/base/usePermissions.ts`、`packages/domain/src/permission/keys.ts`

## 日期與時間的顯示

日期 / 日期時間在 admin 一律是**時點**(api 只收時點:GraphQL 的 `DateTime` 輸入拒收只有日期 / 沒帶時區的字串,見 `docs/standards/api/graphql-schema.md` GQL-08),顯示一律經 `@repo/domain/form` 的 `formatTemporal(value, { type, timezone })`,時區用讀者當前租戶的時區(`me.currentOrg.timezone`),不各頁自己 `toLocaleString`。`type`:

| type           | 輸出                       | 用在                                          |
| -------------- | -------------------------- | --------------------------------------------- |
| `date`         | `2026-10-12`               | 一般日期欄、列表                              |
| `datetime`     | `2026-10-12 14:35`         | 一般日期時間欄、紀錄時間                      |
| `monthDay`     | `10/12`、`3/5`             | 同年份內的密集畫面(行事曆格、卡片),月日不補零 |
| `monthDayTime` | `10/12 14:35`、`3/5 09:05` | 同上,帶時間(時分補零)                         |

空值 → 空字串;不是時點的字串原樣回;時區不合法以 UTC 顯示。正本:`packages/domain/src/form/temporal.ts`;規則見 `docs/concepts/form-engine.md`「日期與日期時間都是時點」。

**輸入欄位**:日期用 `@repo/ui/date-picker`、日期時間用 `@repo/ui/date-time-picker`、時間用 `@repo/ui/time-picker`(收發 `HH:mm`,24 小時制;`minutesStep` 限定分鐘格子,`minTime` / `maxTime` 限定範圍),不用原生 `type="date"` / `type="time"`(STYLE-05)。三者共用 `DatePicker/usePickerDraft.ts` 的草稿行為:打到一半不往外送值,`onChange` 第二參數 `{ isIncomplete }`。`DatePicker` 的 `shouldDisableDate` 讓個別日期反灰不可選。

**MUI X 的輸入暫時處理**:三者經 `usePickerDraft` 共用 `DatePicker/useFieldInputGuard.ts`,在欄位外層攔截 `@mui/x-date-pickers` 9.14.0 的三個問題 —— 輸入法組字的數字被套用兩次([mui/mui-x#9465](https://github.com/mui/mui-x/issues/9465))、全形數字打不進去、`contenteditable` 打空白產生的 NBSP 被當成 0(尚未回報)。處理後組字確認的數字只交給 MUI 一次、全形數字當半形、空白與 `-` `/` `:` 一樣略過。**升級 `@mui/x-date-pickers` 時**,先拿掉 `slotProps.textField` 上的 `fieldInputProps`、跑三個元件測試裡「輸入法組字、全形數字、空白」那組,仍失敗就保留攔截;MUI 修正後刪掉 `useFieldInputGuard.ts` 與 `test/field-input.ts` 的用法。

**「今天」與時區**:要以「今天」為準的地方(月曆的今天、預設日期、本月)用 `apps/admin/src/hooks/base/useTenantToday.ts`,回租戶時區的 `YYYY-MM-DD`(進畫面時取一次),不用 `new Date()` / `dayjs()` 取瀏覽器的日期。底座 `MonthCalendar` 與 `ScheduleTimeline` 收 `timezone`(admin 傳 `useTenantTimezone()`):沒給 `today` 時以它推今天;`ScheduleTimeline` 的刻度、長條位置、點擊帶出的時點與時間文字也都依它,「一天」= 該時區的 00:00–24:00。沒給 `timezone` 時退回瀏覽器時區,只適合 story / 測試。

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
- 時間:一般 4 秒、有動作(例 [撤銷])8 秒自動消失;滑鼠移上去或鍵盤焦點在卡片內時暫停,移開(焦點離開)後重新計時;點畫面其他地方不關。唯一的例外是新版本提示(不自動消失,見下一節),由 `show` 的 `autoHideDuration: null` 指定。
- 可撤銷與新通知提示經 `useSnackbar()` 的 `show(severity, message, { title, action })`,各模組不另寫提示元件。
- 一次操作只跳一則;多步流程自己在最後呼叫一次。
- 成功文案 key:`<ns>.feedback.<action>Success`。失敗文案用該頁的錯誤解讀(回 `AdminError`)。
- 彈窗開著時提示被 `aria-hidden`,由 `SnackbarAnnouncer` 以 `role="status"` 補念最新一則。

正本:`apps/admin/src/hooks/base/useMutationFeedback.ts`、`apps/admin/src/app/providers/SnackbarProvider.tsx`、`@repo/ui/snackbar`、`apps/admin/src/lib/base/errors.ts`、`docs/standards/react/data-fetching.md` DATA-06

## 新版本提示

部署後已開著的分頁(含安裝成 app 的視窗)仍跑舊 bundle;偵測到就提示使用者重新整理。

- **版本**:build 時烘進 bundle(`import.meta.env.APP_VERSION`,部署的 commit SHA,沒有就是 build 時間),同值輸出 `/version.json`。
- **檢查時機**:分頁回到前景一律抓;換路由時距上次檢查滿 1 分鐘才抓。不定時輪詢。
- **不比版本、直接提示**:lazy chunk 載入失敗(`vite:preloadError`)、api 回 `GRAPHQL_VALIDATION_FAILED`(組裝根的 QueryClient 以 `queryCache` / `mutationCache` 的 `onError` 交給 `reportAppUpdateError`)。
- **頁面 error boundary**:殼的 `<Outlet>` 外包 `PageErrorBoundary`。頁面 render 拋錯(含 lazy chunk 載入失敗 —— Vite 照樣拋出,沒有 boundary 時整棵樹卸載、提示也跟著消失)只換掉頁面區,顯示「頁面載入失敗」+ [重新整理];側欄、AppBar、頁籤列與全站提示都留著。錯誤是 chunk 載入失敗(`isChunkLoadError`)時同時跳「系統已更新」提示;換路由(路徑改變)就重置,換到別頁即恢復。整張路由表(`AppRoutes`)外另包一層,接殼外的登入頁、忘記密碼等(出錯時整頁換成替代畫面,提示照出);殼內那層先接住。
- **提示**:全站 Snackbar,資訊色「系統已更新」+ [重新整理](<`location.reload()`>),不自動消失、不擋畫面;同時只有一則,按 ✕ 關掉後下一次觸發再顯示。被後來的 3 則提示擠掉時同理。
- 掛在組裝根 `App.tsx` 的 router 裡(`AppUpdateNotice`),登入頁也偵測得到;`vite dev` 與 mock 模式沒有版本,不啟動。

正本:`apps/admin/src/hooks/base/useAppUpdateNotice.ts`、`apps/admin/src/app/PageErrorBoundary.tsx`、`apps/admin/src/lib/base/app-version.ts`、`apps/admin/scripts/app-version-plugin.mjs`;快取與部署見 `docs/deployment.md`「admin 的靜態檔快取」

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

| store                   | 內容                        | 保存位置                       |
| ----------------------- | --------------------------- | ------------------------------ |
| `useSessionStore`       | access token(只在記憶體)    | 記憶體                         |
| `useLocaleStore`        | 語言                        | localStorage                   |
| `useSideNavStore`       | 側欄收合                    | localStorage(不分使用者)       |
| `useRouteTabsStore`     | 路由頁籤                    | sessionStorage(以使用者分 key) |
| `useSnackbarStore`      | 畫面上的提示佇列(最多 3 則) | 記憶體                         |
| `useDesignerDraftStore` | 表單設計器有沒有未存的變更  | 記憶體                         |
| `useWorkflowDraftStore` | 流程設計器有沒有未存的變更  | 記憶體                         |

- 外觀不在 zustand:由 `AppThemeProvider` 存 localStorage(見上方「外觀」)。
- 儲存鍵由 `@repo/project-config/public` 的 `createAdminStorageKeys(projectPublic.slug)` 產生,格式是 `<slug>-admin-<用途>`;分使用者的鍵再加 `:<userId>`。slug 是專案的穩定識別,品牌更名不跟著改,變更 slug 會換掉整組瀏覽器儲存鍵。鍵與相容搬移設定登記在 `docs/branding.md`。

正本:`apps/admin/src/stores/`
