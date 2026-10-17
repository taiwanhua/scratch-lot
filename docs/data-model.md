# 資料模型地圖

底座與專案 collection 的**總覽與導航**。欄位、型別、索引的細節**正本在程式碼**:底座 schema 位於 `apps/api/src/database/schemas/`,專案 schema 與 repository 位於 `apps/api/src/project/database/`。此檔不重複欄位定義,只給地圖與跨檔約定;各表怎麼運作看「概念」欄指向的文件。

## Collection 一覽

下表列底座資料,「schema 檔」相對於 `apps/api/src/database/schemas/`。專案資料另列於下一節。「概念」欄指向 `docs/concepts/` 的檔(省略目錄):帳號 = `accounts-and-tenants.md`、授權 = `authorization.md`、資料層 = `data-layer-and-isolation.md`、表單 = `form-engine.md`、流程 = `workflow-engine.md`。

| collection                          | 種子 / 業務                                              | 用途                                                                                                     | 概念           | schema 檔                         |
| ----------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------- |
| `orgs`                              | 業務(根組織為種子)                                       | 組織樹;資料隔離邊界;租戶頂層另有短碼 `slug`、擁有者 `ownerUserId`、時區 `settings.timezone`(根組織也有)  | 帳號、資料層   | `org.schema.ts`                   |
| `users`                             | 業務                                                     | 後台使用者帳號                                                                                           | 帳號           | `user.schema.ts`                  |
| `customers`                         | 業務                                                     | 前台會員帳號                                                                                             | 帳號           | `customer.schema.ts`              |
| `roles`                             | 業務(種子角色除外)                                       | 角色(權限集合);租戶副本以 `settings.templateKey` 標記來源                                                | 授權、帳號     | `role.schema.ts`                  |
| `modules`                           | 種子                                                     | 模組樹(= 頁面 / 側欄);`engine` 標固定欄位模組 / 表單模組                                                 | 授權           | `module.schema.ts`                |
| `permissions`                       | 設定(`source: seed` 為模組宣告,`dynamic` 為表單發布產生) | 權限(頁面裡的按鈕 / 欄位)                                                                                | 授權           | `permission.schema.ts`            |
| `core_relationships`                | 業務(種子亦寫入:種子角色的 `org_role`、模板綁定)         | 底座實體的關聯:`org_user` / `org_role` / `user_role` / `role_module` / `role_permission` + `org_manager` | 資料層         | `core-relationship.schema.ts`     |
| `business_relationships`            | 業務                                                     | 業務關聯:`org_form`(表單分派 / 啟用)、`org_workflow`(流程分派)、`org_form_workflow`(流程綁定)            | 資料層         | `business-relationship.schema.ts` |
| `data_scope_rules`                  | 業務                                                     | 資料範圍規則(一個資料目標至多一份)                                                                       | 資料層         | `data-scope-rule.schema.ts`       |
| `data_scope_targets`                | 種子                                                     | 資料目標(「資料範圍」頁左側清單;一列 = 一個模組在一張表上的資料)                                         | 資料層         | `data-scope-target.schema.ts`     |
| `field_categories`                  | 種子(系統類別)+ root 在畫面建                            | 欄位類別(全域)                                                                                           | 資料層         | `field-category.schema.ts`        |
| `fields`                            | 種子(全域)+ 業務(租戶自訂)                               | 欄位選項                                                                                                 | 資料層         | `field.schema.ts`                 |
| `refresh_tokens`                    | 業務                                                     | 登入 refresh token(存雜湊)                                                                               | 帳號           | `refresh-token.schema.ts`         |
| `action_tokens`                     | 業務                                                     | 啟用信 / 重設密碼 token(單次、TTL)                                                                       | 帳號           | `action-token.schema.ts`          |
| `audit_logs`                        | 業務                                                     | 稽核日誌(只增不改)                                                                                       | 授權           | `audit-log.schema.ts`             |
| `user_preferences`                  | 業務                                                     | 個人偏好(每個使用者一筆 `{ userId, settings: { <key>: 值 } }`,跟著帳號);key 須登記                       | 帳號           | `user-preference.schema.ts`       |
| `notifications`                     | 業務                                                     | 通知(一位收件人一筆;`(recipientId, dedupeKey)` 唯一;`createdAt` 90 天 TTL)                               | 流程           | `notification.schema.ts`          |
| `notification_settings`             | 業務                                                     | 通知設定(租戶對負責人提醒類型的收件人調整;`(tenantId, type)` 唯一)                                       | 流程           | `notification-setting.schema.ts`  |
| `demo_items_one` / `demo_items_two` | 種子(宣告的幾筆)+ 業務                                   | 示範模組資料(模組資料表)                                                                                 | 各自的模組文件 | `demo-item-*.schema.ts`           |
| `forms`                             | 設定(受管 seed 或各環境自建)                             | 表單(一種填報的身分;共用 `ownerOrgId = null`、客製 = 租戶頂層)                                           | 表單           | `form.schema.ts`                  |
| `form_versions`                     | 設定(受管 seed 或各環境自建)                             | 表單版本(草稿 / 發布中 / 已發布 / 已退役;欄位、版面、摘要槽、帶入規則)                                   | 表單           | `form-version.schema.ts`          |
| `form_submissions`                  | 業務                                                     | 表單提交(所有表單模組共用的模組資料表;值、摘要、修訂快照、流程狀態)                                      | 表單、流程     | `form-submission.schema.ts`       |
| `workflows`                         | 設定(受管 seed 或各環境自建)                             | 審核流程(共用 `ownerOrgId = tenantId = null`、客製 = 租戶頂層)                                           | 流程           | `workflow.schema.ts`              |
| `workflow_versions`                 | 設定(受管 seed 或各環境自建)                             | 流程版本(生命週期同表單版本;`steps[]` 節點 + `edges[]` 連線)                                             | 流程           | `workflow-version.schema.ts`      |
| `workflow_instances`                | 業務                                                     | 流程實例(一筆提交的一個修訂號送出一次;**唯一權威**:關卡狀態、派任計畫、已接受的決定)                     | 流程           | `workflow-instance.schema.ts`     |
| `workflow_tasks`                    | 業務                                                     | 審核任務(實例派任計畫一項的投影;「待我審核」與讀取授權用)                                                | 流程           | `workflow-task.schema.ts`         |
| `print_agents`                      | 業務                                                     | 店內代理程式(分店的列印程式;金鑰與配對碼只存雜湊、`lastSeenAt` 判斷離線)                                 | 列印           | `print-agent.schema.ts`           |
| `printers`                          | 業務                                                     | 收據機(只記到分店層;連線位址、分店預設、代理程式回報的狀態)                                              | 列印           | `printer.schema.ts`               |
| `print_jobs`                        | 業務                                                     | 列印工作(單據的黑白 PNG 快照、狀態、補印原因與第幾次)                                                    | 列印           | `print-job.schema.ts`             |

