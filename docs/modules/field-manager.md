# 欄位管理(技術)

## 用途

管理表單下拉的選項:類別(如「性別」「示範分類」)有兩種來源 —— 開發者在 seed 宣告的系統類別,與 root 在本頁新增的類別;全域的種子選項由系統提供,各組織可在同一類別下加自己的「自訂選項」,並沿組織樹往下繼承給下層。業務模組(如示範模組1 的分類欄)從這裡讀合併後的選項清單。

正本:`docs/adr/0002-seed-data-vs-business-data.md`、`docs/adr/0005-multi-tenant-isolation.md`

## 模組 key 與畫面

| key                                 | 名稱     | sidebarType | 路由                    | 備註                                                                                      |
| ----------------------------------- | -------- | ----------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| `system.field-manager`              | 欄位管理 | link        | `/system/field-manager` | 掛「系統管理」群組;租戶管理員模板含本模組                                                 |
| `system.field-manager.category-ops` | 類別作業 | hidden      | 無                      | 純權限容器(照 `system.org-manager.tenant-ops` 的形狀),`isRootOnly`:租戶管理員模板整個扣除 |

- 畫面:Figma「Screen / 欄位管理」90:2(左類別清單 + 右選項表格,標示種子資料)、新增選項 211:176。
- 側欄初始圖示 `label`。

正本:`apps/db-migrator/seeds/base/modules/system.ts`、`docs/standards/general/figma.md`(FIGMA-09 節點表)

## 權限表

每個模組固定有一筆 `<key>.*`(seed 自動產生,本表不列)。綁定原則:綁「按鈕 / 欄位所在的那一頁」(ADR-0004)。

