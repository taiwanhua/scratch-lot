# 示範模組1(技術)

> **藍本(module-scaffold 引用)**:新開 CRUD 模組照這份的章節與寫法。步驟見 [module-scaffold](../agents/module-scaffold.md)。

## 用途

示範家族的完整示範。示範家族有三個目的:①底座模板 —— module-scaffold 產新模組的藍本;②權限測試場(劇本見 [docs/testing/permission-scenarios.md](../testing/permission-scenarios.md));③新專案 bootstrap 後的活教材。

家族裡有兩個**固定欄位模組**:本篇(完整示範:三層樹、隱藏頁、CRUD + wildcard、欄位級與頁面自有權限、資料範圍目標、雙路儲存)與 [示範模組2](./demo.sample-two.md)(對照組)。`demo` / `demo.sub` 兩層群組也收著兩個**表單模組**(`demo.form`、`demo.sub.form`;另有一個掛頂層的 `demo-form`),示範表單模組在側欄各種位置的樣子,見 [示範表單](./demo-form.md)。本檔宣告兩層群組,其他示範模組都掛在它們底下。

正本:`apps/db-migrator/seeds/base/modules/demo.sub.sample-one.ts`

## 模組 key 與畫面

可進入 = 角色綁了該模組(`role_module`,ADR-0011);矩陣 UI 保證勾下層必連動上層。

| key                               | 名稱                                 | sidebarType  | 路由                                  | 自有權限            |
| --------------------------------- | ------------------------------------ | ------------ | ------------------------------------- | ------------------- |
| `demo`                            | 示範群組                             | group        | `/demo`                               | 僅 `*`              |
| `demo.sub`                        | 示範次群組                           | group        | `/demo/sub`                           | 僅 `*`              |
| `demo.sub.sample-one`             | 示範模組1                            | link(列表頁) | `/demo/sub/sample-one`                | 見權限表            |
| `demo.sub.sample-one.view-page`   | 示範項目詳情                         | hidden       | `/demo/sub/sample-one/view-page/<id>` | 僅 `*`              |
| `demo.sub.sample-one.create-page` | 新增示範項目                         | hidden       | `/demo/sub/sample-one/create-page`    | `*`、`show-tips`    |
| `demo.sub.sample-one.edit-page`   | 編輯示範項目                         | hidden       | `/demo/sub/sample-one/edit-page/<id>` | `*`、`show-history` |
| `demo.sample-two` 一支            | 見 [示範模組2](./demo.sample-two.md) |              |                                       |                     |
| `demo.form`、`demo.sub.form` 兩支 | 見 [示範表單](./demo-form.md)        |              |                                       |                     |

`delete` 無對應頁(列表動作 + 確認彈窗)—— 權限與頁面不必一一對應,本身即示範。

**畫面**:Figma 列表 / 詳情 / 新增 / 編輯四個版型節點 `175:3` / `175:318` / `175:558` / `177:2314`。實作與設計稿的差異表記在建立 admin 頁面的那個 PR(`git log -- apps/admin/src/pages/base/demo/` 可查)。

正本:`apps/db-migrator/seeds/base/modules/demo.sub.sample-one.ts`、`apps/admin/src/app/module-pages.tsx`

## 權限表

綁定原則:綁「按鈕 / 欄位所在的那一頁」(ADR-0004)。