共用表單與流程可由專案 seed 管理;未登記的共用定義及租戶客製定義仍在各環境獨立維護。它們共用原本的身分與版本 collection,不另複製一份設定表。

### 設定執行紀錄

| collection                      | 用途                                                                   | 存取正本                                                           |
| ------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `seed_definition_installations` | 將宣告的 revision 映射至本環境的定義 ID、版號,並保存中斷續跑所需的狀態 | `seed-definition-installation.schema.ts`、`apps/api/src/seed/`     |
| `seed_update_runs`              | 設定執行的 commit、計畫、階段、結果,以及 migration 的依賴與續跑紀錄    | `apps/db-migrator/src/update/journal.ts`                           |
| `changelog`                     | migrate-mongo 的遷移紀錄,以檔名識別已執行的 migration                  | `apps/db-migrator/migrate-mongo-config.js`                         |
| `changelog_lock`                | 設定更新的共用互斥鎖;API CLI 只核對持有者                              | `seed-lock.schema.ts`、`apps/api/src/database/seed-lock.reader.ts` |

安裝紀錄是映射與續跑依據,不取代 repo 的設定正本。受管範圍由當前 registry 決定;歷史紀錄存在,不代表可以覆蓋現場定義。版本內容仍由表單與流程的設計服務發布,不經普通 documents seed 寫入。