| 權限 key                                              | 它是哪一頁的什麼                                                                                                                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system.field-manager.view`                           | 看類別與選項(來源欄:全域 / <組織名稱> 自訂)。表單引擎的填寫者經 `formFieldOptions` 讀類別選項,不需要本權限(`docs/modules/forms.md`「欄位管理類別選項」)                                                        |
| `system.field-manager.create`                         | 「新增選項」+ API(本組織自訂,`orgId` = 當前組織;不可與上層繼承鏈同 `value`,見「規則」;Figma「Overlay / 新增選項」)                                                                                             |
| `system.field-manager.edit`                           | 編輯自訂選項的 label / order / description + API(種子選項只能改 `enabled`)                                                                                                                                     |
| `system.field-manager.category-ops.manage-categories` | 「新增類別」按鈕、類別的「編輯類別」與停用 / 啟用 + API。**根組織專屬**:掛在 isRootOnly 的權限容器下,另守「站在根組織」(同租戶作業的 `isRootOperator`)                                                         |
| `system.field-manager.toggle-enabled`                 | 停用 / 啟用選項 + API。**自訂選項只有加它的那一層切得動**(上層 / 下層看得到但 `FORBIDDEN` + `reason: NOT_OWNER`);**種子選項限根組織操作者**(那一筆 `orgId = null`,切下去是全域生效),租戶操作者切 → `FORBIDDEN` |

正本:`apps/db-migrator/seeds/base/modules/system.ts`

## 資料

- **`field_categories`**:全域(不掛租戶過濾),依建立順序。`isSystem` 區分來源、`enabled` 是停用開關(初始 seed 值的欄位)。新增類別有**兩種方法,並列存在**:
  - **開發者在 seed 宣告**:專案類別與選項放在 `apps/db-migrator/seeds/project/`,加入 `project/registry.ts` 的 `seeds`;宣告形狀沿用 `base/field-categories.ts`、`base/fields.ts`。走 code + PR 跨環境同步,`isSystem: true`。適合模組固定要用的類別 —— 程式碼以 key 引用它,每個環境都必須有。
  - **root 在本頁新增**(`createFieldCategory`):只在該環境,`isSystem: false`。適合營運上臨時需要的類別,不必發版。
  - 畫面建的類別日後要固定下來,就在 seed 宣告**同一個 key**:seed 以 key **認養**那一筆(`isSystem` 改 true、名稱 / 說明以 seed 為準、`_id` 不動,表單版本的類別 key 與 `fields.categoryId` 的引用都不受影響);該類別下根組織加的、與 seed 宣告同 `value` 的選項一併認養成全域種子(租戶的自訂選項與根組織加的其他選項不動)。認養單向;seed 沒宣告的畫面類別一律不碰。
- **`fields`**:選項。`orgId` nullable —— `null` = 全域種子、有值 = 該組織的自訂選項。`(categoryId, orgId, value)` 唯一索引;`key` 選填、sparse unique。
- **種子選項的 key**:`<類別 key>.<value>`(如 `gender.male`、`demo-category.side-dish`),只給冪等識別用;自訂選項沒有 key、以 `_id` 識別。production 第一次 seed 後不可改。
- `enabled` 是 ADR-0002 的「初始 seed 值的欄位」:由人在系統內管理,seed 重跑不覆蓋。

**種子內容**(全域類別與選項,`orgId = null`;order 依宣告順序 1 起算):

| 類別 key         | 類別名   | 選項 value    | 選項 label | order |
| ---------------- | -------- | ------------- | ---------- | ----- |
| `gender`         | 性別     | `male`        | 男         | 1     |
|                  |          | `female`      | 女         | 2     |
|                  |          | `other`       | 其他       | 3     |
|                  |          | `undisclosed` | 不透露     | 4     |
| `demo-category`  | 示範分類 | `staple`      | 主食       | 1     |
|                  |          | `side-dish`   | 小菜       | 2     |
|                  |          | `drink`       | 飲品       | 3     |
| `reprint-reason` | 補印原因 | `lost`        | 遺失       | 1     |
|                  |          | `damaged`     | 破損       | 2     |
|                  |          | `other`       | 其他       | 3     |

示範畫面上的「甜點」是租戶自訂選項的示意,**不是種子**。

- `reset --mode=data`:root 在畫面建的類別(key 不在 seed 宣告裡)算人建資料,一起刪(ADR-0002「還原」)。

正本:`apps/api/src/database/schemas/field-category.schema.ts`、`apps/api/src/database/schemas/field.schema.ts`、`apps/db-migrator/seeds/base/field-categories.ts`、`apps/db-migrator/seeds/base/fields.ts`

## 規則

### 自訂選項的可見範圍與可編輯範圍

**看得到 = 全域 + 我的上層(一路到租戶頂層,不受可見性開關影響)+ 自己 + 我可見範圍內的下層;只能編輯 / 停用自己這一層加的。**

以好食公司(租戶頂層)→ 南港店 → 子南港店,另有信義店為例:

| 誰在看                      | 看得到的自訂                          | 可編輯       |
| --------------------------- | ------------------------------------- | ------------ |
| root                        | 全部租戶的                            | 根組織加的   |
| 好食公司(可見範圍 = 子樹)   | 好食公司 + 南港店 + 子南港店 + 信義店 | 好食公司加的 |
| 南港店(可見範圍 = 子樹)     | 好食公司 + 南港店 + 子南港店          | 南港店加的   |
| 南港店(可見範圍 = 僅本組織) | 好食公司 + 南港店                     | 南港店加的   |
| 子南港店                    | 好食公司 + 南港店 + 子南港店          | 子南港店加的 |
| 信義店                      | 好食公司 + 信義店                     | 信義店加的   |

- **上層(祖先)不受可見性開關影響**:開關管的是「看不看得到下層」(ADR-0005),往上繼承是欄位選項自己的語意 —— 上層加的選項對下層是「發下來的設定」,關掉開關不該讓表單少一半選項。
- 祖先由當前組織的 `orgs.ancestors` 取(物化路徑,ADR-0005);兄弟 / 旁支看不到彼此。
- 這代表**合併清單的讀取要提升範圍**(祖先不在 `visibleOrgIds` 裡,`tenantScopePlugin` 會濾掉),所以 `fields` 的讀取一律用 `field-visibility.ts` 的 `fieldReadContext` + 明列 orgId 的條件 —— 範圍由該檔依本表算出,不是把過濾關掉。
- 合併清單排序:先 `order`,同 `order` 再依**組織深度**(全域最前、下層最後),同深度依建立順序。

### value 的唯一性

- 同一類別、同一組織下 `value` 不可重複 —— 唯一索引 + 表單驗證。
- **自訂選項也不可與同類別的「上層繼承鏈」(全域 + 祖先組織的自訂 + 自己)同 `value`**:那些筆的 `orgId` 不同,唯一索引擋不到,由 service 的表單驗證擋,一樣回 `FIELD_VALUE_DUPLICATE`。理由:合併清單是給表單下拉用的,同一個 `value` 出現兩次,存進業務資料後分不出是哪一筆。
- **旁支 / 下層的同 `value` 不算重複**:下層看不看得到由可見性開關決定,拿它當唯一性判準會讓「同一個新增動作因為別人切了開關就失敗」。**已知取捨**:開關為子樹時,上層的合併清單可能同時出現自己與下層的同一個 `value`(`ownerOrg` 不同),表單下拉靠 `ownerOrg` 分辨;真的造成困擾時再收斂。

### 種子選項的 `enabled` 是全域開關

`fields` 的全域種子只有一筆文件(`orgId = null`),切它等於對全平台生效,沒有「本組織生效」的覆寫資料結構(ADR-0002:`enabled` 是初始 seed 值欄位,與模組 / 權限的 kill switch 同一模型)。因此 `setFieldEnabled` 對種子選項**限根組織操作者**;租戶操作者切種子選項回 `FORBIDDEN`(自訂選項照常可切)。這由 api 直接寫進每一列的 `canToggleEnabled`,前端不自己判斷視角。

### 類別

- 類別 `key`:kebab-case(小寫英數、單一 `-` 分隔、不含 `.`),最長 40,與種子 key 同一套(`@repo/domain/form` 的 `FIELD_CATEGORY_KEY_PATTERN`);唯一(含停用的類別);**建立後不可改**(表單定義以 key 引用類別,種子選項的 key 是 `<類別 key>.<value>`)。
- 類別不可刪;系統類別**唯讀**:名稱與說明是「每次都 seed 的欄位」,由 seed 維護(說明沒宣告即 `null`),所以不可改名 / 說明、不可停用(啟用可以 —— 認養時可能帶著停用狀態),違反回 `FORBIDDEN` + `SYSTEM_CATEGORY`。
- **停用只影響表單設計器**:類別清單(`fieldCategories(input: { enabledOnly: true })`)不列、不能新選。既有欄位用到停用類別時照常顯示:執行期的選項查詢(`formFieldOptions`、送出驗值、顯示名解析)不看類別的 `enabled`,發布檢查器的類別 key 集合也含停用的類別。欄位管理頁照樣列出停用的類別(灰掉、標「已停用」),選項照常可管。

### 其他

- 種子選項僅 `enabled` 可改;自訂選項的 `value` 建立後不可改。
- 選項不可刪(既有資料要對照),僅停用;停用只影響新填寫,既有資料不受影響。

正本:`apps/api/src/fields/fields.service.ts`、`apps/api/src/fields/field-visibility.ts`

## api 介面

```graphql
fieldCategories(input: FieldCategoriesInput): FieldCategoriesPayload!  # 依建立順序(createdAt → _id)
fields(categoryId: ID!): FieldsPayload!            # 合併清單(範圍與排序見「規則」)
createField(input: CreateFieldInput!): FieldPayload!
updateField(input: UpdateFieldInput!): FieldPayload!
setFieldEnabled(input: SetFieldEnabledInput!): FieldPayload!
createFieldCategory(input: CreateFieldCategoryInput!): FieldCategoryPayload!         # manage-categories + 站在根組織
updateFieldCategory(input: UpdateFieldCategoryInput!): FieldCategoryPayload!         # 同上
setFieldCategoryEnabled(input: SetFieldCategoryEnabledInput!): FieldCategoryPayload! # 同上
```

兩個 query 回 GQL-03 的列表形狀 `{ items, totalCount }`(不分頁,`totalCount` 即 `items` 長度);選項的三個 mutation 回 `FieldPayload { field: Field! }`、類別的三個回 `FieldCategoryPayload { category: FieldCategory! }`(GQL-02)。類別沒有刪除端點。

**欄位語意**(GQL-07:正本在此,前端引用不另寫解釋)

- `FieldCategory.isSystem`:`true` = seed 宣告的系統類別(唯讀,見「規則」的「類別」);`false` = root 在畫面新增的。
- `FieldCategory.enabled`:`false` = 表單設計器的類別清單不列;既有欄位照常顯示、執行期選項照常查。
- `Field.ownerOrg`:加這筆的組織 `{ id, name }`;**`null` = 全域種子**(`orgId = null`)。畫面「來源」欄的文案由前端組(`null` → 「全域」、有值 → 「<ownerOrg.name> 自訂」)。**組織名稱一律由 api 給** —— 合併清單含上層 / 下層組織加的選項,前端拿 session 的當前組織名會把別人的標成自己的。
- `Field.isOwn`:這筆是不是**當前組織**這一層加的(`orgId = 操作者的當前組織`)。
- `Field.canEdit` / `Field.canToggleEnabled`:api **依操作者算好**的「這一列能不能動」,前端只讀、再與自己的權限(`edit` / `toggle-enabled`)取交集,不自己推組織關係、也不推「是不是根組織視角」。規則:`canEdit` = 自訂選項且 `isOwn`;`canToggleEnabled` = 自訂選項看 `isOwn`、種子選項看操作者是不是根組織。
- `Field.enabled`:`false` = 已停用,影響範圍見「規則」的「其他」。

**缺席 / null 語意(GQL-06)**

- `CreateFieldInput.order` 缺席 / null = `0`;`description` 缺席 / null = 不寫。
- `UpdateFieldInput.label` / `order` 缺席 = 不動;`description` 缺席 = 不動、`null` = 清空。`value` 不在 input 內(見「規則」的「其他」)。
- `FieldCategoriesInput.enabledOnly` 缺席 / null / `false` = 全部(欄位管理頁);`true` = 只列啟用(表單設計器)。整個 `input` 可省略。
- `CreateFieldCategoryInput.description` 缺席 / null / 空白 = 不寫。
- `UpdateFieldCategoryInput.name` 缺席 / null = 不動;`description` 缺席 = 不動、`null`(或空白)= 清空(`$unset`)。`key` 不在 input 內 —— 建立後不可改。

正本:`apps/api/src/fields/`(`fields.resolver.ts`、`fields.service.ts`、`field-categories.resolver.ts`、`field-categories.service.ts`、`models/`、`dto/`)、`apps/api/schema.gql`

## admin 頁面

`apps/admin/src/components/base/FieldManager/`(頁面 `pages/base/system/FieldManagerPage/FieldManagerPage.tsx` 只包一層)。左類別清單(`CategoryListPanel.tsx`),右邊是所選類別的合併清單(`FieldOptionsPanel/`):顯示名稱、值、排序、**來源**、啟用開關、操作;新增 / 編輯彈窗在 `FieldFormDialog/`。

- **來源欄與「這一列能做什麼」集中在 `field-source.ts`**(`isSeedOption` / `fieldSourceView` / `canToggleOption` / `canEditOption` / `managedByOrgOf`),表格與彈窗不自己解讀 `ownerOrg`。規則本身在 api(`canEdit` / `canToggleEnabled`),這個檔只做「與權限取交集 + 文案」。
- **「來源」欄文案**:「全域」或「<組織名稱> 自訂」。不用「租戶自訂」—— 下層組織也可能自訂,且「租戶」是平台詞彙。
- **停用 / 啟用直接送**,不另開確認彈窗:可逆,而且只影響新填寫。列表的啟用欄是 Switch;無權限或改不動時退回唯讀。
- **編輯彈窗只給自訂選項**;種子選項連彈窗都不開,操作欄改顯示「由系統管理員維護」。
- **`FIELD_VALUE_DUPLICATE` 標在「值」欄位上**(不是頁面 Alert),彈窗留著讓人改值。
- **改不動的列反灰不隱藏**:上層 / 下層組織加的選項整列以 `text.disabled` 呈現、開關 disabled,操作欄顯示「由 <組織名> 管理」,開關與這句文字都以 `Tooltip` 說明原因(REACT-10)。看得到但動不了,跟「這個動作我沒有權限」是兩回事。
- 前端不推「根組織視角」:每一列能不能切由 api 的 `canToggleEnabled` 決定。
- **類別作業**只看 `manage-categories` 權限(租戶管理員模板拿不到,所以不必另判視角):左欄標題列的「+ 新增類別」、右欄標題列的「編輯類別」與「停用類別 / 啟用類別」。彈窗在 `CategoryFormDialog/`:新增時 key 的格式與唯一(對照已載入的全部類別)當場擋、送出鈕停用;api 回的 `FIELD_CATEGORY_KEY_DUPLICATE` 同樣標在 key 欄位;編輯時 key 唯讀。停用 / 啟用直接送、不另開確認(可逆)。
- 左欄每個類別:系統類別標 `Tag`「系統」;停用的類別名稱以 `text.disabled` 呈現並標「已停用」。系統類別沒有「編輯類別」與「停用類別」鈕(停用的系統類別仍給「啟用類別」)。
- 表單設計器的類別下拉(`FormsPage/FormDesigner/PropertyPanel/OptionsEditor.tsx`)帶 `enabledOnly: true`;已選了停用類別的欄位,下拉以 key 顯示那一個值。

正本:`apps/admin/src/components/base/FieldManager/`(`field-source.ts`、`FieldOptionsPanel/FieldOptionsTable.tsx`、`field-manager-error.ts`)

## 錯誤碼

| 情況                                                                                    | 回什麼                                                        |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 同一類別下 `value` 與**上層繼承鏈**重複(自己這一層已有、全域選項、看得到的上層組織自訂) | `FIELD_VALUE_DUPLICATE`                                       |
| `updateField` 碰種子選項(種子只能 `setFieldEnabled`)                                    | `FORBIDDEN` + `extensions.reason = "SEED_READ_ONLY"`          |
| `setFieldEnabled` 碰**種子**選項而操作者不是根組織                                      | `FORBIDDEN` + `extensions.reason = "SEED_GLOBAL_SWITCH"`      |
| mutation 碰**看得到但不是自己這一層加的**自訂選項(上層或下層組織加的)                   | `FORBIDDEN` + `extensions.reason = "NOT_OWNER"`               |
| 類別或選項不在合併清單 / 可見範圍內(不透露它存在)                                       | `NOT_FOUND`                                                   |
| 新增類別的 `key` 已存在(含停用的類別)                                                   | `FIELD_CATEGORY_KEY_DUPLICATE`(`extensions.fields = ["key"]`) |
| 改名 / 停用系統類別                                                                     | `FORBIDDEN` + `extensions.reason = "SYSTEM_CATEGORY"`         |
| 類別作業不是站在根組織做(權限可能經角色被帶到別的組織)                                  | `FORBIDDEN` + `extensions.reason = "ROOT_ONLY"`               |
| id 格式不對、`label` / `value` / 類別 `name` 空白、類別 `key` 格式不符                  | `VALIDATION_FAILED`                                           |

前端依 `reason` 換文案,解讀集中在 `components/base/FieldManager/field-manager-error.ts`。

正本:`apps/api/src/fields/fields-error.ts`、`apps/admin/src/components/base/FieldManager/field-manager-error.ts`

## 稽核

選項:動作 `field.create` / `field.edit` / `field.toggle-enabled`,`targetType` 一律 `field`。
類別:動作 `field-category.create` / `field-category.update` / `field-category.set-enabled`,`targetType` 一律 `field-category`。沒有實際變更(已是目標狀態、`update` 沒帶任何欄位)不寫入、不記稽核。

正本:`apps/api/src/fields/fields.service.ts`、`apps/api/src/fields/field-categories.service.ts`

## 測試

- api:`apps/api/src/fields/fields.test.ts`(端點、錯誤、種子開關)、`apps/api/src/fields/field-categories.test.ts`(類別作業:新增 / 改名 / 停用、守門、設計器清單)、`apps/api/src/fields/field-visibility.test.ts`(可見 / 可編輯範圍表);夾具 `apps/api/src/fields/test-support/fixtures.ts`
- admin:`apps/admin/src/pages/base/system/FieldManagerPage/` 的 `FieldManagerPage.test.tsx`、`FieldManagerFeedback.test.tsx`、`FieldManagerSeed.test.tsx`、`FieldManagerVisibility.test.tsx`、`FieldManagerCategories.test.tsx`(類別作業);設計器的類別下拉只列啟用在 `FormsPage/FormsPageDesignerPickers.test.tsx`;共用 harness `field-manager-test-support.ts`
- 劇本 E2E(`docs/testing/permission-scenarios.md`):劇本 2 / 12 確認沒有 `system.field-manager.view` 時示範模組1 的分類欄退化(`scenario-02-data-scope-rule.spec.ts`、`scenario-12-visibility-toggle.spec.ts`)、劇本 16 租戶視角的種子選項唯讀(`scenario-16-tenant-perspective.spec.ts`)

正本:上列檔案、`docs/testing/permission-scenarios.md`

## 使用者說明(help.md)

[system.field-manager.help.md](../../apps/admin/src/md/module-help/base/system.field-manager.help.md)

正本:`apps/admin/src/md/module-help/base/system.field-manager.help.md`

## 平台視角備註

- 種子類別與選項是平台層的設定,種子選項的啟停是全平台生效、只有根組織能切 —— 租戶在畫面上只會看到「由系統管理員維護」。
- 類別作業(新增 / 改名 / 停用類別)只有站在根組織、持 `manage-categories` 的人能做;超級管理員自動有,其他根組織角色要在角色矩陣把「類別作業」底下的權限授給它。租戶看得到 root 建的類別(類別是全域的),可在底下加自訂選項。
- 新增類別的兩條路與認養規則見「資料」;seed 測試 `apps/db-migrator/src/seed/seed.test.ts`「seed 以 key 認養」、reset 測試 `apps/db-migrator/src/reset/reset.test.ts`。
- root 看得到全部租戶的自訂選項,但只能編輯 / 停用根組織自己加的。

正本:`apps/db-migrator/seeds/base/field-categories.ts`、`apps/db-migrator/seeds/base/fields.ts`、`apps/db-migrator/seeds/base/modules/system.ts`、`apps/api/src/fields/field-visibility.ts`
