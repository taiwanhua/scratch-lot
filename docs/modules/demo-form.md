# 示範表單(技術)

> **表單模組的範例**:新開一個「欄位由使用者在後台設計」的模組,照這份與 [module-scaffold 的「表單模組路線」](../agents/module-scaffold.md#表單模組路線)。概念見 `docs/concepts/form-engine.md`,表單引擎的規則在 [forms](./forms.md),審核流程在 [workflows](./workflows.md)。

## 用途

三個表單模組(`engine: "form"`),把表單模組在側欄的三種位置都示範到:頂層、群組內、次群組內。三個的骨架完全相同(路由、三個隱藏頁、四筆權限、資料目標),都由同一個產生函式宣告;**表單**(欄位、版面、版本、分派、啟用)與**審核流程**(設計、發布、綁定)都由平台與租戶在畫面上建,seed 不建表單、不建流程、不綁定。頁面四個 key 全用表單引擎的預設組裝;表單綁了流程時,詳情頁下方自動掛審核區塊。

名字與路由刻意看得出是示範:production 不要的話,在「模組與權限」頁停用即可(`enabled` 是初始 seed 值欄位,重跑 seed 不會翻回來)。

正本:`apps/db-migrator/seeds/base/form-module-declaration.ts`(共用的骨架產生函式 `formModuleDeclaration`)、`apps/db-migrator/seeds/base/modules/demo-form.ts`、`demo.form.ts`、`demo.sub.form.ts`

## 模組 key 與畫面

| key             | 名稱               | 位置                    | 路由             | admin 常數                       |
| --------------- | ------------------ | ----------------------- | ---------------- | -------------------------------- |
| `demo-form`     | 示範表單(頂層)     | 頂層(`parentKey: null`) | `/demo-form`     | `DEMO_FORM_MODULE_KEY`           |
| `demo.form`     | 示範表單(群組內)   | `demo` 群組底下         | `/demo/form`     | `DEMO_GROUP_FORM_MODULE_KEY`     |
| `demo.sub.form` | 示範表單(次群組內) | `demo.sub` 次群組底下   | `/demo/sub/form` | `DEMO_SUB_GROUP_FORM_MODULE_KEY` |

`demo` 群組與 `demo.sub` 次群組由 `demo.sub.sample-one.ts` 宣告(示範模組 1 的宣告檔)。`seeds/registry.ts` 合併底座與專案的模組宣告後,由 `seeds/base/modules.ts` 依父子引用排序,不必手排宣告檔順序。

admin 的三個常數與底座頁面來源在 `apps/admin/src/app/base/module-pages.ts`。三個模組各在 `baseModulePages.forms` 宣告一筆 `{ moduleKey }`,由固定入口 `app/module-pages.tsx` 展開四頁;沒有另一份表單設定 key 清單。

每個模組底下三個隱藏頁(以 `<key>` 代表上表任一個,`<路由>` 是它的路由):

| key                 | 名稱 | sidebarType | 路由                           | 自有權限 |
| ------------------- | ---- | ----------- | ------------------------------ | -------- |
| `<key>.view-page`   | 詳情 | hidden      | `<路由>/view-page/<id>`        | 僅 `*`   |
| `<key>.create-page` | 新增 | hidden      | `<路由>/create-page/<formKey>` | 僅 `*`   |
| `<key>.edit-page`   | 編輯 | hidden      | `<路由>/edit-page/<id>`        | 僅 `*`   |

- 新增頁網址最後一段是**表單 key**:此刻可新增的表單只有一張時列表的新增鈕直接進,多張時先跳選單;網址沒帶表單 key 時同樣處理。
- 四頁由純函式 `formModulePages(moduleKey)` 產生,元件在 `apps/admin/src/components/base/form-engine/FormModulePages/`;頁籤 / 標題從 `RootProviders` 注入的設定讀取,三個示範均未另給 options,沿用預設模組層模板(見 [forms「頁籤 / 標題模板」](./forms.md#頁籤--標題模板))。
- 新增專案表單模組寫 `app/project/module-pages.ts` 的 `forms`,單頁客製使用 `pageOverrides`;要客製這三個底座示範的既有頁,則在 `app/project/page-replacements.ts` 明確替換目標,保留底座宣告與原頁。兩種情境都不靠重複 key 覆蓋,範例見[表單引擎](../concepts/form-engine.md#前端引擎零件與預設組裝)。

## 權限表

三個模組各一份,形狀相同(`<key>` 同上):

| 權限 key                             | moduleId 指向 | 它是哪一頁的什麼                                                  |
| ------------------------------------ | ------------- | ----------------------------------------------------------------- |
| `<key>.*`                            | 列表頁        | wildcard(同層語意);seed 自動產生;也涵蓋發布時建的欄位級權限       |
| `<key>.view`                         | 列表頁        | 列表與單筆                                                        |
| `<key>.create`                       | 列表頁        | 新增鈕、建 / 存 / 送 / 刪自己的草稿                               |
| `<key>.edit`                         | 列表頁        | 修改已完成的提交(每改一次修訂號 +1);綁流程的單核准後只能作廢      |
| `<key>.delete`                       | 列表頁        | 刪除已完成的提交                                                  |
| `<key>.show-<formKey>-<fieldKey>` 等 | 列表頁        | 欄位級(`source: dynamic`,表單發布時建;規則見 [forms](./forms.md)) |

端點在執行期依這四筆判(`moduleKey` 在 input 或提交上),不是 `@RequirePermission`。逐列的編輯 / 刪除一律看 api 給的 `abilities`。租戶管理員模板的權限由模組宣告推導,三個模組都自動納入。

## 資料

- **提交**存所有表單模組共用的 `form_submissions`(模組資料表),`moduleKey` = 所屬模組 key。欄位與索引見 `docs/data-model.md`。
- **資料目標**:每個模組一列(`form_submissions` + 模組 key;「資料範圍」頁左清單顯示模組名,副文字 `form_submissions`);欄位目錄 = 基礎欄位 + 提交狀態。狀態選項給**完整七種**(草稿 / 審核中 / 已退回 / 已撤回 / 已完成 / 已駁回 / 已作廢):任何一個表單模組都可能被綁流程。表單自訂欄位不能進條件。
- 模組本身與權限是種子資料;**沒有種子表單、種子流程** —— 由平台在「表單管理」「流程管理」建、分派給租戶。

## api 介面

全部走表單引擎的執行端點(`moduleForms`、`formSubmissions`、`formSubmission`、`createFormDraft`、`saveFormDraft`、`submitFormSubmission`、`updateFormSubmission`、`deleteFormSubmission`、`formLookup`、`moduleListColumns`…),形狀、缺席 / `null` 語意、錯誤碼見 [forms「api 介面」](./forms.md#api-介面);審核相關見 [workflows](./workflows.md)。本模組沒有自己的端點。

## 租戶使用者說明

三個示範表單都沒有專屬說明檔,「?」用表單模組通用說明 `apps/admin/src/md/module-help/base/form-module.help.md`(含審核流程;彈窗標題是各自的模組名)。表單模組不必各放一份說明;專案有特殊需求時,在 `md/module-help/project/additions/<模組 key>.help.md` 新增專屬檔即可,專屬檔優先。

只有替換已存在的底座說明 key 才放 `project/replacements/`,原檔仍保留;客製頁未另放說明時沿用原本的通用說明。三來源由 `apps/admin/src/lib/base/help-registry.ts` 打包與組裝,專屬 → 表單通用的查詢規則在 `lib/base/module-help.ts` 的 `resolveModuleHelp`;詳見[前端架構](../concepts/frontend-architecture.md#模組說明的來源與替換)。