### 排程任務執行紀錄

| collection           | 用途                                                                                                                                                                                | 存取正本                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `scheduled_job_runs` | 排程工作每個到期時點一筆:`key`、`scheduledFor`、`status`(`running` / `succeeded` / `failed`)、`startedAt`、`finishedAt`、`error`。唯一 `(key, scheduledFor)` 保證同一時點只執行一次 | `scheduled-job-run.schema.ts`、`apps/api/src/database/scheduled-job-runs.store.ts` |

執行紀錄是系統紀錄:沒有操作者與組織歸屬,不掛基礎欄位與租戶 plugin,只經專用 store 讀寫。先插入 `running` 才執行 handler,插入撞到唯一索引就表示這個時點已有人跑過或正在跑;失敗的時點不重跑;中途當掉的紀錄停在 `running`,`startedAt` 超過 15 分鐘後以條件式原子更新重新取得。紀錄不自動清除。排程機制見 `docs/deployment.md`「Cloud Scheduler」。

### 列印

`print_agents`、`printers`、`print_jobs` 是印表機管理模組(`system.printers`)的模組資料表(`moduleData`,`moduleKey` 固定 `system.printers`),都掛在**分店**(`orgId`)上;印表機的分店 = 它的代理程式的分店,工作的分店 = 印表機的分店。

| collection     | 欄位                                                                                                                                                                                                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `print_agents` | `orgId`、`name`、`keyHash`(長期金鑰的 SHA-256;沒配對 / 已撤銷為 null)、`pairingCodeHash` + `pairingExpiresAt`(等待中的 8 碼配對碼,10 分鐘,用過即清)、`lastSeenAt`(超過 2 分鐘 = 離線)、`version`、`enabled`;`keyHash`、`pairingCodeHash` 各自唯一(只索引有值的)                                                              |
| `printers`     | `orgId`、`agentId`、`name`、`host`、`port`(預設 9100)、`paperWidth`(58)、`isDefault`(同分店至多一台)、`enabled`、`status`(`ok` / `paper-out` / `offline`,代理程式回報)、`statusAt`                                                                                                                                           |
| `print_jobs`   | `orgId`、`printerId`、`agentId`(建立時的代理程式快照)、`documentType`、`refType` + `refId`(單據)、`documentName`(單據顯示名稱,通知用)、`image`(PNG,預設查詢不帶)、`status`(`pending` / `sent` / `printed` / `failed`)、`error`、`isReprint`、`printNo`、`reprintReason`、`reprintNote`、`requestedBy`、`sentAt`、`printedAt` |

狀態轉換只用條件更新:認領 `pending → sent`(且 2 分鐘內)、回報 `sent → printed / failed`(且 2 分鐘內)、等待中逾時 `pending → failed`(`agent-offline`)、已送出逾時 `sent → failed`(`no-result`)、停用 `pending / sent → failed`(`agent-disabled`,已送出的也一起標失敗);同時到的兩個請求只有一個命中。規則與 API 見 `docs/modules/printers.md`。

### 個人偏好

`user_preferences` 只存跟著帳號的個人偏好(規格 10.6),每個使用者一筆、只能讀寫自己的(`myPreferences` / `updateMyPreferences`,不看模組權限)。`settings` 只收**登記過**的 key:底座登記在 `apps/api/src/user-preferences/user-preference-registry.ts` 的 `BASE_USER_PREFERENCES`(目前是語言 `locale`,預設 `null` = 沒有設定),專案登記在 `apps/api/src/project/user-preferences.ts`,由 `app.module.ts` 合成;每筆宣告 key、型別(字串 / 布林 / 數字)與預設值。未登記的 key 或值不合型別整筆拒寫(`VALIDATION_FAILED`,`extensions.reason` = `UNKNOWN_KEY` / `INVALID_VALUE`);值 `null` = 拿掉、回到預設。讀取時每個登記的 key 都有值,已不再登記的舊 key 不回。

跟著裝置的設定(外觀、側欄收合、區塊收合)不進這張表,存瀏覽器。顯示密度不做(規格第 11 章 B 類),沒有對應的偏好。

