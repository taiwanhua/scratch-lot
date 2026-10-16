# 測試(TEST)

## TEST-01 測行為,不測實作

斷言使用者(或呼叫端)可觀察的結果;不斷言內部 state、私有函數、呼叫次數(mock 系統邊界除外)。重構不該弄壞測試。

```tsx
✅ expect(screen.getByText("還沒有食譜")).toBeInTheDocument();
❌ expect(component.state.recipes).toHaveLength(0);
```

## TEST-02 測試名稱描述行為,中文可

```ts
✅ it("空清單時顯示空狀態文案", …)
❌ it("works", …)  /  it("test recipes", …)
```

## TEST-03 前端 mock 在網路層(MSW),不 mock hooks

用 MSW 攔截 GraphQL 請求回假資料;禁止 mock `useXxxQuery` 本身 — mock hooks 等於沒測資料流。

## TEST-04 AI 協作流程:測試先行,人審測試即驗收介面

1. AI 先寫測試(紅燈,包含「編譯不過」— 測試就是介面設計)
2. 人 review 測試 = 驗收介面與行為設計
3. 通過後才實作到綠燈

## TEST-05 劇本 E2E 只手動跑,不進每個 PR 的 CI

Playwright 的用途收斂成一件事:把 `docs/testing/permission-scenarios.md` 的 **24 條權限劇本**從人工驗收
改成機器裁決。E2E 慢且脆、數量是成本,所以解法是「**寫了但不自動跑**」:

- **跑的時機只有手動觸發**:本機 `pnpm e2e`、CI 是 `.github/workflows/e2e.yml`(只有 `workflow_dispatch`)。
  `ci.yml` **不引用** e2e —— 一條劇本要 build api + admin、起 Mongo、執行 update 再開瀏覽器,
  放進每個 PR 會把免費方案的 Actions 額度吃光。
- **誰決定跑**:使用者。改到權限解析、模組樹 / 路由防守、示範模組、角色矩陣的票,交件時在 PR 註明
  是否建議跑、理由與建議的劇本;使用者決定後才觸發(`gh workflow run e2e.yml --ref <分支>`)。
  agent 不自己觸發,票面的驗收條件也不寫「跑 E2E」。
- **劇本以外的行為不寫 E2E**:一般頁面行為交給 admin 的元件測試(TEST-08)、api 的整合測試(TEST-07)。
  E2E 仍然是最貴的那一層,「數量是成本」這件事沒變。

寫法見 TEST-11;harness 與跑法見 `apps/e2e/README.md`。正本:`.github/workflows/e2e.yml`、`.github/workflows/ci.yml`

## TEST-06 測試檔與受測物同層

新測試放受測檔旁邊 `xxx.test.ts(x)`(如 `packages/ui/src/CounterButton/CounterButton.test.tsx`);既有的 `__tests__/` 目錄沿用不強制搬。

## TEST-07 api 的整合測試:打真的 GraphQL 端點,對真 MongoDB

api 的功能測試只有一個接縫:用 supertest 對啟動起來的 Nest app 打 `/graphql`(本地自起 mongodb-memory-server;CI 用 service container),驗回應與資料庫最終狀態。固定做法(先例:`apps/api/src/auth/auth.test.ts`、`apps/api/src/auth/test-support/auth-app.ts`):

- **夾具**:測試開始前以**子行程**跑 db-migrator 的 `seed` 指令(完整 `update` 的相容別名)執行 migration 並建立種子資料(root 帳號、模組樹、權限、種子角色);STRUCT-01 禁 app 互 import,所以不能 import seed 的程式碼。額外的測試角色 / 使用者用 RelationService 具名方法或直接寫測試資料庫建(測試檔不受裸查詢禁令約束)
- **連資料庫的子行程一律非同步**:測試裡會連到同行程 mongodb-memory-server 的子行程(seed、update、遷移腳本、CLI)不得用 `spawnSync`。mongod 是測試行程的子程序,輸出靠測試行程的事件迴圈讀;`spawnSync` 擋住事件迴圈時管線塞滿、mongod 停住,子行程報 `Server selection timed out` 或卡死。用 api 的 `auth-app.ts`(`seedDatabase` / `runMigratorUpdate`)或 db-migrator 的 `test/support/update-harness.ts`(`startNode` / `runNode` / `startEntry`)。子行程自設逾時時要低於 hook 逾時,逾時就 kill 子行程並帶出輸出尾端(先例 `auth-app.ts` 的 `MIGRATOR_TIMEOUT_MS`)。例外:不連這個 mongod 的子行程(建置、git、lint 腳本)可以用 `spawnSync`
- **信件不真寄**:注入記錄用的 `MailService` adapter,測試從它讀出 token 走下一步;api 未設 `RESEND_API_KEY` 時本來就是這個模式
- **測試專用的 resolver / module**(如驗 `@RequirePermission` 用的探針端點)放 `test-support/`,只在測試的 `extraModules` 掛上;**測試用 app 的 schema 走記憶體**(`NODE_ENV=test` 時 `autoSchemaFile: true`),探針才不會寫進提交的 `schema.gql`
- 例外:某個能力在 GraphQL 端點上看不到(如守門器產出的操作者上下文)才允許經 `app.get(Service)` 從 DI 取出來驗 — 這是第二個接縫,PR 要說明理由
- 執行:ts-jest 只轉譯不做型別檢查(`isolatedModules`),型別交給 `check-types`;整張 Nest 依賴圖做型別檢查會讓第一次啟動超過 5 分鐘

