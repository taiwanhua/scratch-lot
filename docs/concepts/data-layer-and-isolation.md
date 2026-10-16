# 資料層與租戶隔離(現況說明)

回答「資料分幾類、誰看得到哪些、怎麼保證繞不過」。決策理由見 ADR-0001(核心關聯)、ADR-0002(種子與遷移)、ADR-0005(多租戶隔離)、ADR-0007(基礎欄位)、ADR-0008(資料範圍)。collection 一覽見 `docs/data-model.md`。

## 三類資料

| 類別         | 判定                              | 過濾                              | 例                                                                                                                           |
| ------------ | --------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 租戶資料     | 有 `orgId`,掛 `tenantScopePlugin` | 自動過濾                          | `customers`、`fields`(租戶自訂)、`audit_logs`、`demo_items_*`、`form_submissions`、`workflow_instances`;`orgs` 以 `_id` 判定 |
| 全域資料     | 不掛 plugin                       | 不過濾                            | `modules`、`permissions`、`field_categories`、`data_scope_targets`                                                           |
| 關聯歸屬資料 | 沒有 `orgId`,歸屬走核心關聯       | 資料層不過濾;模組先查關聯再查本表 | `users`(經 `org_user`)、`roles`(經 `org_role`)                                                                               |

- 底座 schema 的 plugin 與治理類 / 業務類由 `apps/api/src/database/schemas/base-plugins.schema.test.ts` 鎖定;新增專案資料另由登記驗證與真資料層測試檢查。
- `fields` 掛 `allowGlobal`:`orgId = null` 的全域種子對所有人可見。
- **模組資料表**:schema 明確開 `tenantScopePlugin({ moduleData: true })` 的租戶資料(`demo_items_one`、`demo_items_two`、`form_submissions`、`workflow_instances`),多兩個欄位 `moduleKey`(必填;固定欄位模組寫死自己的 key,表單提交與審核實例寫綁的模組)與 `tenantId`(依 `orgId` 的祖先推導的租戶頂層,根組織資料為 null;前端不可指定、一般更新不可改)。`tenantId` 只用於租戶邊界、索引與日後分片,**不決定可見範圍**(仍看 `orgId`)。資料範圍規則只套模組資料表,但 `workflow_instances` 禁止登記資料目標(ADR-0008)。
- **以 `tenantId` 為邊界的表**:`business_relationships`(業務關聯:`org_form` 表單分派 / 啟用、`org_workflow` 流程分派、`org_form_workflow` 流程綁定)、`workflows`、`workflow_tasks` 不掛 plugin —— 部門使用者的可見範圍不含租戶頂層,審核者也不一定在申請人組織的可見範圍內,照可見範圍過濾會查不到。改以必填的 `tenantId` 為邊界,各自的專屬 repository(`BusinessRelationshipsRepository`、`WorkflowsRepository`、`WorkflowTasksRepository`)每個方法強制帶它(沒帶就拋錯;共用流程 / 根組織要明給 `null`)。
- **表單與版本定義**:`forms`、`form_versions`、`workflow_versions` 不掛 plugin;誰看得到哪一份由服務層依所屬表單 / 流程的擁有者(`forms.ownerOrgId`、`workflows.tenantId`)與分派關聯判斷(如 `apps/api/src/forms/form-access.service.ts`),不是可見範圍。

正本:`apps/api/src/database/plugins/tenant-scope.plugin.ts`、`apps/api/src/database/schemas/`、`apps/api/src/project/database/`

## 底座與專案資料的組裝

底座與專案各自維護功能與資料登記。`AppModule` 組合底座功能與 `ProjectModule`,兩方的 `ApiFeatureRegistration` 必須有唯一的 key 與 module identity;不提供核心 module/provider 替換。`DatabaseModule` 組合 `database/base/registrations.ts` 與 `project/database/registrations.ts`。登記功能不代表授予使用者權限,也不替代模組及權限的 seed 宣告。