每種通知類型 × 每個管道另有一個布林開關,key 是 `notification_<類型 key 的 . 換成 _>_<管道>`(例 `notification_workflow_task-created_in-app`),由通知類型登記推導、不必手寫;不能關的管道只收 `true`(`allowedValues`)。規則見 `docs/modules/notification-settings.md`「個人偏好的管道開關」。

### 通知

`notifications` 是收件人自己的資料(依 `recipientId` 讀寫、與目前組織無關,不掛 tenantScope),由 `notify()` 在觸發它的動作的同一個交易裡寫入;`(recipientId, dedupeKey)` 唯一防重複通知,`createdAt` 90 天後由 TTL 刪除。`channels` 記這則送出的管道,通知清單與未讀數只算含 `in-app` 的。`notification_settings` 是以 `tenantId` 為邊界的租戶設定:沒有資料或 `audience = null` 就用通知類型宣告的預設人員條件。兩張都不擋刪組織。細節見 `docs/modules/notification-settings.md`。

## 專案資料

底座的 `apps/api/src/project/database/registrations.ts` 預設沒有業務資料登記。引用專案在該目錄維護 schema、repository 與組織資料檢查,規則見[資料層組裝](concepts/data-layer-and-isolation.md#底座與專案資料的組裝)。

## 底座與一般專案資料的共同約定

- **基礎欄位**:`createdAt` `updatedAt` `createdBy` `updatedBy` `deletedAt`(軟刪除)。五個欄位都由 `baseFieldsPlugin` 掛上與自動填:`createdBy` / `updatedBy` / `deletedAt` 由 plugin 加;timestamps 沿用 schema 自己宣告的 `timestamps: true`,沒宣告時由 plugin 補上。
- **租戶過濾**:租戶資料(有 `orgId`、掛 `tenantScopePlugin`)的查詢一律經 BaseRepository 自動過濾,禁裸 `Model.find`。哪些表屬租戶資料 / 全域資料 / 關聯歸屬資料,見 `docs/concepts/data-layer-and-isolation.md`「三類資料」。
- **模組資料表**(schema 明確開 `tenantScopePlugin({ moduleData: true })`:`demo_items_one`、`demo_items_two`、`form_submissions`、`workflow_instances`、`print_agents`、`printers`、`print_jobs`)另有兩欄,由 plugin 一併宣告並建索引 `(tenantId, moduleKey, createdAt)`、`(moduleKey, orgId)`:`moduleKey`(必填,這筆屬於哪個模組;固定欄位模組寫死自己的 key)與 `tenantId`(租戶頂層 `orgs` id,`BaseRepository.create` 依 `orgId` 的祖先推導,根組織的資料為 null,呼叫端給的值一律覆蓋;兩欄建立後不可經一般更新改動)。`tenantId` 只用於租戶邊界、索引與日後分片,**不決定可見範圍**(仍看 `orgId`)。這個選項不綁 `kind: "business"`:`fields`、`audit_logs`、`customers` 也是租戶資料,但不是模組資料,沒有這兩欄。
- **以 `tenantId` 為邊界、不掛 `tenantScopePlugin` 的表**:`business_relationships`、`workflows`、`workflow_tasks`。這些表沒有 `orgId`,而讀者不一定在資料所屬組織的可見範圍內(部門使用者的可見範圍不含租戶頂層;審核者不一定看得到申請人的組織);存取只經各自的 repository(`BusinessRelationshipsRepository` / `WorkflowsRepository` / `WorkflowTasksRepository`),每個方法強制帶 `tenantId`,沒給就拋錯。
- **種子 vs 業務**:種子由 seed 以 key 冪等 upsert(`apps/db-migrator/seeds/`);業務資料不做跨環境搬移。
- **索引**:各 schema 檔以 `.index(...)` 就地宣告(唯一鍵、orgId 複合、ancestors、TTL 等)。
- **資料登記**:底座與專案分別在 `apps/api/src/database/base/registrations.ts`、`apps/api/src/project/database/registrations.ts` 宣告,由 DatabaseModule 合成 model 與受控 repository 出口。一般新增專案 model 必須連結同登記內的 repository 與 `orgId` 存在檢查,供刪組織及撤銷開通共用;不在 OrgsService 另加清單。驗證規則與安裝順序見[資料層概念](concepts/data-layer-and-isolation.md#底座與專案資料的組裝)。

## 跨檔約定(語意正本不在 schema 的幾處)

### 底座

- **`modules` 執行期可改的欄位**(`module.schema.ts`):`enabled`(停用 / 啟用,連動子樹)、`icon`(側欄圖示 key)與 `settings`(表單模組的列表欄位配置)是**初始 seed 值的欄位** —— seed 只在建立時、或既有文件**沒有這一欄**時寫初值,有值就不覆蓋(`docs/concepts/data-layer-and-isolation.md`「種子資料與遷移」)。`icon` 的白名單正本是 `@repo/domain/module-icon` 的 `MODULE_ICON_KEYS`(schema 刻意不寫成 mongoose `enum` 以免抄成第二份),`null` = 側欄用預設圖示;規則見 `docs/modules/module-manager.md`。表單模組的 `settings.list` 是列表欄位配置,由 root 在畫面寫(見 `docs/modules/forms.md`「列表欄位配置」)。
- **`modules.engine`**:`fixed`(固定欄位模組,預設)/ `form`(表單模組);由 seed 宣告,每次 seed 都同步宣告值,不在系統內改。
- **`modules.perFormCreate`**:表單模組依表單分開新增權限(B9b;預設 `false`);由 seed 宣告(`formModuleDeclaration` 的 `perFormCreate`),每次 seed 都同步宣告值,不在系統內改。見[授權](concepts/authorization.md#依表單分開新增權限b9b)。
- **`permissions.source`**:`seed` = 模組 seed 宣告、`dynamic` = 執行期產生(表單發布建的欄位級權限,key `<moduleKey>.show-<formKey>-<fieldKey>` / `edit-…`)。seed runner 只比對 / 更新 `source` 不是 `dynamic` 的文件,不刪不認識的;`retiredAt` 是 `dynamic` 權限退役時間(`null` = 使用中),退役的只由「模組與權限」頁的清理硬刪(連同 `role_permission` 綁定)。
- **`core_relationships`**(`core-relationship.schema.ts`,ADR-0001):單一 collection 裝底座實體的關聯,`type` 是封閉 enum,命名順序 Org > User > Role > Module > Permission 決定 `firstId` / `secondId`;唯一 `(type, firstId, secondId, thirdId)`,`org_role` 另在角色側唯一(一個角色只屬一個擁有組織)。存取只經 `RelationService`,不掛租戶過濾。`org_manager` 是命名規約的例外:`firstId` = 組織、`secondId` = 使用者,語意是「主管」而不是成員(主管不必是該組織的直接成員,但必須是本租戶的使用者),一個組織多筆 = 多位主管;規則見 `docs/modules/org-manager.md`(主管與主管解析)。
- **`orgs.slug`**:只有租戶頂層有;格式 `^[a-z][a-z0-9_]{1,19}$`(正本 `@repo/domain/form-keys` 的 `ORG_SLUG_PATTERN`)、唯一稀疏索引;開通時填,根組織可在組織編輯改。
- **`orgs.settings.timezone`**:時區(IANA 名稱),只有根組織與租戶頂層有;沒設或不是 `Intl` 認得的名稱時,讀取端退回 `Asia/Taipei`(`apps/api/src/database/tenant-timezone.ts`)。在組織管理的編輯彈窗設定,清除 = 拿掉這個鍵。租戶頂層的套用整個租戶,根組織的套用根組織與它自己的資料。
- **`field_categories`**:全域、不掛租戶過濾。`isSystem = true` 是 seed 宣告的系統類別(不可停用);`false` 是 root 在畫面建的。seed 宣告同一個 key 時**認養**畫面建的那一筆(`isSystem` 改 true、名稱 / 說明以 seed 為準、`_id` 不動)。`enabled` 是初始 seed 值的欄位;停用只讓類別從表單設計器的類別清單消失,既有欄位用到它照常顯示與取選項。類別不可刪。見 `docs/modules/field-manager.md`。
- **`fields` 的唯一索引是 `(categoryId, orgId, value)`**:全域種子那筆 `orgId = null`,所以「自訂選項與**同類別的全域選項**同 `value`」索引擋不到,由 service 的表單驗證擋(同回 `FIELD_VALUE_DUPLICATE`)。規則與種子內容的正本:`docs/modules/field-manager.md`。
- **`data_scope_targets` / `data_scope_rules` 的識別鍵是 `(collection, moduleKey)`**(兩張表各一個唯一索引):同一張表可以有多個模組各一個目標、各一份規則(所有表單模組共用 `form_submissions`)。目標由 seed 依模組宣告登記,`moduleKey` 由 seed runner 填宣告檔所在的模組。`rules[]` 的形狀(`audience` + `filter` 條件樹)正本在 `docs/modules/data-scope.md`,schema 只把 `filter` 存成自由 JSON。
- **`demo_items_one` 的附件是四個平行欄位**:`attachmentPath` + `attachmentName` / `attachmentSize` / `attachmentContentType`,**四欄同生同滅**(換檔一起 `$set`、清空一起 `$unset`);只有 `attachmentPath` 的資料,api 對後三者回 `null`。選平行欄位而非巢狀物件,是為了不搬既有資料。對外形狀見 `docs/modules/demo.sub.sample-one.md`「api 介面」。

### 業務關聯

- **`business_relationships`**:`type` 是封閉 enum,`tenantId` = `firstId` = 租戶頂層:`org_form`(`secondId` = 表單、`meta = { enabled }`)、`org_workflow`(`secondId` = 流程)、`org_form_workflow`(三方:`secondId` = 表單、`thirdId` = 流程;沒有這筆 = 不走流程、換流程 = 改 `thirdId`)。唯一索引 `(tenantId, type, firstId, secondId)`:同租戶同表單最多綁一個流程,`thirdId` 不在鍵裡,所以多張表單可以綁同一個流程。

### 表單

細節見 `docs/modules/forms.md`。

- **`forms` / `form_versions` 不掛租戶過濾**:表單沒有 `orgId`,誰看得到哪一張由 `forms.ownerOrgId` + `org_form` 決定(`apps/api/src/forms/form-access.service.ts`),版本跟著表單走。`forms.key` 全域唯一、建立後不可改;`currentVersion` 是填寫者唯一看的指標。
- **`form_versions`**:兩條部分唯一索引 —— `(formKey, version)` 只在 `version` 是數字時唯一(草稿的 `null` 不算,正式版號在發布時配);`(formKey, status)` 限 `draft` 與 `publishing` 各一筆。定義四塊(`fields` / `layout` / `summaryMap` / `prefills`)存自由 JSON,形狀正本是 `@repo/domain/form` 的 `types.ts`。草稿刪除是**硬刪**(ADR-0007 的例外:軟刪的草稿會佔住部分唯一索引,讓這張表單永遠開不了新草稿;刪掉的定義留在稽核)。
- **`form_submissions` 的值**:`values` 依欄位型別存,受保護欄位原值照存、讀取時投影為 `"[redacted]"`;`date` / `datetime` 與 `summary.date` 存 Mongo `Date`(兩者都是時點,`date` = 選的那天在租戶時區 00:00),GraphQL 回 ISO 字串。明細列(`array`)欄存列的陣列 `[{ rowId, <子欄 key>: 值 }]`:`rowId` 是前端建列時產生的 UUID(同一明細內唯一、修訂之間不變),陣列順序就是列的順序。
- **`form_submissions` 的修訂**:`revisions[]` 每筆 `{ revision, version, values, ctx: { at, timezone, userId, orgId }, kind?, upgradedBy?, upgradedAt? }` 是**完整值快照**。`version` = 這一筆修訂綁的表單版本(讀取一律 `revisions[r].version ?? version`);提交本身的 `version` 只有舊版資料升級會改綁。`kind: "upgrade"` = 舊版資料升級產生的修訂,`ctx` 沿用上一筆,誰與何時升級記在 `upgradedBy` / `upgradedAt`。`editVersion` 是每次寫入的樂觀鎖;`(createdBy, clientRequestId)` 唯一(含已軟刪除的);`touched[]` 是使用者碰過的欄位 key(只對草稿有意義)。容量上限見 `docs/modules/forms.md`「提交的寫入規則」。
- **`form_submissions` 的流程欄位**:`status` 七值(正本 `@repo/domain/workflow` 的 `SUBMISSION_STATUSES`);`currentInstanceId` 為 null = 沒走過流程(`completed` 後可修改),有值 = 走過(`completed` 後鎖定、只能作廢);`blocked` = 實例被阻擋;`voidedAt` / `voidedBy` / `voidReason` / `replacedById` 是作廢資訊;`copiedFrom` = 「複製為新單」的來源。

### 流程

細節見 `docs/modules/workflows.md`。

- **`workflows`**:`tenantId` = `ownerOrgId`,共用流程是 `null` —— 查共用要**明給 `null`**,沒給(`undefined`)一律拋錯。`key` 全域唯一、建立後不可改。
- **`workflow_versions`**:與 `form_versions` 同一套部分唯一索引,草稿刪除同樣硬刪;`steps[]` / `edges[]` 存自由 JSON,形狀正本是 `@repo/domain/workflow` 的 `StepDef` / `WorkflowEdge`(沒有 `edges` = 直線,依 `steps[]` 順序);`checkFormKey` 是設計器的「檢查用表單」,只影響設計時的檢查。
- **`workflow_instances` 是唯一權威**:建立時就為版本的每個節點各建一筆 `pending` 的 `StepState`,之後只改欄位、不增刪元素(推進的條件更新對 `steps` 陣列元素下條件,元素不存在就永遠不成立);`editVersion` 是 CAS 用;`summary` 是該修訂的摘要槽快照(任務列表 / 通知讀它,`summary.date` 同樣存 `Date`)。唯一 `(submissionId, revision)`;模組資料表的欄位抄自提交,資料範圍規則不套(沒有宣告資料目標)。
- **`workflow_tasks`**:實例派任計畫一項的投影,狀態由推進依實例同步;唯一 `(instanceId, taskKey)`,另有 `(assigneeId, status)`、`(tenantId, moduleKey, status)`、`(previousAssigneeIds)` 索引。

## 種子清單

普通種子包含 modules、permissions(`source: seed`)、field_categories(系統類別)、fields(全域)、種子 roles(超級管理員、租戶管理員模板)與其綁定、根組織、root 初始帳號、data_scope_targets 及示範資料。共用表單與流程須明確登記為受管定義,沿版本生命週期交付;發布產生的動態權限不以普通 documents 宣告。

宣告正本是 `apps/db-migrator/seeds/registry.ts`;來源分區與寫入規則見[種子資料與遷移](concepts/data-layer-and-isolation.md#種子資料與遷移),各模組的權限表見 `docs/modules/`。

## 預留(尚未建,程式碼無)

### `auth_identities`(第三方登入綁定;會員線開發時啟用)

| 欄位           | 型別                    | 備註                                                 |
| -------------- | ----------------------- | ---------------------------------------------------- |
| accountType    | enum:`user`\|`customer` | 固定從屬:指向哪張帳號表                              |
| accountId      | ObjectId                | = 該帳號文件的 `_id`(主鍵),**不是** account 登入欄位 |
| provider       | enum(如 `google`)       | `password` 不進此表(密碼留帳號表 passwordHash)       |
| providerUserId | string                  | 第三方使用者識別(Google=`sub`)                       |
| email          | string?                 | 第三方回傳,綁定比對輔助,不作登入識別                 |
| meta           | object?                 | 顯示名、頭像 URL 等                                  |

索引:unique(provider, providerUserId)/ unique(accountType, accountId, provider)/(accountType, accountId)。不掛 orgId、不進租戶過濾(帳號為平台級)。決策見 ADR-0003。

### `oauth_clients` + scope 目錄

第一個串接方出現時隨 node-oidc-provider 建(ADR-0006)。