### 專案功能與資料登記的整合驗收

- `extraModules` 繼續用於權限探針;驗收專案登記則只替換 `project/api-modules.ts` 與 `project/database/registrations.ts` 的來源,經真正的 AppModule / DatabaseModule 啟動 fixture。不得只把 fixture module 直接塞進 `extraModules`,或 mock 組裝器、guards、repository、`OrgBusinessDataReader`,來宣稱正式登記可用。
- fixture 的資料與授權由隔離測試環境建立,不改正式 seed。以真 GraphQL / MongoDB 驗證授權、租戶隔離、軟刪除與資料範圍;專案資料即使被資料範圍隱藏,仍須阻止刪組織及撤銷開通,其他組織資料不誤擋,檢查失敗不能放行。
- 碰撞與缺少必要資料保護的負例須在組裝或啟動時失敗;另保留真實正式登記來源的載入驗證。fixture 的 import 例外只限所有權方向,不擴大 raw query 豁免(STRUCT-12)。

### seed 測試的來源

- 共用測試使用明確的 fixture 來源,經正式組裝與更新程序執行。固定數量、空定義、碰撞及負例不讀引用專案的正式 seed,也不把 fixture 疊在未知的 project 登記上。
- API 的 `seedDatabase`、`runMigratorUpdate` 與 reset 測試使用 `apps/db-migrator/test/fixtures/seeds-base/registry.ts`;migration 仍讀正式來源。專案測試若需要自己的種子,可在測試資料庫建立後透過 `runMigratorUpdate` 明給 `--registry=<路徑>`,不修改共用夾具。
- 正式 `seeds/registry.ts` 另驗實際登記、命名與來源政策,不得因隔離 fixture 而刪掉正式來源檢查。專案新增合法設定不應改變共用負例的涵義。
- 修改這些測試來源時,同時驗空 project 與含專案模組、表單、流程的來源;沿用 `SeedSource` / `SeedSet`,不另外維護一種測試設定格式。

正本:`apps/db-migrator/src/seed/seed-formal-registry.test.ts`、`seed-composition.test.ts`、`seed-key-convention.test.ts`、`seed-test-sources.test.ts`、`apps/api/src/auth/test-support/auth-app.ts`

## TEST-08 admin 的元件測試:MSW 攔網路層 + React Testing Library

先例:`apps/admin/src/test/`(`setup.ts` MSW 生命週期、`msw/server.ts`、`msw/auth-handlers.ts`、`render.tsx` 的 `renderApp()`),測試檔與元件同資料夾、同名 `.test.tsx`(GEN-01)。

### 環境與逾時

- preset 用 `@repo/jest-presets/browser-esm`(jsdom + Node 的 fetch / Request / Response / BroadcastChannel 全域給 MSW;ts-jest ESM 模式 —— react-router、use-intl 只出 ESM);`packages/ui` 用同一個 preset 但覆寫 `testEnvironment`(TEST-09)。
- 渲染一律用 `renderApp()`;`test/test-app.tsx` 與正式 `App.tsx` 共用 `RootProviders`(既有 AppProviders 加上表單模組 options 注入),測試 app 再接 Router。不要裸 render 元件或各自重建一套 providers。
- 表單 options 的 context 與 hook 在 `hooks/base/useFormModuleOptions.ts`,Provider 在 `app/providers/FormModuleOptionsProvider.tsx`。元件測試經 test-app 或 hooks 層 context 注入設定,不從 components 測試反向 import app Provider;缺 Provider 應報接線錯誤,有 Provider 但缺 key 才用預設。
- **逾時有兩層**:preset 的 `testTimeout` 15 秒(單一測試;CI runner 慢,jsdom + MSW + ts-jest ESM 的第一個測試要付暖機成本),以及 testing-library 的 `findBy*` / `waitFor`(`src/test/setup.ts` 已 `configure({ asyncUtilTimeout: 5000 })`)。個別測試不自行加 timeout。
- Jest 設定拆成多個 `projects` 時,在根設定沿用 `testTimeout: preset.testTimeout`。`testTimeout` 是全域選項,只放在各 project 的 preset 不會生效,會退回 Jest 預設的 5 秒;不要另寫較長時限。先例與正本:`apps/admin/jest.config.mjs`、`packages/jest-presets/browser-esm/jest-preset.mjs`。
- **httpOnly cookie 在 jsdom 看不到**,用 `authWorld({ hasRefreshCookie })` 這類旗標模擬「瀏覽器有沒有帶 cookie」並計數請求;MSW `server.use()` 的 handler **先列的先贏**。
- **Vite 專屬語法進不了 jest**:`import.meta.glob`(`?raw` 載入 md、圖片清單…)是 Vite 的編譯期轉換,jest 直接載入會 `(intermediate value).glob is not a function`。做法:**把讀檔與組裝入口集中在 `lib/base/help-registry.ts`**,測試用 `moduleNameMapper` 整支換成 `src/test/help-registry.ts`(保留相同介面與 set/reset,`setup.ts` 每個測試後歸零)。兩邊共用 `lib/base/module-help.ts` 的純合成與查詢,測試來源也分 base / additions / replacements;判斷邏輯不能藏在被換掉的入口。**不要**逐檔 `jest.unstable_mockModule` —— 殼的所有測試都會經過它,等於每個測試檔都要動。
- **jest 的 `moduleNameMapper` 也是先列的先贏**:`^@/lib/base/help-registry$` 這種精確鍵要排在通則 `^@/(.*)$` **前面**,否則被通則吃掉(`apps/admin/jest.config.mjs`)。
- **zustand store 是模組層單例**,`src/test/setup.ts` 要在每個測試後歸零。