schema、repository 與組織資料檢查在同一筆資料登記中以 modelName 與 DI token 連結。組裝時拒絕重複 key、model name、collection、provider token 與檢查 key,也拒絕指向不存在或不同 model 的 repository / 檢查。token 以 class、string、symbol 本體比較,不靠類別名稱猜身分。

repository token 不能與 model token、組裝器內部 token 或 Nest 全域 guard/interceptor/filter/pipe token 重複。同一登記可有多個 repository 共用一個 model;collection 必須與 schema 選項一致。保留原 schema instance 與 plugin,不複製 schema 或重掛 plugin。

底座 repository 定義放在 `database/base/` 的獨立檔,不回指組裝入口。`database.module.ts` 保留既有 repository 匯出以相容消費端,業務模組只注入這些受控出口;Mongoose model 與整個 MongooseModule 不對外匯出。新增專案資料只改專案登記與實作,不在底座的 providers 或 exports 陣列補項。

一般新增專案 model 採必填 ObjectId 的 `orgId` 業務資料形狀,宣告方式見[新增模組步驟](../agents/module-scaffold.md#步驟-2schema基礎欄位-plugin租戶過濾)。登記驗證會以公開 schema path 檢查欄位宣告:使用 BaseRepository、baseFields 與 tenantScope,設定 `kind: "business"`、`allowGlobal: false`;模組資料使用 `moduleData: true`。先設定 collection 再掛 plugin,保留原 schema 物件。登記檢查 baseFields 的安裝標記、tenantScope 設定與安裝當下的 collection;只補幾個同名欄位不能代替 middleware,事後改 collection 也不能補救已捕捉的舊值。

每張一般新增專案 model 都須登記歸屬欄為 `orgId` 的業務資料存在檢查。reader 建立時再核對 repository 確為 BaseRepository,且其只讀 modelName / collection 識別與登記相符;錯綁另一張表會使啟動失敗。`DatabaseModule` 也保留 DataScopeRuleProvider 的啟動檢查,缺少規則提供者不能正常啟動。

底座預設沒有專案業務資料,專案登記沒有 unsafe 或略過檢查開關。新增資料種類須先擴充並審查契約,不能用裸 Model 查詢繞過租戶隔離。

這是受審查程式的組裝契約。來源限制、裸 Model 查詢 lint 與 review 共同守住邊界;登記驗證不代替 RBAC,也不宣稱能稽核任意 Nest module 內部的私自註冊。

正本:`apps/api/src/app.module.ts`、`apps/api/src/base/api-feature-registration.ts`、`apps/api/src/database/database.module.ts`、`apps/api/src/database/registration.ts`、`apps/api/src/database/org-business-data.reader.ts`;新增步驟見[模組 scaffold](../agents/module-scaffold.md)。

### 組織業務資料檢查

刪組織與撤銷開通共用前置檢查,完成授權與對象資格判斷後,由 `OrgBusinessDataReader` 依登記回答是否仍有業務資料。七個底座 BaseRepository 檢查與專案檢查共用受控的存在性查詢;workflows / tasks 的 tenantId 專用檢查保留底座 adapter。`audit_logs` 是歷史紀錄,不阻擋刪除。

檢查只接受已驗證的組織 id、登記的 repository 與歸屬欄,不接受專案 callback 或任意 filter。資料範圍把資料藏起來時仍須阻擋刪除;查詢出錯也不能當成沒有資料。新增 collection 的責任是補完整專案資料登記,不修改 OrgsService 的業務清單。

正本:`apps/api/src/database/org-business-data.reader.ts`、`apps/api/src/orgs/orgs.service.ts`、`apps/api/src/orgs/tenant-ops.service.ts`、`docs/modules/org-manager.md`「刪除」。

## 核心關聯

五個實體(Org / User / Role / Module / Permission)之間的多對多,集中在一張 `core_relationships`,`type` 是封閉的六種。`org_manager` 是命名規約的例外:第二方是使用者,語意是「該組織的主管」,與成員關係 `org_user` 分開存。

| type              | first → second | 意思                 |
| ----------------- | -------------- | -------------------- |
| `org_user`        | 組織 → 使用者  | 所屬組織             |
| `org_role`        | 組織 → 角色    | 擁有組織(每角色一筆) |
| `user_role`       | 使用者 → 角色  | 角色授予             |
| `role_module`     | 角色 → 模組    | 可進的頁             |
| `role_permission` | 角色 → 權限    | 頁裡能用的           |
| `org_manager`     | 組織 → 使用者  | 組織的主管(可多位)   |

- 唯一出口是 `RelationService` 的具名方法(如 `addUserToOrg`、`assignRoleToUser`)。BaseRepository 建構時拒收這張表。
- 讀不帶操作者上下文(權限解析要先讀關聯);寫帶上下文,填 `createdBy` / `updatedBy`。
- 移除 = 硬刪除。表只存現況,歷史在 `audit_logs`。
- 固定從屬用欄位,不進此表(如 `permissions.moduleId`)。
- 批次原語:`linkMany`(重複即拋錯)、`ensureLinks`(冪等)、`unlinkMany`。
- 業務域(如食譜)的關聯各自建具名 collection。

正本:`apps/api/src/database/relation.service.ts`、`apps/api/src/database/schemas/core-relationship.schema.ts`

## 基礎欄位、軟刪除、更新保護

- 底座與一般新增專案資料表由 `baseFieldsPlugin` 掛上 `createdAt`、`updatedAt`、`createdBy`、`updatedBy`、`deletedAt`。schema class 不重複宣告。
- 刪除 = 寫 `deletedAt`。之後查詢預設排除;要看已刪除的明講 `includeDeleted`。
- 已刪除的不能再更新。
- 硬刪除只有四種:關聯的移除、補償刪除(`hardDeleteById`,本次請求剛建、尚未對外可見的文件)、從未發布的版本草稿(`hardDeleteDraft`)、退役的表單欄位級權限。清單與理由見 ADR-0007;其餘抹除走 cleanup migration。
- `updateById` / `updateMany` 碰到 `orgId`、`createdBy`、`createdAt`(含子路徑)→ 拋錯。
- 各表的偏好設定統一叫 `settings`,已知 key 在程式裡定義。
- 高敏個資(`nationalId`)欄位級加密(AES-256-GCM,金鑰 `FIELD_ENCRYPTION_KEY`),預設不投影。

正本:`apps/api/src/database/plugins/base-fields.plugin.ts`、`apps/api/src/database/base.repository.ts`、`apps/api/src/database/plugins/field-encryption.plugin.ts`

## 租戶隔離怎麼繞不過

```
service 呼叫 BaseRepository.xxx(operator, …)
  → scopeQuery 把操作者上下文掛到 Query
  → tenantScopePlugin 中介層:
       沒有上下文 → 拋錯(fail-closed)
       $and { orgId ∈ 範圍 }          ← 租戶保底
       $and { 資料範圍規則的條件 }    ← 只對模組資料表,依 moduleKey 拼 $or
```

- 讀、寫、刪的查詢中介層都套(`find`、`updateOne`、`deleteMany`…)。
- 條件以 `$and` 追加,呼叫端自己的條件只能再收窄。
- 範圍是 `"all"`(根組織)時不加租戶條件。
- `create` 自動寫入當前組織;寫到範圍外 → 拋錯。
- api 內裸 `Model.find` 由 ESLint 規則 `@repo/no-raw-model-query` 擋下。
- 已知限制:`populate()` 的子查詢不帶上下文,關聯資料分兩次查。
- **四個登記在案的例外出口**(登記表在 ADR-0005「例外出口」):
  - `BaseRepository.findOwnById` / `findOwnOne` / `findOwnAndUpdate`:只給表單提交用 —— 建立者讀自己的單、寫自己的草稿。可見範圍照套、條件加 `createdBy = 操作者`,**不套資料範圍規則**(否則規則把草稿擋掉時,建立者連自己的草稿都送不出去)。列表不放寬。
  - `BaseRepository.existsAny`:只給前置檢查回答「有沒有」(刪組織、撤銷開通的「無業務資料引用」)。**不套資料範圍規則** —— 規則會收窄操作者看得到的,數到 0 就把還有資料的組織誤判成可刪,前置檢查必須 fail-closed。做法是方法內部在查詢上設 `existenceCheck`,中介層讀到就跳過資料範圍規則(租戶過濾仍依操作者上下文套上)。簽名是 `existsAny(operator, ownerField, orgId)`:條件只能是歸屬欄(`orgId` / `ownerOrgId`)等於某個組織,只回有無。唯一受控 caller 是 `database/org-business-data.reader.ts`,登記在 `EXISTS_ANY_CALLERS` 並由測試掃 src 鎖定;專案只能提供檢查登記,不能自行呼叫。旗標本身也只准出現在資料層三個檔。
  - `apps/api/src/database/form-submission-usage.ts`:退役欄位級權限清理的三層檢查要**跨全部租戶**計數提交(少算一筆草稿就會把還在用的權限刪掉),不經 BaseRepository;只回筆數與版本號,不回內容。
  - `apps/api/src/database/workflow-submission-store.ts`:審核流程(引擎、讀取授權、申請中心)讀寫提交,不套可見範圍與資料範圍規則,以 `tenantId` 為邊界;允許呼叫它的檔案登記在該檔 `WORKFLOW_SUBMISSION_STORE_CALLERS`,由測試鎖定。
- 對全員生效(套用對象「所有人」)的資料範圍規則連系統上下文也會收窄,所以「必須看到全部」的系統讀取只能走上面登記過的出口(ADR-0008)。

正本:`apps/api/src/database/base.repository.ts`、`apps/api/src/database/operator-context.ts`、`apps/api/src/database/plugins/tenant-scope.plugin.ts`

## 操作者上下文的四個集合

BaseRepository 資料操作方法的第一個參數。四個集合各有用途,不可互相代用:

| 集合            | 內容                                   | 誰用                                              |
| --------------- | -------------------------------------- | ------------------------------------------------- |
| `managedOrgIds` | 啟用中角色的擁有組織子樹聯集(管理範圍) | 治理類過濾(`orgs`)、角色 / 使用者候選             |
| `visibleOrgIds` | 所屬組織,開關 ON 時各含下層(可見範圍)  | 業務類的租戶保底                                  |
| `memberOrgIds`  | `org_user` 直接關聯,不含下層           | 資料範圍:套用對象的所屬組織、【操作者的所屬組織】 |
| `roleIds`       | 啟用中角色                             | 資料範圍:套用對象的角色                           |

- 另有 `actorId`(操作者)與 `currentOrgId`(當前組織)。
- 根組織成員的可見範圍 = `"all"`;持超級管理員或擁有組織為根的角色,管理範圍 = `"all"`。
- 治理類 / 業務類寫在 schema 上(`kind: "governance" | "business"`),不在呼叫端選。

正本:`apps/api/src/auth/operator-context.service.ts`、`apps/api/src/database/operator-context.ts`

## 管理範圍 vs 可見範圍

| 範圍     | 誰決定                          | 管什麼                                              | 受可見性開關影響 |
| -------- | ------------------------------- | --------------------------------------------------- | ---------------- |
| 管理範圍 | 持有角色的擁有組織              | 治理模組:組織樹的根、使用者清單、角色候選、搬移候選 | 否               |
| 可見範圍 | 所屬組織 + 租戶頂層的可見性開關 | 業務資料看多少(資料範圍規則在其中再縮小)            | 是               |

- 可見性開關:租戶頂層的 `settings.visibility`,`"own"`(預設)或 `"subtree"`。只看租戶頂層的值,套整棵租戶。
- 開關不影響治理頁、角色資格、管理範圍,切換不觸發重算。
- 治理頁攤開整個管理範圍;業務頁慣例上預設篩當前組織,新資料寫入當前組織。
- 要給不同管理範圍就建不同擁有組織的角色。

正本:`apps/api/src/auth/operator-context.service.ts`、`docs/testing/permission-scenarios.md` 劇本 12 / 14

## 資料範圍規則

權限管「能做什麼」,資料範圍管「看得到哪些資料的上限」。兩者分離;`*` 不影響資料範圍。

- 資料目標以 `(collection, moduleKey)` 為鍵:**一個模組一個目標**,同一張表可以有多個模組各一份(所有表單模組共用 `form_submissions`)。每個資料目標一份設定:`combineOp` + `rules[]`。
- 一條規則 = 套用對象(人員條件:所有人 / 符合條件 —— 使用者、角色、所屬組織、權限組成的 AND / OR 樹)+ 條件組合(巢狀 AND / OR 樹)。
- 沒有規則命中操作者 → 不過濾(= 可見範圍內)。
- 多條命中:`OR`(預設)取聯集;`AND` 取交集。沒命中的規則不影響他。
- 動態值:`current-user`(【操作者本人】)、`current-user-orgs`(【操作者的所屬組織】)。算不出對象 → 命中不到任何資料(fail-closed)。
- 套在整組查詢中介層,含寫入與刪除:看不到的也改不到。
- 只套模組資料表(`moduleData`);治理類與非模組資料的業務類(`fields`、`audit_logs`、`customers`)不套。未宣告資料目標的模組不會有規則。
- 執行面:查某 collection 時,把該 collection 下命中操作者的規則依模組拼成 `$or`(沒規則的模組 `moduleKey ∉ [有規則的模組]` 只看可見範圍;有規則的 `moduleKey = M` 且套 M 的規則),再與租戶保底 `$and`。固定欄位表只有一個 `moduleKey`,等於單一規則。
- 設定快取在記憶體(外層 collection、內層 moduleKey),儲存時作廢該 collection;多實例之間不同步。
- 欄位目錄:seed 宣告的業務欄位 + 底座自動掛的六個基礎欄位(`orgId`、`createdBy`、`updatedBy`、三個時間)。

| 欄位型別 | 運算子                   | 值來源                            |
| -------- | ------------------------ | --------------------------------- |
| org      | in / not-in              | 組織選擇器,或【操作者的所屬組織】 |
| user     | in / not-in              | 使用者選擇器,或【操作者本人】     |
| date     | between / before / after | 日期                              |
| enum     | in / not-in              | seed 宣告的選項                   |

正本:`apps/api/src/data-scope/data-scope-rule.ts`、`apps/api/src/data-scope/data-scope.service.ts`、`apps/api/src/database/plugins/data-scope-provider.ts`、`docs/modules/data-scope.md`「執行面的回傳語意」

## 種子資料與遷移

| 種類     | 是什麼                                                     | 怎麼同步                                   |
| -------- | ---------------------------------------------------------- | ------------------------------------------ |
| 普通種子 | 模組、權限、種子角色、欄位管理、根組織、資料目標、示範資料 | 以穩定 `key` 冪等 upsert,id 各環境各自生成 |
| 受管定義 | 登記為 seed 的共用表單與共用流程                           | 依 revision 發布,映射到各環境的版本        |
| 業務資料 | 帳號、角色副本、租戶資料                                   | 不跨環境搬;要重現用整庫 dump / restore     |
| 遷移     | 索引、結構、回填、清理                                     | migrate-mongo,一次性,記在 `changelog`      |

- 設定與資料由同一次 `update` 依序更新:`migration` → 普通種子 → 受管定義 → 目標核對。不在 server 啟動時跑;部署接線與指令見 [deployment](../deployment.md)。
- 種子欄位兩種:**每次都 seed**(預設,人改的會被拉回);**初始 seed 值**(欄位存在就不覆寫,預設 `enabled`;`modules` 另加 `icon` 與 `settings`(表單模組的列表欄位配置存在 `settings.list`),`orgs` 另加 `name`、`description` 與 `settings`(根組織的時區 `settings.timezone`))。根組織名稱與描述在初始化時使用專案 seed 值,一般部署保留 UI 修改,完整清庫還原才重建。人在畫面上改的值一定要列成初始 seed 值,否則每次部署都會被宣告值洗掉。
- **認養**:同一類資料允許人在畫面建(`isSystem: false`,如 root 在欄位管理新增的類別與選項)時,seed 宣告同一個 key 就把那一筆轉成種子 —— `isSystem` 改 true、宣告的欄位以 seed 為準、`_id` 不動。人建時沒有種子 key 的(欄位選項)由宣告的 `adoptBy` 指定怎麼找同一筆(同類別、同 value、根組織加的)。認養單向;沒宣告的人建資料 seed 不碰。
- 執行摘要印「新增 / 更新 / 認養 / 未變」四種計數。
- 可變欄位清空寫 `null`,不要 `$unset`。
- key 是識別不是欄位;改 key = 新種一筆,要配 cleanup migration。
- seed 不分環境;普通種子以原生 driver 寫入,受管定義經 API CLI 發布,app 之間不互相 import。
- root 初始帳號從 `ROOT_ADMIN_*` 環境變數建立,只在不存在時建。
- 遷移檔名 `<14 位時間戳>_<schema|data|cleanup>_<kebab 描述>.js`,由測試強制。

### 來源與組裝

底座宣告位於 `apps/db-migrator/seeds/base/`,專案宣告位於 `seeds/project/`;各自的 `registry.ts` 提供模組宣告與其他種子。只有 `seeds/registry.ts` 讀取兩方,合併後一次推導模組、權限、資料目標與租戶管理員模板。專案子模組可掛在底座父節點下;既有租戶角色副本仍由人員維護。

專案的根組織與模組初值在 `project/settings.ts`,由底座工廠讀入。組裝先檢查重名、引用、循環與欄位政策,全部通過才開始寫入,不依載入順序覆蓋同 key。新增模組的檔案與登記步驟見 [module scaffold](../agents/module-scaffold.md)。

### 宣告與寫入邊界

documents 預設以 `key` 識別,可用 `keyField` 指定其他欄位;`seedRef` 以 collection/key 解析該環境的 ID。`initialSeedValueFields` 是完整保護清單,會取代預設的 `enabled`,不是追加。已存在的 `null`、`false`、空字串都保留,只有不存在的欄位才補初值。其他宣告欄位以 `$set` 同步,宣告外欄位與未宣告文件不自動刪除。

| 宣告                         | 一般 seed 的行為                                                              |
| ---------------------------- | ----------------------------------------------------------------------------- |
| 根組織                       | 同步階層;保留 `name`、`description`、`enabled`、`settings`,未宣告的 logo 不動 |
| 種子角色、欄位類別與選項     | 同步宣告的名稱、說明、設定或選項內容,保留 `enabled`;不更新租戶角色副本        |
| 模組                         | 同步宣告的結構與行為,保留 `enabled`、`icon`、`settings`                       |
| 靜態權限                     | 同步宣告內容,包含 `settings`;保留 `enabled`,比對條件排除 dynamic 權限         |
| 資料範圍目標                 | 以 `moduleKey` 識別並同步目標及欄位,不代表修改資料範圍規則                    |
| 根初始帳號                   | account 存在即整筆不動,不重設信箱、密碼或角色;更換 account 會建立另一帳號     |
| 角色擁有關聯、租戶管理員模板 | 只補缺少關聯,移除宣告不撤銷既有授權;模板改動不自動更新租戶副本                |
| 示範資料                     | 同步宣告的示範內容,保留 `enabled` 及未宣告欄位;與專案業務資料分開             |

示範模組初建啟用,production 也可保留示範資料;開關與租戶分配由人員維護。完整欄位以各 seed 宣告為準,不是所有 `settings` 都屬初始值。

### 受管表單與流程

專案可用同一套 TypeScript `SeedSet` 登記共用表單與共用流程。宣告描述完整定義與目標發布狀態,使用既有欄位、版面及流程關卡型別;不包含環境的資料庫 ID、人員、租戶分派或案件。未登記的共用定義及租戶客製、fork 不會被接管。

每份宣告有固定的 `revision`。安裝紀錄將它映射到各環境自己的 ID 與版號,因此不同環境的歷史版號可以不同,交付的內容仍相同。同 revision 不可改內容;修改內容或改成退役需給新 revision。

`contentHash` 比對定義內容、key 與受管名稱等 metadata,不含 revision、發布說明及目標狀態;`snapshotHash` 則涵蓋整份宣告,用來檢查同 revision 是否被改寫。兩者都依共用契約正規化,不含環境 ID 或資料庫版號;正本是 `packages/domain/src/seed/canonical.ts`。

發布由 API 的專用 CLI 沿用既有設計服務,使用該環境真實的根組織操作者、權限檢查與稽核。普通 documents seed 不直接寫表單、流程、版本或動態權限。

| 現場狀態                               | 處理方式                                  |
| -------------------------------------- | ----------------------------------------- |
| 尚無該定義                             | 建立共用身分,經草稿、檢查與發布建立版本   |
| 已有完全相同的共用發布內容             | 採納原版,保留 ID、歷史與分派              |
| 已受管且內容未變                       | 核對實體後回報未變,不增版或重寫發布時間   |
| 已受管且有新內容                       | 核對前次安裝狀態後發布新版,保留歷史       |
| 有未預期草稿、發布中斷、版本或名稱漂移 | 回報衝突,由操作者整理現場或重新匯出進版控 |
| 本次安裝中斷                           | 依安裝紀錄接續原 ID 與版本,不另發第二版   |

退役需明確宣告;只從 registry 移除,不會刪定義、退役或撤銷分派。退役後重新發布,即使內容相同也需新 revision 與新版號。歷史查驗只讀既有映射及凍結內容,不把目前版本切回舊版。既有提交、修訂與進行中的流程繼續引用原版,不因定義更新自動升級。

整批發布不是原子操作。預檢後才發生的現場競爭或執行期錯誤,可能使前面的定義已完成;執行器停止並保留續跑紀錄,不自動回滾整批。外部漂移須先處理現場與宣告的差異,不能把重跑當成強制覆蓋。

正本:`packages/domain/src/seed/`、`apps/api/src/seed/`、`apps/api/src/database/schemas/seed-definition-installation.schema.ts`;版本生命週期見[表單引擎](form-engine.md)與[流程引擎](workflow-engine.md)。

### Migration 與設定順序

底座與專案的新 migration 分別放在 `apps/db-migrator/migrations/base/`、`migrations/project/`;根目錄保留既有歷史檔。所有來源的檔名全域唯一,執行器依完整檔名排序,以原檔名對照 `changelog`,不因分資料夾重跑舊檔。

資料轉換需要特定設定時,在 migration 的 `seedDependencies` 指定 `seeds/{base,project}/revisions/` 內不可變的 `.seed.ts`。快照沿用同一份 `SeedSet`,可用 `requiresSeeds` 指定前置快照;不引用可變的當前 registry。已發布檔案保留原內容,修改設定另建新 revision。

歷史定義需要的模組、欄位類別與被引用表單,都須在這組快照中可解析,即使環境裡已存在也要列入前置。執行前會檢查可攜性、引用、循環與安裝順序;缺少的前置不拿目前 registry 補齊。被引用的定義用 `requiresSeeds` 排在使用它的定義之前。

有設定依賴的 migration 依序檢查是否有待轉換資料、依賴是否可安裝,再安裝缺少的精確快照、轉換資料與驗證結果。沒有待轉換資料時仍需驗證,但不安裝歷史設定。這讓舊環境可經中間版本完成資料轉換,空庫則只建立目前仍登記的目標。

有 `seedDependencies` 的檔案須同時提供以下檢查,不另維護一份 migration 清單:

| 函式                                    | 責任                                                              |
| --------------------------------------- | ----------------------------------------------------------------- |
| `appliesTo(db)`                         | 判斷是否有待轉換的資料,不是只判斷整庫是否為空                     |
| `assertSeedInstallable(db, inspection)` | 明確驗證允許的來源內容或不存在條件;不以 revision 字串大小推測版本 |
| `up(db, client, context)`               | 可重入的資料轉換,使用 context 內已解析的定義 ID 與本地版號        |
| `verify(db, context)`                   | 核對資料後置條件;不符合就拋錯,不得把未完成的轉換算成成功          |

無設定依賴者沿用 `up(db, client)`。Context 的型別見 `apps/db-migrator/src/update/journal.ts`;既有提交升版 API 的適用範圍不變,跨租戶或其他業務轉換須由該 migration 明訂資料範圍、歷史保留、筆數及重跑判準。

`seed_update_runs` 保存執行階段、來源 hash、依賴檢查點與已解析的本地版本。中斷後沿原 context 接續,不重新用「目前沒有舊資料」跳過未完成的轉換。驗證通過才由 migrate-mongo 寫入 `changelog`;所有 migration 完成後,才套用目前 registry。安裝紀錄與執行紀錄各司其職,兩者都不取代 repo 的設定來源。

`update`、`seed`、`migrate` 使用同一個完整入口。`migrate:down` 只執行選定 migration 的 `down`,不回滾 seed、定義或安裝紀錄;執行與還原都受共同互斥鎖及續跑紀錄管理。

互斥鎖位於 `changelog_lock`,涵蓋整次工具操作。API CLI 只核對外層持有者,不另搶鎖;硬中止留下的鎖不依時間自動接管。操作者確認原程序已停止後,才可指名 owner 解鎖。這把鎖不阻擋線上使用者操作,破壞性資料轉換仍須明訂相容窗口、必要停寫與恢復方式。

正本:`apps/db-migrator/src/update/`;執行、續跑與解鎖步驟見 [deployment](../deployment.md)。

### 還原

| reset 模式 | 保留與清除                                                                                              | 後續動作                                         |
| ---------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `data`     | 保留當前 registry 的種子與受管定義歷史、動態權限、有效安裝紀錄及執行歷史;清除草稿、未受管定義與業務資料 | 執行同一版本的 update,根組織與模組初始值保留現值 |
| `full`     | 除操作鎖外,清除全部應用 collection 與索引                                                               | 重新規劃並執行 update,初始值依專案宣告重建       |

受管範圍依當前 registry 判定;已移除宣告的定義、自建與租戶客製/fork 不在 data 保留範圍。受管定義的已發布/已退役版本連同動態權限 ID、退役狀態及有效安裝映射保留;租戶分派、綁定與案件清除。普通設定種子的識別鍵與初始值政策沿用原宣告;示範業務資料整表清除後依宣告補回。

data 遇到未完成 migration、回滾或任何中斷發布時,在刪除前拒絕。先續完原 update 或 UI 發布,再明確重置;預檢不自動發布半成品。full 可清除中斷狀態,依目前版本重建。

三個環境都須明示環境、模式與實際資料庫名並通過確認。預檢、刪除與 update 共用同一把鎖;失敗會保留階段與結果,不標成成功。用法與失敗處理見 [deployment](../deployment.md#資料庫還原reset)。

正本:`apps/db-migrator/src/seed/seed-runner.ts`、`apps/db-migrator/seeds/registry.ts`、`apps/db-migrator/src/reset/reset-plan.ts`、`apps/db-migrator/src/reset/reset-safety.ts`、`apps/db-migrator/src/migration-filename.ts`
