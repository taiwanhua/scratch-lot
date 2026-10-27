# 示範模組2(技術)

> **藍本(module-scaffold 引用)**:新開 CRUD 模組照這份的章節與寫法。步驟見 [module-scaffold](../agents/module-scaffold.md)。

## 用途

示範家族的**對照組**(家族目的見 [示範模組1「用途」](./demo.sub.sample-one.md#用途))。它刻意只保留最小的 CRUD:掛在示範群組(`demo`)直下、不經次群組(示範兩層結構);**不宣告 `dataScopeTarget`**,查詢僅受可見範圍保底,用來驗證資料範圍規則未介入時的行為(ADR-0008);無欄位級與頁面自有權限,只有基本四筆(view / create / edit / delete)加上每模組固定一筆 `*`。一個最小 CRUD 模組長什麼樣,看這份最快。

正本:`apps/db-migrator/seeds/base/modules/demo.sample-two.ts`

## 模組 key 與畫面

| key                           | 名稱      | sidebarType  | 路由                              | 自有權限 |
| ----------------------------- | --------- | ------------ | --------------------------------- | -------- |
| `demo.sample-two`             | 示範模組2 | link(列表頁) | `/demo/sample-two`                | 見權限表 |
| `demo.sample-two.view-page`   | 詳情      | hidden       | `/demo/sample-two/view-page/<id>` | 僅 `*`   |
| `demo.sample-two.create-page` | 新增      | hidden       | `/demo/sample-two/create-page`    | 僅 `*`   |
| `demo.sample-two.edit-page`   | 編輯      | hidden       | `/demo/sample-two/edit-page/<id>` | 僅 `*`   |

上層的 `demo` 群組宣告在示範模組1 的 seed 檔(家族樹見 [示範模組1](./demo.sub.sample-one.md#模組-key-與畫面))。

**畫面**:同版型不另畫(Figma 的註記卡)—— 版型就是示範模組1 的 `175:3` / `175:318` / `175:558` / `177:2314`。

正本:`apps/db-migrator/seeds/base/modules/demo.sample-two.ts`、`apps/admin/src/app/module-pages.tsx`

## 權限表

| 權限 key                 | moduleId 指向     | 它是哪一頁的什麼                                            |
| ------------------------ | ----------------- | ----------------------------------------------------------- |
| `demo.sample-two.*`      | 示範模組2(列表頁) | wildcard(同層語意,ADR-0004);每個節點各一筆,由 seed 自動產生 |
| `demo.sample-two.view`   | 示範模組2(列表頁) | 看列表與單筆                                                |
| `demo.sample-two.create` | 示範模組2(列表頁) | 新增鈕 + 新增 API                                           |
| `demo.sample-two.edit`   | 示範模組2(列表頁) | 編輯鈕 + 編輯 API + 啟用開關                                |
| `demo.sample-two.delete` | 示範模組2(列表頁) | 刪除鈕 + 刪除 API                                           |

語意與示範模組1 對應權限相同。

正本:`apps/db-migrator/seeds/base/modules/demo.sample-two.ts`(`permissions`)

## 資料

**`demo_items_two`**:`name`、`note`、`enabled`、`shareOrgs`(共用給)+ 基礎欄位(ADR-0007)。不宣告 `dataScopeTarget`。資料共用宣告為「可共用、預設不共用、可編輯」(`sharing: { mode: "shareable", defaultShareOrgs: "none", editable: true }`,ADR-0014),是權限劇本 30–35 的示範表。

**Seed 與環境**:模組與權限同示範模組1(全環境灌、`enabled` 是初始 seed 值欄位、納入租戶管理員模板)。

**示範資料**:`demo_items_one` 與 `demo_items_two` 各 5 筆,以 `key` 冪等、全環境灌同一份(示範資料本來就是種子,ADR-0002);本模組的 5 筆只有 name / note / enabled,其中一筆初始停用。只有 `enabled` 是「初始 seed 值的欄位」(改了不會被下次部署翻回去);**其餘欄位每次部署同步回宣告值** —— 示範資料被玩壞時會自動復原,這是刻意的。軟刪除掉的示範項目不會被種回來。

**兩個已知限制**(做不到而不是忘了做,兩支示範模組共用):

1. **示範資料全部掛在根組織**:`orgs` 種子只有根組織一筆(ADR-0005),租戶是 root 在「開通租戶」建出來的、各環境 id 不同,seed 引用不到。跨租戶的差異(劇本 12 可見性開關)要在該環境用手動新增的資料驗。
2. **建立者是固定的假 id**:seed 只建 root 初始帳號,而那筆 `users` 沒有 `key` 欄位,`seedRef` 只以 `key` 解析。用假 id 而不是 `null`,是為了讓「不同建立者」看得出差異,並讓劇本 2(規則「建立者 = 【操作者本人】」)有東西可以被濾掉 —— 示範資料一律屬於「別人」。代價是詳情頁的建立者顯示為空。

正本:`apps/api/src/database/schemas/demo-item-two.schema.ts`、`apps/db-migrator/seeds/base/demo-items.ts`、`apps/db-migrator/src/seed/seed-declaration.ts`

## 規則

- **範圍只有可見範圍保底**:`demo_items_two` 掛 `tenantScopePlugin`,但沒有資料範圍目標,所以資料範圍規則永遠不介入(劇本 3 的對照)。可見範圍外與已軟刪除都回 `NOT_FOUND`。
- **共用給**(ADR-0014):讀取另看得到「共用給我所屬組織(或其上層且含下層)」的項目;共用進來的只能看 —— 編輯 / 停用 / 刪除一律 `NOT_FOUND`,`abilities` 兩個都是 `false`、`isShared = true`。新增時給非空清單要有 `.edit`(沒有 → `FORBIDDEN`);清單的組織要與項目同租戶(可以是自己看不到的組織),否則 `VALIDATION_FAILED`(`fields: ["shareOrgs"]`)。
- **停用 / 啟用守 `.edit` 而不是自己的 `toggle-enabled`**:對照組的權限表只有四筆,切啟用狀態就是「改這一筆」。治理模組(角色管理、欄位管理)另有 `toggle-enabled`,是因為那裡的停用會影響**別人的權限**、要能單獨授予 —— 業務資料沒有這個需求。六個端點只用到四個 key,本身就是「權限與端點不必一一對應」的示範。
- **停用不套自鎖**:理由同示範模組1(業務資料停用隨時可以開回來)。
- **`enabled` 為 `false` 的項目照樣列出來**,只是標示為停用;真正消失的是刪除(軟刪除)。
- **型別名帶模組前綴**:code-first 的型別名全 schema 唯一,`DeletePayload` 已被組織管理用掉,所以這裡是 `DeleteDemoItemTwoPayload`(GQL-02)。

正本:`apps/api/src/demo-items-two/demo-items-two.service.ts`、`apps/api/src/demo-items-two/demo-items-two.resolver.ts`

## api 介面

形式見 GQL-02 / GQL-03,錯誤碼見 GQL-04。

| 端點                                        | 需要的權限             | 說明                                         |
| ------------------------------------------- | ---------------------- | -------------------------------------------- |
| `demoItemsTwo(input): DemoItemsTwoPayload!` | `demo.sample-two.view` | 清單;`{ items, totalCount, page, pageSize }` |
| `demoItemTwo(id): DemoItemTwoPayload!`      | `demo.sample-two.view` | 單筆;`{ item }`                              |
| `createDemoItemTwo(input)`                  | `.create`              | 回 `DemoItemTwoPayload`                      |
| `updateDemoItemTwo(input)`                  | `.edit`                | 回 `DemoItemTwoPayload`                      |
| `setDemoItemTwoEnabled(input)`              | `.edit`                | 回 `DemoItemTwoPayload`                      |
| `deleteDemoItemTwo(input)`                  | `.delete`              | 軟刪除;回 `DeleteDemoItemTwoPayload`         |

**回傳欄位的語意**(GQL-07 的正本):`DemoItemTwo` 有 `id`、`name`、`note`、`enabled`、`createdBy`、`createdAt`、`updatedAt`、`abilities`、`shareOrgs`、`isShared`。

- **`createdBy`**(`{ id, name }`,可為 `null`):建立者。**查不到使用者時整個欄位為 `null`** —— seed 的示範資料建立者是假 id(見「資料」),已刪除的帳號同理。前端要能顯示「—」,不可假設一定有值。
- **`abilities`**(`{ canEdit, canDelete }`):這位操作者對這一筆能做什麼,**api 依權限算好、前端只讀不重算**。示範模組2 沒有種類規則也沒有欄位級權限,所以它等於「操作者有沒有 `.edit` / `.delete`」;前端顯示按鈕的條件就是 `item.abilities.canEdit`,不再與 `usePermissions` 相乘(與角色管理的 `Role.abilities` 同型,但那邊是兩者相乘 —— 差別在這裡的 abilities 已經**含**權限判斷)。**共用進來的項目兩個都是 `false`**(寫入不放大)。
- **`shareOrgs`**(`[ShareOrg!]!`,`{ orgId, includeDescendants }`):共用給;空 = 不共用,`[{ 最上層組織, true }]` = 全部分店。
- **`isShared`**:這一筆是共用進來的(歸屬組織不在操作者的可見範圍內)。

**缺席 / `null` 的語意**(GQL-06):

| input 欄位                         | 缺席         | `null`                                 |
| ---------------------------------- | ------------ | -------------------------------------- |
| `DemoItemsTwoInput.keyword`        | 不篩         | 不篩                                   |
| `DemoItemsTwoInput.enabled`        | 啟用停用都列 | 啟用停用都列                           |
| `CreateDemoItemTwoInput.note`      | 沒有備註     | 沒有備註(同缺席)                       |
| `UpdateDemoItemTwoInput.name`      | 不動         | 型別上不允許                           |
| `UpdateDemoItemTwoInput.note`      | **不動**     | **清空**                               |
| `CreateDemoItemTwoInput.shareOrgs` | 預設(不共用) | 預設(同缺席)                           |
| `UpdateDemoItemTwoInput.shareOrgs` | 不動         | `VALIDATION_FAILED`(要不共用請送 `[]`) |

`keyword` 比對 `name` 與 `note`(不分大小寫的部分比對,regex 特殊字元當字面值);分頁 `page` 1 起算、`pageSize` 預設 20 上限 100;排序固定 `createdAt` 由新到舊。

正本:`apps/api/src/demo-items-two/`(`demo-items-two.resolver.ts`、`dto/`、`models/`)、`apps/api/schema.gql`

## admin 頁面

專案新增頁面走 `app/project/module-pages.ts`,替換底座頁走 `app/project/page-replacements.ts`,保留底座原版。示範模組的四個 key = 四頁,`app/base/module-pages.ts` 各登記一個元件;**新增與編輯是同一個共版型元件**,情境由 `module.key` 判斷。

| 模組 key                      | 元件                                  |
| ----------------------------- | ------------------------------------- |
| `demo.sample-two`             | `SampleTwoPage/SampleTwoPage.tsx`     |
| `demo.sample-two.view-page`   | `SampleTwoPage/SampleTwoViewPage.tsx` |
| `demo.sample-two.create-page` | `SampleTwoPage/SampleTwoFormPage.tsx` |
| `demo.sample-two.edit-page`   | 同上(共版型)                          |

**三頁本體是共用的**:`components/base/crud/` 的 `DemoListPage` / `DemoDetailPage` / `DemoFormPage`,設定驅動(介面與逐項 JSDoc 在 `shared/demo-module-config.ts` 的 `DemoModuleConfig`)。本模組的設定物件是 `pages/base/demo/SampleTwoModule.tsx`,常數在 `demo-sample-two-config.ts`。**頁面程式碼與示範模組1 一模一樣,差別全在設定物件** —— 這組共用元件就是 module-scaffold 的前端藍本。

**對照組在畫面上少了什麼**(這正是它存在的理由):

| 示範模組1 有                   | 示範模組2 | 為什麼                                            |
| ------------------------------ | --------- | ------------------------------------------------- |
| 分類篩選與分類欄位             | 無        | 沒有欄位管理選項來源(設定物件沒給 `list.Filters`) |
| 狀態欄(草稿 / 已發布 / 已封存) | 無        | 資料範圍的 enum 欄位只在示範模組1                 |
| 內部備註(三態)                 | 無        | 沒有欄位級權限                                    |
| 封面 / 附件上傳                | 無        | 沒有雙路儲存(設定物件的 `form.uploads` 是空陣列)  |
| 填寫提示 / 變更歷程區塊        | 無        | 沒有頁面自有權限(設定物件沒給 `form.slots`)       |

**兩層判斷分開問**(ADR-0011,與示範模組1 同一套 `useDemoAccess`):進得去哪一頁看 `me.modules` 有沒有那個模組(路由字串也從模組陣列取,前端不寫死路徑);頁內能做什麼看權限集。**逐列的編輯 / 刪除一律讀 api 給的 `item.abilities`**,不與 `usePermissions` 相乘。

**路由防守**沿用示範模組1 的做法(`lib/base/module-tree.ts` 的 `matchModuleRoute`:精準比對落空時,只對 hidden 模組再試一次「去掉最後一段」)。列表頁後面多接一段仍然是無權限頁。

**`enabled` 不在表單上**:它由 `setDemoItemTwoEnabled` 單獨切換(守 `.edit`),表單只有 name / note。**列表的「啟用」欄是開關**:改得動的那一列(`abilities.canEdit`)直接切、不另開確認,切完只重查當前這頁清單,失敗時列表上一條 Alert 說明;改不動的列與詳情頁仍是唯讀標籤。開關是共版型的**選配**(設定物件的 `useSetEnabled`,與示範模組1 同一套),不給的模組列表就維持標籤。

正本:`apps/admin/src/pages/base/demo/SampleTwoModule.tsx`、`apps/admin/src/pages/base/demo/demo-sample-two-config.ts`、`apps/admin/src/components/base/crud/`

## 錯誤碼

**不新增任何 code** —— 對照組只用得到三個通用碼,這本身就是示範:

| code                | 什麼情況                                                                                |
| ------------------- | --------------------------------------------------------------------------------------- |
| `FORBIDDEN`         | 缺該端點的權限(由 `@RequirePermission` 統一擋);無 `reason`                              |
| `NOT_FOUND`         | 可見範圍外、或已軟刪除的項目 —— 兩者同碼,不透露存在與否                                 |
| `VALIDATION_FAILED` | `name` 去頭尾空白後為空(`fields: ["name"]`)、`id` 不是合法的 ObjectId(`fields: ["id"]`) |

**admin 的對應**:`VALIDATION_FAILED` 依 `extensions.fields` 標在對應欄位上(只有 `name`),其餘用一條 Alert 說明;解讀集中在 `shared/demo-error.ts`(兩支示範模組共用一份)。

正本:`apps/api/src/demo-items-two/demo-items-two-error.ts`、`apps/admin/src/components/base/crud/demo-error.ts`

## 稽核

`demo-item-two.create` / `.edit` / `.delete` / `.toggle-enabled`,`targetType` 一律 `demo_item_two`。無變更歷程端點(那是示範模組1 的頁面自有權限示範)。

正本:`apps/api/src/demo-items-two/demo-items-two.service.ts`(`AUDIT`)

## 測試

- api:`apps/api/src/demo-items-two/demo-items-two.test.ts`(含「共用給」);夾具 `test-support/fixtures.ts`。資料共用機制本身的表格測試在 `apps/api/src/database/data-sharing.test.ts`。
- admin:`apps/admin/src/pages/base/demo/SampleTwoPage/SampleTwoPage.test.tsx`、`SampleTwoViewPage.test.tsx`、`SampleTwoFormPage.test.tsx`、`apps/admin/src/pages/base/demo/SampleTwoRoutes.test.tsx`;msw handler `apps/admin/src/test/msw/demo-sample-two-handlers.ts`、夾具 `demo-two-fixtures.ts`。
- 劇本 E2E:`apps/e2e/src/specs/scenario-03-undeclared-target.spec.ts`(未宣告資料範圍目標的對照);劇本本文見 [permission-scenarios](../testing/permission-scenarios.md)。

正本:`apps/api/src/demo-items-two/`、`apps/admin/src/pages/base/demo/SampleTwoPage/`、`apps/e2e/src/specs/scenario-03-undeclared-target.spec.ts`

## 使用者說明(help.md)

[demo.sample-two.help.md](../../apps/admin/src/md/module-help/base/demo.sample-two.help.md)(租戶使用者說明,build 時打包進說明彈窗)。

正本:`apps/admin/src/md/module-help/base/demo.sample-two.help.md`

## 平台視角備註

- 示範資料全部掛根組織、建立者是假 id(見「資料」的兩個已知限制):租戶帳號一登入列表是空的,是對的。
- 「不宣告資料範圍目標」是本模組存在的理由之一,不要為了一致性替它補 `dataScopeTarget` —— 補了劇本 3 就沒有對照組。

正本:`apps/db-migrator/seeds/base/modules/demo.sample-two.ts`、`apps/db-migrator/seeds/base/demo-items.ts`