| 權限 key                                     | moduleId 指向        | 它是哪一頁的什麼                                                                                                                                                      |
| -------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `demo.sub.sample-one.*`                      | 示範模組1(列表頁)    | wildcard,代表本模組自己這層的全部權限(同層語意,ADR-0004;`role_permission` 只存這一筆)。每個模組(含群組與隱藏頁)都固定有一筆 `<key>.*`,由 seed 自動產生,本表不逐列重複 |
| `demo.sub.sample-one.view`                   | 示範模組1(列表頁)    | 看列表與單筆資料、進入檢視頁 / 打開檢視跳窗                                                                                                                           |
| `demo.sub.sample-one.create`                 | 示範模組1(列表頁)    | 進入新增頁的按鈕 + 新增 API                                                                                                                                           |
| `demo.sub.sample-one.edit`                   | 示範模組1(列表頁)    | 進入編輯頁的按鈕 + 編輯 API                                                                                                                                           |
| `demo.sub.sample-one.delete`                 | 示範模組1(列表頁)    | 列表的刪除按鈕 + 刪除 API                                                                                                                                             |
| `demo.sub.sample-one.show-internal-note`     | 示範模組1(列表頁=父) | 跨頁共用欄位:內部備註可見(詳情 + 編輯)                                                                                                                                |
| `demo.sub.sample-one.edit-internal-note`     | 示範模組1(列表頁=父) | 同上(可改;無此權限硬送寫入 → API 拒)                                                                                                                                  |
| `demo.sub.sample-one.create-page.show-tips`  | 新增頁               | 頁面自有示範:填寫提示區塊                                                                                                                                             |
| `demo.sub.sample-one.edit-page.show-history` | 編輯頁               | 頁面自有示範:變更歷程區塊                                                                                                                                             |

正本:`apps/db-migrator/seeds/base/modules/demo.sub.sample-one.ts`(`permissions`)、`apps/db-migrator/seeds/base/modules.ts`(wildcard 自動產生)

## 資料

**`demo_items_one`**:`name`、`category`(欄位管理「示範分類」的選項 value)、`status`(`draft` / `published` / `archived`,預設 `draft`)、`note`、`internalNote`(欄位級權限控)、`coverPath`(公開 bucket)、`attachmentPath`(私有 bucket)+ `attachmentName` / `attachmentSize` / `attachmentContentType`(附件原始檔名 / 大小 / 檔型)、`enabled` + 基礎欄位(ADR-0007)。

**資料範圍目標(ADR-0008)**:seed 宣告 `dataScopeTarget`(collection = `demo_items_one`),落庫至 `data_scope_targets`。可篩業務欄位只有 **`status`(enum,選項 草稿 / 已發布 / 已封存)**,基礎欄位由程式自動附加。它是固定欄位模組裡唯一的 enum 資料範圍欄位(表單模組的提交狀態是另一個,由 `form-module-declaration.ts` 統一產生),權限劇本的「enum 固定選項」規則在這裡驗;value 的正本是 seed 宣告,與 schema 的 `status` 一一對應。

**連動 seed**:欄位管理的系統類別「示範分類」(`demo-category`)與三個全域選項(主食 `staple` / 小菜 `side-dish` / 飲品 `drink`)。

**Seed 與環境**:模組與權限全環境灌同一份(seed 不分環境);`enabled` 初始 true,production 要關閉就在「模組與權限」頁手動停用(初始 seed 值欄位,不會被下次 seed 翻回,ADR-0002);納入租戶管理員模板(非根組織專屬模組自動納入)。