### 專案頁面登記與 help

- 正式來源載入測試保留底座與專案實際登記表;專案 fixture 用獨立 Jest project 的精確 mapper 只替換 `app/project/module-pages.ts` 與 `app/project/page-replacements.ts`,走真正 `app/module-pages.tsx`、RootProviders、AppRoutes、ModuleRoute 與殼。不可 mock 組裝器或守門,也不能只用 `renderApp` 的 `extra` 掛客製頁來代替登記驗收。
- 斷言新增頁、同網址替換、移除替換回原版、寬度繼承與明確覆寫,以及撤銷授權後不能 render 或留下頁籤。表單要驗四頁、lazy、模板優先序、申請中心及不同 options 組裝互不污染。fixture 不進正式 project 清單,不放寬分層或循環依賴檢查。
- help 需分別驗三來源碰撞與替換規則、實際 HelpButton 顯示選中的內容及通用回退。另跑真 Vite build 與 `check:help-bundle`,涵蓋三來源、錯命名及必備底座通用檔;bundle 有文字只證明收檔,不等於替換內容已正確顯示。指令見 [toolbox](../../agents/toolbox.md#pnpm--turbo建置測試格式)。

### 依元件而定的陷阱

- **`React.lazy` + 動態 `import()` 不必 mock**:ESM 模式下 `import("@repo/ui/markdown")` 這種子路徑匯出在 jest 裡解得開,照常渲染。要改的只有斷言時機 —— 懶載入的內容多一個 `Suspense` tick,**該邊界底下的第一筆斷言一律用 `findBy*` / `waitFor`**(`await within(dialog).findByRole("heading", …)`),沿用 `getBy*` 會抓到 fallback 而紅;同一邊界底下後續的斷言不必再等。**不要斷言 fallback 本身**(chunk 常在同一個 tick 內就解析完,會偶發)。**lazy 元件的頁面測試要先 preload**:在 `beforeAll` 裡 `await import(<lazy 載入的那支模組>)`,第一次載入依賴鏈的成本就不會算進 `findBy*` 的 5 秒與單一測試的 15 秒 —— 全套並行時 CPU 被搶,現載整條依賴鏈會逾時。先例 `app/AdminShell/AppBar/HelpButton.test.tsx`。
- **用到 `DataTable`(`@repo/ui/data-table`)的頁面測試要在檔案頂層呼叫 `setupFakeViewport()`**(`apps/admin/src/test/viewport.ts`):jsdom 不算版面,offsetHeight / offsetWidth 都是 0,虛擬捲動會以為看得到 0 列而一列都不畫 —— 看起來像 MSW 沒回資料。先例 `components/base/form-engine/FormModulePages/FormListPage.test.tsx`、`app/ModulePages.test.tsx`。
- **用到 React Flow(`@xyflow/react`,流程設計器的流程圖)的頁面測試要在檔案頂層呼叫 `setupReactFlowEnvironment()`**(`apps/admin/src/test/react-flow.ts`):jsdom 沒有 `ResizeObserver` 與 `DOMMatrixReadOnly`,流程圖一掛就丟錯;替身只要「存在」—— 節點的 `width` / `height` 由設計器明給,不必真的量。兩個配套:①**點節點用 `fireEvent.click`,不要 `userEvent.click`**:節點掛了 d3-drag,userEvent 的指標事件會讓 d3 讀 `event.view.document` 而在 jsdom 炸掉(先例 `WorkflowsPage/workflows-page-test-support.ts` 的 `clickNode`);②**拖拉在 jsdom 模擬不了**,畫面測試走「上移 / 下移 / 移到分支」按鈕,放開時的放置規則另寫純函式測試(`lib/base/workflow/flow-drop.test.ts`)。鍵盤選取(聚焦節點按 Enter)可以用 `fireEvent.keyDown` 驗。
- **MUI 樹:點內容區只「選取」,展開 / 收合要點最前面的箭頭**(`@repo/ui/tree` 設了 `expansionTrigger="iconContainer"`):選取用 `userEvent.click(螢幕上那個節點的文字)`,展開用 `.MuiTreeItem-iconContainer`(`element.closest(".MuiTreeItem-content")?.querySelector(".MuiTreeItem-iconContainer")`)。先例 `packages/ui/src/Tree/Tree.test.tsx` 與 `OrgManagerPage` / `ModuleManagerPage` 的 `*-test-support.ts` 的 `clickNode`。點父不會把它收起來,同一個 `it` 可以連點父子兩層。
- **`pointer-events: none` 的 disabled 勾選框用 `fireEvent`,不要 `userEvent.click`**:MUI 對 disabled 的 Checkbox / Radio 設 `pointer-events: none`,`userEvent.click` 會**擲錯**(「unable to click element as it has or inherits pointer-events set to none」),看起來像元件壞了。要驗「點下去也沒事」時改 `fireEvent.click(box)`(先例 `packages/ui/src/Tree/Tree.test.tsx`),或依 TEST-09 的寫法用 `userEvent.setup({ pointerEventsCheck: 0 })`。
- **Autocomplete 的兩行選項一律用 `apps/admin/src/test/autocomplete.ts`**:`getByRole("option", { name })` 對兩行選項(主文字 + 次文字)的完整比對對不上 —— 無障礙名稱是兩行串起來的那一長串。共用 helper 有兩支:`openAutocomplete(actor, name)`(以無障礙名稱找 combobox、點開、回傳選項)與 `autocompleteOption(text)`(在展開的選單裡以**主文字**先比開頭、再比包含;找不到時把現有選項一起印出來)。新的呼叫端**直接用這兩支**,不要再各寫一份。
- **jsdom 的 `URL.createObjectURL` 在 `jest-fixed-jsdom` 會炸**(補回來的是 Node 的 `URL`,只收 Node 的 `Blob`),測到上傳預覽的頁面要在測試檔 stub(先例 `org-manager-test-support.ts` 的 `stubObjectUrl`)。
- **zustand `persist` 的 `setState` 會回寫 storage**:測「重新整理後狀態維持」時,直覺寫法 `useXStore.setState({ ... 預設值 })` + `rehydrate()` 會先把 localStorage 也覆寫成預設值,再讀回預設值 —— 看起來像「狀態沒被記住」,其實是測試自己把存檔抹掉了。正確順序是:**先把 storage 的內容存起來 → 歸零 store → 把存檔放回 storage → 才 `rehydrate()`**。

### MSW 夾具

- **夾具的形狀以 api 測試的斷言為準**(`apps/api/src/**/*.test.ts` 裡有現成斷言可對照;TEST-12 在網路層的特例):例如 api 對樹根的 `parentId` 一律回 `null`,夾具寫成有值,前端拿 `parentId` 判視角的 bug 在測試裡就會是綠的。
- **假伺服器若有「連動 / 狀態」語意就實作進 handler**,不要回固定資料:停用模組連動子樹、儲存後重查要拿到新值這類驗收條件,對著無狀態的假伺服器根本驗不到,還容易寫出「對著比 api 寬鬆的假伺服器才會過」的測試。先例 `test/msw/module-manager-handlers.ts`。
- **`graphqlError(code, message)` 的參數順序是「碼在前、訊息在後」**:簽章 `graphqlError(code, message = code, extensions = {})`(`src/test/msw/auth-handlers.ts`),`message` 省略時等於 `code`,所以**大多數情況只傳第一個參數**(`graphqlError("FORBIDDEN")`),要附 `reason` / `violations` 這類 `extensions` 才傳第三個。與 api 那側的 `GraphQLError(message, { extensions: { code } })` 順序相反,寫反時 MSW 回的 `code` 是人話,前端分流不到。
- **「閃一下」這種中間幀用 msw 的 `delay("infinite")` 擋住**:儲存成功後的重取一旦回來,畫面就是最終狀態,DATA-04 那種「先寫快取、避免閃一下舊值」的行為在測試裡**根本來不及被觀察到**。讓重取的那個 handler 永遠不回應(`await delay("infinite")`),中間那一幀就停在畫面上可以斷言;斷言完就結束該測試,不必收尾。要驗的是「寫入端有沒有把新值交給快取」,不是重取回來對不對。

### 頁面測試怎麼分檔

- 一頁一個 `<Page>.test.tsx` 放主流程;超過 `max-lines` 400 就依情境拆成 `<Page>Scope.test.tsx`、`<Page>Dialogs.test.tsx`…,共用的 world / 夾具 / helper 抽成同資料夾的 `<page>-test-support.ts`(kebab,非元件)。
- **多段接力載入的頁面**(先查清單 → 選中第一筆 → 再查它的細節)在測試裡要等兩段以上:把「等到第 n 段畫面就緒」抽成 `<page>-test-support.ts` 的 async helper 共用,不要每個案子各寫一串 `findBy*`。
- **設計器頁(表單 / 流程設計器)的測試一案只做一件事**(一個屬性分支、一次存草稿),只操作屬性面板的用小草稿(`forms-page-test-support.ts` 的 `smallDraft`)。一案串多個分支在全套並行時會超過 15 秒逾時,單獨跑卻是綠的。

### 怎麼跑

- **整包驗收**:依 [toolbox 的建置與測試指令](../../agents/toolbox.md#pnpm--turbo建置測試格式)執行,Turbo 會先 build 依賴。直接執行 app 的 test script 不經 Turbo、不會 build 依賴;新 checkout 或依賴改過時先做該節的建置前置步驟。
- **只跑一個測試檔**:照 `docs/agents/toolbox.md`「pnpm / turbo」的「單檔測試」列(`pnpm --filter <pkg> exec …`,admin / ui / api 各一行),常見錯法也列在那裡。
- **turbo 快取跨 worktree 共用**:同一份輸入在別的 worktree 跑過,在你這裡會直接 `cache hit, replaying logs`,根本沒有執行(root `package.json` 的 `scripts` 不在 global hash 內,見 `docs/agents/pitfalls.md`)。所以以下兩件事**進 package 目錄直接跑**,不經 turbo:
  - **取測試數基準**:在 `origin/main` 上跑 `pnpm run test`(`cd packages/ui`、`cd apps/admin` 各一次),不要沿用別的 PR 寫死的數字 —— 多票並行時別人先合的票會墊高基準。取基準的那幾分鐘**不要動工作樹**:jest 讀的是磁碟上當下的檔案,中途改檔會讓基準混進改到一半的自己。先把改動做成 WIP commit 或切回乾淨的 `origin/main` 再跑;依賴建置照 [toolbox 的建置前置步驟](../../agents/toolbox.md#pnpm--turbo建置測試格式)。
  - **交件前的 `lint` 與 `check-types`**:`cd apps/admin && pnpm run lint && pnpm run check-types`(`packages/ui` 同),否則 type-aware 的 lint 警告會漏到 CI 才被擋。整包驗收仍可用 turbo(`pnpm exec turbo run lint check-types`),但 cache hit 不代表你的改動被驗過。
- **輸出雜訊**:Jest 30 + ESM 印 experimental warning,無害;看結果用 `| grep -E "Tests:|FAIL|●"`。
- CI 把 admin 的 jest 以 `--shard` 分兩台並行(`test-admin-1` / `test-admin-2`,`.github/workflows/ci.yml`)。

### mock 開發模式:用同一批夾具把 admin 跑在瀏覽器上

沒有 dev 帳號、也不想連真 api 時,用**同一批 MSW 夾具**把整個 admin 跑起來,拿來截圖驗版面(admin 票的 PR 要附圖,見 `docs/agents/issue-tracker.md`)。跑的是**真的 `App`**(同一組 providers、路由與頁面),只有網路層被 service worker 接管。

建置前置步驟與啟動指令見 [toolbox 的 mock 模式](../../agents/toolbox.md#mock-模式)。`dev:mock` 會先建置 project-config,其他 workspace 依賴仍須完成前置建置。

**不要在埠參數前加 `--`**:`pnpm --filter … dev:mock -- --port …` 會把 `--` 原樣傳給 vite,vite 忽略其後的旗標、照樣從 3002 起跳。

**埠不要寫死 3002**(這是反覆被回報的一類):`3002` 只是 `vite.mock.config.ts` 的**偏好值**,被占用時 Vite 會**靜默跳到下一個埠**。多個 worktree 並行時,打開 `http://localhost:3002` 很可能連到**別人的**(或主 checkout 上一次沒關掉的)server —— 截出來的圖裡沒有自己的改動,而且完全看不出哪裡不對。兩條硬規則:

- **起的時候指定自己的埠並加 `--strictPort`**:埠被占就直接失敗,不會悄悄換一個。
- **看終端印出的 `Local:` 那一行為準**,不要憑記憶打網址;截圖前先在自己開的那個分頁上**確認畫面裡看得到自己這次的改動**(改了文案就找那句文案,改了版面就看那塊版面)。

- 預設**自動登入 root**、落在總覽;側欄的組織 / 使用者 / 角色 / 模組與權限 / 欄位 / 資料範圍都有假資料
- 網址參數:`?view=tenant` 切租戶管理員視角(少掉「模組與權限」「資料範圍」兩個 `isRootOnly` 模組、組織樹換成租戶那一棵)、`?auth=off` 停在登入頁(任何帳密都能登入)
- 深層網址與重新整理都可用(`vite.mock.config.ts` 把 HTML fallback 指到 `mock.html`)
- **截圖**:瀏覽器開自己那個埠的網址 → 走到要驗的頁 → 截整個視窗(側欄 + 內容),PR 內文逐張寫明「哪一頁、什麼狀態」;彈窗類的改動要各截一張開啟前後
- **會自動關掉的東西**(操作結果提示 Snackbar 那類,DATA-06)截不到時,在 console 把 `setTimeout` 暫時攔掉(`window.setTimeout = ((fn, ms) => ms > 1000 ? 0 : 原本的(fn, ms))`)再觸發一次,它就會停著等你截
- **MUI Dialog 裡的按鈕點不到**時不要跟合成點擊事件硬碰:瀏覽器工具的 `computer` 合成點擊會被 MUI 的 modal 攔截層吃掉,改用 `javascript_tool` 直接對該元素 `element.click()`

實作面三件事,改動前先看懂再動:

- **入口完全獨立**:`mock.html` + `src/mock/` + `mock-public/mockServiceWorker.js` + `vite.mock.config.ts`,正式 build 只讀 `vite.config.ts` 與 `index.html`,所以產物不含 msw(驗收:`pnpm --filter @repo/admin build` 後 `grep -c msw dist/assets/*.js` 為 0)
- **共用端點只留一份 handler**:`orgTree` / `org` / `users` / `roles` 有多個 world 各自實作,MSW 先列的先贏 —— `src/mock/mock-world.ts` 替每個共用端點指定正本、濾掉其餘同名 handler,不要改成單純串接
- **`msw/node` 在瀏覽器載不進去**:`src/test/msw/server.ts` 在模組層呼叫 `setupServer()`,mock 模式以 alias 換成 `src/mock/msw-node-stub.ts`(夾具只用到同檔的 `api`,`server` 僅出現在型別位置)。**不要為了 mock 模式去改 `src/test/msw/server.ts`** —— 那支是 jest 測試的正本

正本:`apps/admin/package.json`(`dev:mock`)、`apps/admin/vite.mock.config.ts`、`apps/admin/src/mock/`

## TEST-09 ui 元件測試:React Testing Library,斷言行為不只是不炸

`packages/ui` 的元件測試用 `@testing-library/react` + `user-event` + `jest-dom`(版本與 admin 同,守版本統一策略),`src/test/setup.ts` 載入 jest-dom 並 `afterEach(cleanup)`。

**jest 設定**(`packages/ui/jest.config.mjs`,理由註解寫在那裡):

- **preset 是 `@repo/jest-presets/browser-esm`**(ts-jest ESM 模式):react-markdown / remark-gfm 這類只出 ESM 的套件,CJS 模式一 `require` 就是 `Unexpected token 'export'`。
- **`testEnvironment` 覆寫回原生 `jsdom`**:`browser-esm` 為了 MSW 用的是 `jest-fixed-jsdom`,它把 `Blob` / `File` 換成 Node 的版本,`URL.createObjectURL` 那類 API 會炸(`UploadField` 的測試)。admin 需要 MSW,所以 admin 不做這個覆寫;ui 沒有 MSW,兩邊因此設定不同。

**每個元件至少驗**:渲染出設計稿的結構、主要互動(點擊 / 勾選 / 關閉)會回報、disabled 時不回報。只驗「`createRoot` 不炸」的冒煙測試不算數,碰到就改寫。

**MUI 9 的陷阱**:`Switch` 的 input 是 `role="switch"` 不是 `checkbox`;disabled 的核取框是 `pointer-events: none`,要驗「點下去也沒事」用 `userEvent.setup({ pointerEventsCheck: 0 })`;`inputProps` 已不被 Checkbox / Radio / Switch 消化(會漏到 DOM),改 `slotProps={{ input: … }}`。

**驗「某個狀態有沒有換樣式」不要用 `getComputedStyle`,直接讀 CSS 規則**:jsdom 的 `getComputedStyle` **不比對 specificity**,只照樣式表順序套最後一條相符的規則,而且對 `+` 兄弟選擇器支援不完整。`Switch` 的停用態軌道色正好寫在 `.Mui-disabled + .MuiSwitch-track`,用 `getComputedStyle` 一律讀回 MUI 自己那條 —— 元件有沒有補停用色完全驗不出來,測試會假綠。改用 `packages/ui/src/test/css-rules.ts` 讀 emotion 實際產生的規則:

```ts
const root = container.querySelector(".MuiSwitch-root")!;
const rules = cssRulesMatching(emotionClassOf(root), "Mui-disabled", "track");
expect(declaredValue(rules, "background-color")).toBe(disabledTrackColor);
```

`emotionClassOf(element)` 取該元素的 `css-…` 類別(用來把範圍收斂到自家元件),`cssRulesMatching(...needles)` 取選擇器同時含這幾段字串的規則,`declaredValue(rules, prop)` 取最後一條宣告的值(沒有任何規則宣告時回 `null`,正好拿來斷言「這個狀態沒有自己的樣式」)。**單純的後代選擇器**(如 Tree 依深度的縮排)`getComputedStyle` 讀得到,照常用即可。

**數值型樣式值的斷言要照 emotion 實際寫出的字串**:MUI / emotion 只對**非零**數值補 `px`,`minHeight: 0` 寫出來是 `min-height: 0`,不是 `"0px"`。`expect(declaredValue(rules, "min-height")).toBe("0px")` 會紅得莫名其妙 —— 斷 `"0"`。同理 `lineHeight`、`flex`、`zIndex` 這類無單位屬性也不要自行加單位。

## TEST-10 時間相關的斷言:不可用呼叫「前」的 `Date.now()` 當上界

效期 / 到期時間通常是受測程式在呼叫**當下**(較晚)以 `Date.now() + TTL` 算出來的,所以拿呼叫**前**取的 `before` 去斷言 `expiresAt - before <= TTL`,只要呼叫過程經過 ≥ 1 ms 就必然失敗 —— 本機快、幾乎同毫秒完成而僥倖綠,CI runner 慢一點就紅。**這類斷言不是偶發,是方向錯**(`apps/api/src/storage/storage.test.ts` 就曾三案在 CI 反覆命中)。改法二選一,並在測試註解寫選哪個與理由:

- **優先假時鐘 + 精確相等**:`jest.useFakeTimers({ now })` 固定時間,斷言 `expiresAt.getTime()` 等於 `now + TTL`,`finally` 裡 `jest.useRealTimers()` 收尾。前提是受測路徑沒有非同步計時器(`await` 走 promise microtask,不受假時鐘影響;有真計時器才會卡住)
- **否則用呼叫後的時間夾上界**:`expect(ttl).toBeLessThanOrEqual(TTL + (Date.now() - before))`,別用固定容差硬湊

## TEST-11 劇本 E2E 的寫法:前置走 api、UI 只走要驗的那一段、一劇本一 spec

`apps/e2e` 的三條硬約定,新增劇本時照做:

- **前置一律走 api,不要用畫面去鋪資料**。開通租戶、建組織 / 使用者 / 角色、調權限矩陣、建業務資料
  全部用 GraphQL(`src/fixtures/api.ts`,原生 `fetch`;codegen 產物是 React Query hooks,Node 裡沒有
  對應的執行環境)。用畫面鋪前置的代價是:**劇本會因為別條路徑的 UI 改動而紅**,而那不是它要驗的東西。
- **UI 只跑「預期」在講的那幾步**。`permission-scenarios.md` 每條劇本都寫了「用哪一頁 / 哪個帳號 /
  步驟 / 預期」,spec 的步驟註解照那份的步驟編號寫;文件說「這一條由 api 測試覆蓋」的(如劇本 5 的
  硬送寫入)就在 spec 裡直接打 api 斷言錯誤碼,不要硬用畫面演。
- **一條劇本一個 spec**,檔名 `scenario-<兩位數>-<主題>.spec.ts`,測試標題以「劇本 N:」開頭
  (手動觸發時的 `grep` 就是比對標題)。

另外幾件踩過的:

- **隔離靠租戶,不靠資料庫**。`tenant` fixture 每條劇本開一個新租戶(名稱帶隨機字尾),
  租戶本來就是產品的隔離邊界(ADR-0005);這比「一劇本一個資料庫」便宜太多 ——
  後者等於每條劇本各起一座 api。
- **定位優先用畫面上唯一的字串**。權限矩陣每一列列尾都印著權限 key(全樹唯一),
  拿它定位比拿中文名稱穩;`.MuiTreeItem-content` 只含自己那一列(子列在自己的 `ul` 裡)。
  兩個「看起來唯一、其實不唯一」的踩過:
  - **開通出來的擁有者,姓名預設 = 帳號**:使用者清單那一列的姓名欄與帳號欄是同一個字串,
    `getByText(account, { exact: true })` 會命中兩個而撞 Playwright 的 strict mode。先定位到列
    (`src/fixtures/ui.ts` 的 `userRow`),再在列內找。
  - **root 視角的組織樹,掛「租戶」/「停用」標籤的列**:名稱與標籤在同一個節點裡是相鄰的裸文字,
    `getByText(名稱, { exact: true })` 比對的是合併後的「名稱租戶」而找不到。組織樹的列一律用
    `orgTreeRow`(`.MuiTreeItem-content` + `hasText` 子字串)定位。
- **驗「缺某個權限」時,前一道門要先開著**:畫面上的功能常常疊好幾道權限 ——
  組織的可見性開關在「編輯」彈窗裡,而「編輯」鈕要 `edit`。只給 `view` 去驗「沒有 `set-visibility`
  看不到開關」會白綠(連彈窗都打不開)。對照組要給到**只差要驗的那一筆**(`view` + `edit`、無
  `set-visibility`),再斷言開關不在、硬送 `FORBIDDEN`。
- **兩道判準在劇本的資料條件下結果相同時,不在 E2E 裡硬分**:預設角色的
  `shrinkOnly`(只能縮不能擴)與防越權(subset-only)對 +tenant 來說鎖的是同一批列、回的是同一個
  `ROLE_OUT_OF_REACH` —— 他自己的權限就是預設角色的內容。E2E 只驗「鎖住了」,判準的**順序與歸屬**
  留給 api 測試(`apps/api/src/roles/role-kinds.test.ts`),`permission-scenarios.md` 在該劇本寫明。
  同理,產品上造不出來的狀態(劇本 14「有 `view` 但管理範圍是空的」)不要為了 E2E 去繞資料,指向 api 測試。
- **Snackbar 不是同步點**:操作結果提示 4 秒就自動關閉(DATA-06),
  拿「看到提示」當「這一步做完了」會在 CI 慢的時候抓不到、在快的時候又提早往下走。
  **連續操作之間等的是那一次 GraphQL 回應**(`page.waitForResponse` 比對 operationName),
  共用 helper 放 `apps/e2e/src/fixtures/ui.ts`(`clickAndWaitFor`)。提示的**內容**要驗當然可以驗,
  但把它當時序的柵欄不行。
- **`data_scope_rules` 是全域設定,租戶隔離救不了它**:那張表沒有掛
  `tenantScopePlugin`、`collection` 上是 unique 索引,所以**一個資料目標全站只有一份規則**
  (正本 `docs/modules/data-scope.md`「執行面的回傳語意」)。動到它的劇本**結尾一定要清乾淨**
  (`saveDataScopeRule` 整份覆蓋成 `rules: []`),放在 fixture 的收尾而不是測試本體的最後一行 ——
  中途失敗時也要清掉,否則會污染同一個資料庫上的其他劇本。
- **改完權限之後要整頁重載**。`me`(模組與權限)是 App 掛載時查的,react-query 會快取;
  `page.goto(...)` 是完整導覽,會重查 —— 不必重新登入(refresh cookie 還在)。
  **admin 與 api 要用同一個主機名**:cookie 是 `SameSite=Lax`,`localhost` 與 `127.0.0.1`
  對瀏覽器是兩個站台,混用會讓換票整個失效。
- **需要外部服務的劇本:Docker 容器 + 狀態檔 skip,CI 設 `*_REQUIRED=1`**(先例是
  劇本 11 / 15 的 fake GCS,`src/harness/fake-gcs.ts`):
  - harness(`globalSetup`)偵測得到 Docker 才以 `docker compose up -d` 起容器,並把「可不可用 + 原因」
    寫成**狀態檔** —— spec 跑在 worker 行程,拿不到 harness 的記憶體,只能讀檔。不可用時依賴它的 spec
    讀狀態檔後 `test.skip(原因)`,其餘劇本照跑;`E2E_SKIP_STACK=1` 沒有狀態檔,同樣當不可用。
  - CI 設 `E2E_<服務>_REQUIRED=1`(`e2e.yml`):起不來就整個失敗,不會變成「那幾條 skip、其餘全綠」。
  - **不寫成 GitHub Actions 的 `services:`**:service container 不能帶啟動參數(fake-gcs-server 不給參數
    就是 https + 自簽憑證 + 公開網址指向真 GCS);改由 harness 用 app 自己的 `docker-compose.yml`,
    CI 與本機同一份檔。

  - **測試用的金鑰 / 憑證不入 repo,由 harness 每次現產**(`fakePrivateKey()`):放進 repo 的私鑰就算是假的,
    也會被 secret scanning 當真的報。
  - 假服務驗不到的行為(簽名網址過期)在 `permission-scenarios.md` 該劇本寫明「仍屬 dev 人工驗收」。

正本:`apps/e2e/src/fixtures/`、`apps/e2e/src/harness/`、`apps/e2e/README.md`

## TEST-12 單元測試的夾具不得為了精簡而與正本資料的形狀分歧

純函式的測試夾具(`@repo/domain` 的權限樹、admin 的模組樹、api 的 seed 形狀…)是「正本資料長什麼樣」的一份**手寫副本**。為了讓案子好讀而刪掉幾個欄位或幾列,看起來無害,實際上是**把 bug 鎖進夾具**:權限矩陣的測試曾在群組節點上省略了 `<模組>.*` 那一列(理由是「群組沒有個別權限,寫了很囉嗦」),於是「整組全選對沒有 `*` 列的模組不該生出 `*`」這條規則,在測試裡永遠驗不到,直到使用者在畫面上撞到。

- **形狀照正本,內容才可以精簡**:少幾個模組、少幾筆權限沒關係;**每一筆該有的欄位與該有的列不能少**(seed 一定會補的 wildcard、api 一定會回的 `parentId: null`、mapper 一定會投影的欄位)。
- 正本在哪就對著哪:seed 的形狀對 `apps/db-migrator/seeds/`、api 回傳的形狀對 `apps/api/src/**/*.test.ts` 的既有斷言(TEST-08 的「MSW 夾具的形狀以 api 測試的斷言為準」是本條在網路層的特例)。
- 真的要拿掉一列,**在夾具旁邊註解寫明「這裡刻意沒有 X,因為要驗 Y」** —— 讓下一個人看得出那是設計,而不是漏掉。

## 已知偶發(CI 紅先對這裡)

重跑一次仍紅才算真的紅;同一案再紅就不是偶發,照 TEST-10 的判準查斷言方向與等待時機,不是放寬逾時。

- `apps/api/src/auth/password/password.test.ts` 的 `setPassword` 相關四案偶爾整組逾時(疑與 CI runner 慢 + argon2 雜湊有關)。
- **觀察名單**(各只紅過一次、單獨跑綠):
  - `apps/admin/src/pages/base/system/UserManagerPage/UserManagerPage.test.tsx` 的「新增使用者:選『直接設定初始密碼』…」。
  - `apps/admin/src/pages/base/system/FormsPage/FormsPageVersionViewer.test.tsx`:全套並行時逾時過;預防寫法見 TEST-08「設計器頁的測試一案只做一件事」。