**示範資料**:`demo_items_one` 5 筆,以 `key` 冪等、全環境灌同一份(示範資料本來就是種子,ADR-0002)。內容涵蓋三個建立者、三種 `status`、三個分類、一筆初始停用。只有 `enabled` 是「初始 seed 值的欄位」,**其餘欄位每次部署同步回宣告值** —— 示範資料被玩壞時會自動復原,這是刻意的;軟刪除掉的示範項目不會被種回來。兩個已知限制(全部掛根組織、建立者是假 id)見 [示範模組2「資料」](./demo.sample-two.md#資料)。

正本:`apps/api/src/database/schemas/demo-item-one.schema.ts`、`apps/db-migrator/seeds/base/modules/demo.sub.sample-one.ts`(`dataScopeTarget`)、`apps/db-migrator/seeds/base/demo-items.ts`、`apps/db-migrator/seeds/base/field-categories.ts`、`apps/db-migrator/seeds/base/fields.ts`

## 規則

- **範圍由 plugin 保底**:`demo_items_one` 掛 `tenantScopePlugin`(業務類),所以每一條查詢(含寫入與刪除)都先吃**可見範圍**(ADR-0005)再套**資料範圍規則**(ADR-0008);service 不自己寫範圍。看不到的資料一律 `NOT_FOUND`,列表與單筆同一個答案。
- **`internalNote` 是欄位級權限欄(綁父模組,ADR-0004)**:讀要 `show-internal-note`、寫要 `edit-internal-note`;input 裡**欄位一出現就要權限**(送 `null` 清空也算寫入)。
- **分類必須在操作者的合併範圍內且啟用中**:分類值來自欄位管理「示範分類」;不在合併範圍、或該選項已停用就拒寫。
- **上傳路徑必須是本 API 簽出來的**:寫入 `coverPath` / `attachment.path` 時 api 驗 `isOwnedUploadPath`,防止把任意物件路徑掛到資料上。
- **附件中繼資料只驗形狀、不驗與 bucket 物件一致**(它們是顯示用的):`attachment` 是 `{ path, name, size, contentType }` 一整組,**四個都必填**(沒有「只改檔名」這回事,換檔就整組送)。檔名去頭尾空白後 1–255 字、大小是 0 到 `DEMO_ATTACHMENT` 上限(20 MB)的整數、檔型在 `DEMO_ATTACHMENT` 白名單內(存小寫)。落庫是 `attachmentPath` / `attachmentName` / `attachmentSize` / `attachmentContentType` 四個平行欄位,換檔一起 `$set`、清空一起 `$unset`。
- **可上傳的檔型與大小依 purpose**(ADR-0010 的雙路):路徑一律 `demo/<uuid>.<副檔名>`,兩個 purpose 都要 `create` 或 `edit`。

  | purpose           | bucket | content type                                                                                                                                                                                                  | 大小上限 |
  | ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
  | `DEMO_COVER`      | 公開   | `image/png`、`image/jpeg`、`image/webp`                                                                                                                                                                       | 2 MB     |
  | `DEMO_ATTACHMENT` | 私有   | 同上,加 `application/pdf`、`application/msword`(doc)、`…wordprocessingml.document`(docx)、`application/vnd.ms-excel`(xls)、`…spreadsheetml.sheet`(xlsx)、`application/zip`(含 `application/x-zip-compressed`) | 20 MB    |

  不合的檔型或超過上限都回 `UPLOAD_REJECTED`(錯誤訊息含 purpose)。副檔名由申報的 content type 決定 —— 同一份 zip 在 Windows 上申報成 `application/x-zip-compressed` 也一樣存成 `.zip`。

- **停用不套自鎖**:`setDemoItemOneEnabled` 不套 `SELF_LOCK`:停用一筆業務資料隨時可以再啟用回來,不會讓操作者失去繼續操作的能力(自鎖只守「關掉就再也開不回來」的寫入)。
- **變更歷程不能成為側門**:`demoItemOneHistory` 先驗這筆資料看不看得到;稽核裡的 `internalNote` 只記 `"[redacted]"`(見「稽核」)。

正本:`apps/api/src/demo-items-one/demo-items-one.service.ts`、`apps/api/src/demo-items-one/demo-category.service.ts`、`apps/api/src/storage/upload-rules.ts`(`UPLOAD_RULES`)、`apps/api/src/demo-items-one/dto/demo-item-one-attachment.input.ts`

## api 介面

```graphql
demoItemsOne(input: DemoItemsOneInput!): DemoItemsOnePayload!   # { items, totalCount, page, pageSize }
demoItemOne(id: ID!): DemoItemOnePayload!                        # { item }
demoItemOneHistory(id: ID!): DemoItemOneHistoryPayload!          # 需 edit-page.show-history
demoItemOneAttachmentUrl(id: ID!): DemoItemOneAttachmentUrlPayload!  # { url };私有附件現簽,需 view

createDemoItemOne(input: CreateDemoItemOneInput!): DemoItemOnePayload!
updateDemoItemOne(input: UpdateDemoItemOneInput!): DemoItemOnePayload!
deleteDemoItemOne(input: DeleteDemoItemOneInput!): DeleteDemoItemOnePayload!  # { success, deletedId }
setDemoItemOneEnabled(input: SetDemoItemOneEnabledInput!): DemoItemOnePayload!

type DemoItemOne {
  id: ID!
  name: String!
  category: String # 欄位管理「示範分類」的選項 value
  categoryLabel: String # 該 value 在操作者合併範圍內的顯示名稱
  note: String
  internalNote: String # 欄位級權限(見下)
  coverPath: ID # 公開 bucket 的物件路徑
  coverUrl: String # 公開**穩定** URL(不過期)
  attachment: DemoItemOneAttachment # { path, name, size, contentType };下載網址另簽
  status: DemoItemOneStatus! # DRAFT / PUBLISHED / ARCHIVED
  enabled: Boolean!
  createdBy: DemoItemOneUserRef # { id, name }
  createdAt: DateTime!
  updatedAt: DateTime!
  abilities: DemoItemOneAbilities! # { canEdit, canDelete, canEditInternalNote }
}

input DemoItemOneAttachmentInput { # create / update 的 attachment
  path: ID! # createUploadUrl(DEMO_ATTACHMENT)回的 objectPath
  name: String! # 原始檔名(File.name)
  size: Int! # bytes(File.size)
  contentType: String! # File.type
}

input DemoItemsOneInput {
  page: Int = 1
  pageSize: Int = 20 # 上限 100
  keyword: String # 比對 name / note
  category: String
  enabled: Boolean
}
```

分頁形狀依 GQL-03(`items` + `totalCount`)加上全站現況的 `page` / `pageSize`;mutation 一律回 payload(GQL-02)。上傳走共用的 `createUploadUrl`,purpose 見「規則」。

**回傳欄位的語意**(GQL-07:正本在此,前端段只引用):

- **`internalNote`**:沒有 `demo.sub.sample-one.show-internal-note` 時,api **不把這個欄位放進回傳物件**(GraphQL 因此序列化成 `null`),列表與單筆一致。「沒權限」與「沒填」在值上長得一樣,所以**前端依自己的權限集決定要不要渲染這個欄位**,不要拿值去猜。
- **`abilities` 由 api 依操作者的有效權限集算好,每個旗標都已含權限判斷**:前端**直接用**,不要再與 `usePermissions` 相乘(同一條規則兩邊各算一次,對不起來就是畫面與 API 不一致)。與角色頁的 `RoleAbilities` 不同 —— 那組刻意不含權限 key,因為它表達的是「角色種類規則」。`canEditInternalNote` 為 false 但 `internalNote` 有值 = 看得到、改不動(唯讀)。
- **`coverUrl` 是公開 bucket 的穩定 URL**(不簽名、不過期,可直接放 `<img src>`、可快取);**附件只給 `attachment { path, name, size, contentType }`**,下載要另外呼叫 `demoItemOneAttachmentUrl(id)` 現簽短效網址(ADR-0010 的雙路)。`name` / `size` / `contentType` 是寫入時前端申報的原始檔名 / bytes / 檔型,原樣回傳。**只存了路徑、沒有中繼資料的附件三者皆為 `null`**:前端顯示檔名時退回物件路徑的最後一段(`<uuid>.<副檔名>`)、不顯示大小。
- **`categoryLabel`**:分類已被停用、或屬於操作者看不到的組織時為 `null`(`category` 仍原樣回)。
- **`createdBy` 查不到那位使用者時一律回 `null`,不拋錯**:seed 的示範資料用假的 ObjectId 當建立者,真實環境也會有使用者被刪掉的情形;前端顯示「—」即可。

**可選輸入欄位的缺席 / `null` 語意**(GQL-06):

| 欄位                                          | `createDemoItemOne`                 | `updateDemoItemOne`                      |
| --------------------------------------------- | ----------------------------------- | ---------------------------------------- |
| `name`                                        | 必填(空白 → 拒)                     | 缺席 / `null` = 不動                     |
| `status`                                      | 缺席 / `null` = 草稿                | 缺席 / `null` = 不動                     |
| `category`、`note`、`coverPath`、`attachment` | 缺席 / `null` = 不設                | **缺席 = 不動、`null` = 清空**(`$unset`) |
| `internalNote`                                | 同上,但**欄位一出現就要權限**(見下) | 同上                                     |

正本:`apps/api/src/demo-items-one/`(`demo-items-one.resolver.ts`、`dto/`、`models/`)、`apps/api/schema.gql`、`packages/graphql/src/documents/`

## admin 頁面

專案新增頁面走 `app/project/module-pages.ts`,替換底座頁走 `app/project/page-replacements.ts`,保留底座原版。示範模組的四個 key = 四頁,`app/base/module-pages.ts` 各登記一個元件;**新增與編輯是同一個共版型元件**,情境由 `module.key` 判斷。

| 模組 key                          | 元件                                      |
| --------------------------------- | ----------------------------------------- |
| `demo.sub.sample-one`             | `SampleOnePage/SampleOnePage.tsx`         |
| `demo.sub.sample-one.view-page`   | `SampleOneViewPage/SampleOneViewPage.tsx` |
| `demo.sub.sample-one.create-page` | `SampleOneFormPage/SampleOneFormPage.tsx` |
| `demo.sub.sample-one.edit-page`   | 同上(共版型)                              |

**三頁本體是共用的**:`components/base/crud/` 的 `DemoListPage` / `DemoDetailPage` / `DemoFormPage`,設定驅動(介面與逐項 JSDoc 在 `shared/demo-module-config.ts` 的 `DemoModuleConfig`)。上表那三個元件檔各只有約 10 行 —— 把設定物件接上共用元件而已。

**路由頁籤**:詳情與編輯頁每筆各一個詳情子頁籤,標籤「示範模組1 — 檢視・項目名」/「示範模組1 — 編輯・項目名」;刪除成功後那一筆的子頁籤一起關掉。規則見 [frontend-architecture.md](../concepts/frontend-architecture.md)「頁籤兩種」。

**設定分兩層**:

- `pages/base/demo/demo-sample-one-config.ts` —— **常數**:模組 key、四個 `MODULE_KEYS`、權限 key、欄位管理的「示範分類」key 與 `system.field-manager.view`、i18n namespace、每頁筆數、表格最小寬度、狀態選項、上傳規則。
- `pages/base/demo/SampleOneModule.tsx` —— **設定物件本身**(一份 `DemoModuleConfig`):列表欄位與分類篩選、詳情欄位(含內部備註那一列的 `isVisible`)、表單欄位(含內部備註的三態 `mode`)、兩個上傳欄、兩個 slot(填寫提示 / 變更歷程),以及包好的 `useRows` / `useItem` / `useSave`。

**頁面程式碼與示範模組2 一模一樣,差別全在這份設定物件** —— 新開一個 CRUD 模組要寫的就是它,步驟見 [module-scaffold](../agents/module-scaffold.md)。

**只屬於這一頁的元件**:`SampleOnePage/SampleOneCategoryFilter.tsx`(工具列的分類 `Autocomplete`)、`SampleOneFormPage/SampleOneCategoryField.tsx`(表單的分類欄,含唯讀退化)、`FormTipsBlock.tsx` / `ItemHistoryBlock.tsx`(兩個 slot)、`SampleOneViewPage/AttachmentField.tsx`(私有附件現簽下載);分類選項的共用 hook 是 `pages/base/demo/useDemoCategoryOptions.ts`。

**路由尾端的識別碼**:詳情與編輯頁的模組路由本身不含 `<id>`(seed 的 route 是 `view-page` / `edit-page`),所以殼的路由防守多一條退路 —— 精準比對落空時,**只對 hidden 模組**再試一次「去掉最後一段」(`lib/base/module-tree.ts` 的 `matchModuleRoute`),解出來的那一段以 `routeParam` 傳給頁面。link 頁(列表)後面多接一段仍然是無權限頁;「可進 = 有那個模組路由」這條規則沒有放寬。規則本文在 ADR-0011「路由防守 / 尾端動態參數的退路」。

**兩層判斷分開問**(ADR-0011):

- **進得去哪一頁**看 `me.modules` 有沒有那個模組(`shared/useDemoAccess.ts`,兩支示範模組共用;路由字串也從模組陣列取,前端不寫死路徑)。沒綁詳情頁 → 列上沒有「檢視」;沒綁新增頁 → 即使有 `create` 權限也沒有新增鈕。
- **頁內能做什麼**:整頁層級的問權限集(內部備註可見 / 可改、填寫提示、變更歷程);**逐列的編輯 / 刪除 / 內部備註可改一律讀 api 給的 `item.abilities`**,不與 `usePermissions` 相乘。

**表單欄位**:名稱、分類、狀態、備註、內部備註,加上封面與附件兩個上傳欄;**`enabled` 不在表單上**,它由 `setDemoItemOneEnabled` 單獨切換 —— **列表的「啟用」欄是開關**,改得動的那一列(`abilities.canEdit`)直接切、不另開確認,切完只重查當前這頁清單;改不動的列與詳情頁仍是唯讀標籤。開關是共版型的**選配**(設定物件的 `useSetEnabled`,示範模組2 同),不給的模組列表就維持標籤。

**內部備註的三態**在表單上是 `hidden` / `readonly` / `editable`:沒有 `show-internal-note` 時**整欄不渲染**,而且 input 裡連這個鍵都不會出現(欄位一出現就要權限,送 `null` 也會被 `FIELD_FORBIDDEN` 擋)。

**變更歷程的時間**顯示成「年-月-日 時:分」,和表單引擎的日期時間同一套(`useTemporalText`,type `datetime`):讀者的租戶時區、格式不隨語言變。

**分類下拉的選項**來自 `fieldCategories` → `fields(categoryId)`,兩個端點都掛在 `system.field-manager.view` 底下。沒有那個權限時:列表不顯示分類篩選、表單的分類欄退成唯讀(保留原值並說明原因)。停用的選項不列入可選清單。

正本:`apps/admin/src/pages/base/demo/`、`apps/admin/src/app/module-pages.tsx`、`apps/admin/src/lib/base/module-tree.ts`

## 錯誤碼

沿用 GQL-04 的通用碼,不新增 code。

| 情況                                                                                          | 回什麼                                                         |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 端點所需權限不足(`view` / `create` / `edit` / `delete` / `show-history`)                      | `FORBIDDEN`(由 `@RequirePermission` 擋,無 `reason`)            |
| input 裡出現 `internalNote`(含送 `null` 清空)但沒有 `edit-internal-note`                      | `FORBIDDEN` + `extensions.reason = "FIELD_FORBIDDEN"`          |
| 名稱空白                                                                                      | `VALIDATION_FAILED`,`fields: ["name"]`                         |
| 分類不在操作者的**合併範圍**內、或該選項已停用                                                | `VALIDATION_FAILED`,`fields: ["category"]`                     |
| `coverPath` / `attachment.path` 不是本 API 簽出來的路徑;`attachment` 的檔名 / 大小 / 檔型不合 | `VALIDATION_FAILED`,`fields: ["coverPath"]` / `["attachment"]` |
| 上傳的檔型不在白名單、或超過大小上限(`createUploadUrl`)                                       | `UPLOAD_REJECTED`                                              |
| 資料不在可見範圍 / 資料範圍內、id 不存在、這筆沒有附件                                        | `NOT_FOUND`                                                    |

**admin 的對應**:`VALIDATION_FAILED` 依 `extensions.fields` 標在對應欄位上(`name` / `category` / `coverPath` / `attachment`),其餘(`FORBIDDEN` 含 `FIELD_FORBIDDEN`、`NOT_FOUND`)用一條 Alert 說明;解讀集中在 `components/base/crud/demo-error.ts`(兩支示範模組共用一份)。

正本:`apps/api/src/demo-items-one/demo-items-one-error.ts`、`apps/admin/src/components/base/crud/demo-error.ts`

## 稽核

`targetType` 一律 `demo_item_one`;動作 `demo-item-one.create` / `.edit` / `.delete` / `.toggle-enabled`。

`before` / `after` 只放**有變的欄位**;**`internalNote` 只記 `"[redacted]"`,不記內容** —— 否則沒有 `show-internal-note` 卻有 `edit-page.show-history` 的人可以從變更歷程把它讀出來,投影就白做了。附件只記 `attachmentPath`(檔名等中繼資料不進歷程)。

`demoItemOneHistory(id)` 就是讀這批紀錄(target = 該筆,新到舊,不分頁);它**先驗這筆資料看不看得到**,不然歷程會變成繞過資料範圍規則的側門。

正本:`apps/api/src/demo-items-one/demo-items-one.service.ts`(`AUDIT`、`REDACTED`)

## 測試

- api:`apps/api/src/demo-items-one/demo-items-one.test.ts`(CRUD、驗證、附件)、`demo-items-one-permissions.test.ts`(端點與欄位級權限)、`demo-items-one-scope.test.ts`(可見範圍 + 資料範圍規則);夾具 `test-support/fixtures.ts`。
- admin:`apps/admin/src/pages/base/demo/SampleOnePage/SampleOnePage.test.tsx`、`SampleOneFeedback.test.tsx`、`SampleOneViewPage/SampleOneViewPage.test.tsx`、`SampleOneFormPage/SampleOneFormPage.test.tsx`、`SampleOneRoutes.test.tsx`;msw handler `apps/admin/src/test/msw/demo-sample-one-handlers.ts`、夾具 `demo-fixtures.ts`。
- 劇本 E2E:本模組是權限劇本的主要場地 —— `apps/e2e/src/specs/scenario-01-wildcard.spec.ts`、`-02-data-scope-rule`、`-04-combine-op`、`-05-field-permission`、`-06-page-permission`、`-07-route-guard`、`-08-out-of-scope`、`-10-out-of-reach`、`-11-storage-two-paths`、`-12-visibility-toggle` 等;劇本本文見 [permission-scenarios](../testing/permission-scenarios.md)。

正本:`apps/api/src/demo-items-one/`、`apps/admin/src/pages/base/demo/`、`apps/e2e/src/specs/`、`docs/testing/permission-scenarios.md`

## 使用者說明(help.md)

[demo.sub.sample-one.help.md](../../apps/admin/src/md/module-help/base/demo.sub.sample-one.help.md)(租戶使用者說明,build 時打包進說明彈窗)。

正本:`apps/admin/src/md/module-help/base/demo.sub.sample-one.help.md`

## 平台視角備註

- 示範家族全環境都有;要在某環境(例如 production)隱藏,由 root 在「模組與權限」頁停用,seed 不會翻回。
- `status` 是固定欄位模組唯一的 enum 資料範圍欄位,拿掉或改名會讓權限劇本的「enum 固定選項」規則失去驗證場地。
- 示範資料全部掛根組織、建立者是固定假 id,租戶帳號一登入列表是空的(見 [示範模組2「資料」](./demo.sample-two.md#資料) 的兩個已知限制)。

正本:`apps/db-migrator/seeds/base/demo-items.ts`、`apps/db-migrator/seeds/base/modules/demo.sub.sample-one.ts`
