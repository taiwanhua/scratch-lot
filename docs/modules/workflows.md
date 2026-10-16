# 審核流程與申請中心(技術)

審核流程的 api 與 admin 落地:流程設計、引擎、申請中心。概念(流程 / 版本 / 分派 / 綁定、送出時檢查、實例是唯一權威、阻擋、讀取授權)先讀 `docs/concepts/workflow-engine.md`;本文件寫實作怎麼做、選了哪些做法與為什麼。表單側(存草稿、送出的驗證與重算、修訂、容量上限、舊版資料升級)見 `docs/modules/forms.md`。

| 部分     | 位置                                                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 流程設計 | `apps/api/src/workflows/workflow-design/`:流程、版本、四步發布、分派 / fork、表單綁定                                                                                 |
| 引擎     | `apps/api/src/workflows/workflow-engine/`:送出的寫入順序、`advance` 的執行器、決定 / 撤回 / 改派 / 新增審核者 / 重試推進、審核者失效 hook、讀取授權、通知信、阻擋清單 |
| 申請中心 | `apps/api/src/workflows/apply-center/`:我的申請 / 待我審核 / 新申請 / 計數 / 實例詳情 / 決定                                                                          |
| 共用判準 | `apps/api/src/workflows/` 根目錄(`workflow-access.service.ts`、`workflow-keys.ts`、`workflows-error.ts`…)                                                             |
| 純邏輯   | `@repo/domain/workflow`:定義的形狀、檢查器、送出時檢查、主管解析、`advance` 判斷表(`packages/domain/README.md`)                                                       |

## 用途

- 一張表單可以**綁流程**:送出後依關卡找審核者、產生任務、核准 / 駁回 / 退回,核准才 `completed`。沒綁流程的表單送出即完成。
- 流程可在畫面設計、發布及分派。登記為 seed 的共用流程隨專案版本交付,沿用同一套發布服務;未登記與租戶客製流程獨立維護。分派與表單綁定仍由各環境操作,綁流程的示範對象見 [demo-form](./demo-form.md)。受管邊界與衝突處理見[受管表單與流程](../concepts/data-layer-and-isolation.md#受管表單與流程)。
- 引擎原則:**實例是唯一權威**(關卡進度、派任計畫、被接受的決定都在實例文件上,任務只是投影);每個寫入都是條件更新;**每個使用者動作是一個 Mongo 交易**(ADR-0013;推進併在觸發它的動作裡),任一步失敗全部回復。

## 模組 key 與權限表

| 權限 key                                 | moduleId 指向 | 它是哪一頁的什麼                                                                                                         |
| ---------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `system.workflows.view`                  | 流程管理      | 流程清單、流程、版本、檢查器(`validateWorkflowVersion`)                                                                  |
| `system.workflows.create`                | 流程管理      | 建流程(根組織 = 共用、租戶內 = 客製)、以某版為基底建流程(fork)                                                           |
| `system.workflows.edit`                  | 流程管理      | 改名稱、開草稿、存草稿、刪草稿(只能動自己擁有的流程)                                                                     |
| `system.workflows.publish`               | 流程管理      | 發布、退役目前版本                                                                                                       |
| `system.workflows.assign`                | 流程管理      | 分派 / 收回共用流程(另外要站在根組織)                                                                                    |
| `system.workflows.blocked-page.reassign` | 阻擋清單      | 阻擋清單查詢、改派、新增審核者、重試推進(隱藏頁自有權限,不靠父模組 wildcard)                                             |
| `system.forms.edit`                      | 表單管理      | 表單的流程綁定 / 解除、流程下拉(`formWorkflowOptions`)—— 綁定掛在表單管理上                                              |
| `apply-center.view`                      | 申請中心      | 我的申請、待我審核、新申請入口、badge 計數                                                                               |
| (無)                                     | —             | `workflowInstance` / `decideTask` / 撤回 / 作廢 / 複製:授權是「讀得到那個修訂」「我是承辦人」「我是申請人」,不看頁面權限 |

申請中心另有隱藏頁 `apply-center.view-page`(詳情頁的路由節點兼權限容器),沒有自己的權限。

正本:`apps/db-migrator/seeds/base/modules/system.ts`、`apps/db-migrator/seeds/base/modules/apply-center.ts`、`apps/api/src/workflows/workflow-keys.ts`

## 資料

`workflows`、`workflow_versions`、`workflow_instances`、`workflow_tasks` 四張表(欄位與索引見 `docs/data-model.md` 與各 schema 檔),加上 `business_relationships` 的 `org_workflow`(分派)/ `org_form_workflow`(綁定)、`core_relationships` 的 `org_manager`(主管)、`form_submissions` 的審核欄位(`currentInstanceId`、`blocked`、`voidedAt` / `voidedBy` / `voidReason`、`replacedById`、`copiedFrom`)。

- `workflows` / `workflow_tasks` 以 `tenantId` 為邊界(`WorkflowsRepository` / `WorkflowTasksRepository`,沒給拋錯)。
- `workflow_instances` 是模組資料表(掛 `moduleData`),引擎一律以**系統上下文 + 明確的 `tenantId` / id 條件**讀寫(資料範圍規則對它不套);審核者的讀取走 `canReadSubmissionRevision`。
- 引擎對 `form_submissions` 的讀寫走 `database/workflow-submission-store.ts`(原生 collection、每個方法強制 `tenantId`):審核者與背景推進不在申請人組織的可見範圍內,而資料範圍規則可以對「全部操作者」生效,經 `FormSubmissionsRepository` 會把系統讀取也收窄。寫入只有引擎的條件同步(「提交仍指向本實例 + 修訂號相符 + 審核中」)。

## 狀態機

三組狀態各自一個欄位;**實例是權威**,提交與任務的狀態都由推進依實例同步。判斷表的單一正本是 `@repo/domain/workflow` 的 `advance.ts`(下文的「列 N」指它的列號),本節只列狀態與誰讓它轉。狀態對申請人的意思見 `docs/concepts/workflow-engine.md`「提交的七個狀態」。

### 提交(`form_submissions.status`,七值)

| 狀態        | 轉到                                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `draft`     | 送出 → `reviewing`(綁流程)/ `completed`(不綁);刪除                                                                           |
| `reviewing` | 內容凍結;推進收尾:實例 `approved` → `completed`、`rejected` → `rejected`、`returned` → `returned`、`withdrawn` → `withdrawn` |
| `returned`  | 申請人改內容(`saveFormDraft`,狀態不變)再送出 → `reviewing`(修訂 +1、新實例);申請人本人刪除                                   |
| `withdrawn` | 同 `returned`                                                                                                                |
| `completed` | 走過流程(鎖定)→ 作廢 → `voided`;沒走過流程 → 修改(修訂 +1)/ 刪除                                                             |
| `rejected`  | 不可改、不可再送;刪除(模組 `delete`)                                                                                         |
| `voided`    | 內容凍結;複製為新單(建新的 `draft`,來源記 `replacedById`,只能複製一次)                                                       |

提交同步只在「提交仍指向本實例、修訂號相符、狀態是 `reviewing`」時寫(被取代 / 已作廢的提交不會被已取代的實例改回)。`blocked` 旗標跟著實例的 `blocked` 走(列 5 / 8 / 8b)。

### 實例(`workflow_instances.status`,七值)

| 狀態         | 意思                                            | 轉到(誰)                                                                                                                                    |
| ------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `running`    | 進行中                                          | 關卡阻擋 → `blocked`;全案核准三條件成立 → `approved`(與最後節點完成同一次 CAS);有效駁回 / 退回 → `rejected` / `returned`;撤回 → `withdrawn` |
| `blocked`    | 進行中,至少一個 active 關卡阻擋(其他關卡照常審) | 可解除(列 8)→ `running`;其餘同 `running`                                                                                                    |
| `approved`   | 全案核准(終局)                                  | 推進收尾(列 2):任務投影、提交 `completed`、`finishedAt`、結果信                                                                             |
| `rejected`   | 全案駁回(終局;`outcome` 記採用的那筆決定)       | 收尾同上(提交 `rejected`)                                                                                                                   |
| `returned`   | 退回修改(終局)                                  | 收尾同上(提交 `returned`);申請人再送出 → `superseded`                                                                                       |
| `withdrawn`  | 申請人撤回(終局)                                | 收尾同上(提交 `withdrawn`);再送出 → `superseded`                                                                                            |
| `superseded` | 被下一個修訂的實例取代(終局)                    | 收尾只做自己的任務與歷程,不碰提交                                                                                                           |

終局後不再啟動任何節點(所有啟動 CAS 都帶 `status ∈ [running, blocked]`)。關卡(`steps[].status`):`pending` → `active`(進關)/ `skipped`(跳過條件成立)→ `completed`(有效結果是完成)/ `terminated`(全案終局、撤回);匯合節點 `pending` → `completed`(入線全到齊即完成)。

### 任務(`workflow_tasks.status`,七值;投影)

| 狀態                                 | 意思                                                   |
| ------------------------------------ | ------------------------------------------------------ |
| `pending`                            | 等承辦人決定                                           |
| `approved` / `rejected` / `returned` | 這個人被接受且算數的決定;關卡結束後保留                |
| `late`                               | 決定被接受,但晚於同關(或其他分支)的終局決定,不影響結果 |
| `cancelled`                          | 關卡結束 / 撤回 / 被取代 / 其他分支終局時仍未決定      |
| `blocked`                            | 承辦人失效(停用 / 移出租戶),等改派                     |

任務狀態**只由推進依實例重建**(列 7 的投影規則,`@repo/domain/workflow` 的 `projection.ts`):決定先原子寫進實例、推進再同步任務,任何時候以實例為準;改派改 `plan` 的承辦人後由推進同步 `assigneeId` 與 `previousAssigneeIds`。

## 可見、可改(設計端)

判準只有一份:`apps/api/src/workflows/workflow-access.service.ts`(操作者事實沿用表單的 `FormAccessService.factsOf`)。

| 操作者     | 看得到                                                    | 改得動         |
| ---------- | --------------------------------------------------------- | -------------- |
| 站在根組織 | 共用流程(客製流程只有該租戶看得到)                        | 共用流程       |
| 站在租戶內 | 自己的客製 + 分派來的共用流程(有 `org_workflow` 且已發布) | 自己的客製流程 |

- 租戶可以直接建客製流程(自動建本租戶的 `org_workflow`),也可以 fork 看得到的流程的已發布 / 已退役版本。
- 讀不到一律 `NOT_FOUND`;讀得到但不是自己的 → `FORBIDDEN`(`NOT_WORKFLOW_OWNER`)。分派 / 收回要站在根組織(`ROOT_ONLY`)。

## 版本與發布

與表單版本**共用同一份生命週期**:`apps/api/src/versioning/version-lifecycle.ts`(`lockDraftForPublish` / `switchToPublished` / `retireCurrentVersion`)。表單的 `FormPublishService` 與流程的 `WorkflowPublishService` 都只提供自己的設定(版本表、切換擁有者 `currentVersion` 的條件更新、`CONFLICT` 錯誤、檢查點)。流程沒有欄位級權限那一步:檢查器(交易前)→ 搶鎖配版號 → 三筆切換;後兩步與稽核是一個交易(ADR-0013),退役的兩步與稽核也是,任一步失敗全部回復,沒有發布中斷與重試。檢查點在 `WorkflowPublishHooks`(測試在那裡注入失敗)。

- **定義**以 `definition: { steps, edges?, checkFormKey? }` 進出:`steps` 是 `StepDef` 的 JSON(含 `kind: review | join`),`edges` 缺席 / `null` / 空陣列都存 `null`(= 直線)。`workflow-definition-input.ts` 只做型別整形、不判對錯(保留會被檢查器指出的東西);草稿讀寫、fork、發布快照、版本讀取原樣保留節點 `kind` 與連線。
- **檢查用表單**(`workflow_versions.checkFormKey`,選填):設計器對照的表單,存草稿一併存、發布快照保留、以某版開草稿與 fork 帶過去、版本讀取回傳。草稿的檢查結果、`validateWorkflowVersion`(外層 `checkFormKey` 沒給時)與發布前的檢查器都以它的目前版本驗 `skipWhen`;沒選時用第一個 `field` 來源的表單。選了但對不到可用的表單(不存在、看不到、沒有目前版本)→ `CHECK_FORM_UNAVAILABLE`(錯誤、擋發布),跳過條件只驗形狀,不拿別張表單硬比。它只影響設計時的檢查 —— 送出與綁定時檢查以綁定的表單為準。
- **刪除草稿**(`deleteWorkflowVersionDraft`):帶 `expectedDraftRevision`;草稿同時被發布掉了 → `CONFLICT`(`DRAFT_MISSING`)。**硬刪**那筆草稿(`BaseRepository.hardDeleteDraft`,ADR-0007 的草稿硬刪;條件與刪除同一次寫入):草稿從未發布,沒有實例 / 任務引用它;軟刪除會佔住「一個流程至多一份草稿」的部分唯一索引,改成 `retired` 又會把「發布過」的語意弄髒。刪前的整份內容(`steps`、`edges`、`checkFormKey`、`draftRevision`、`baseVersion`)寫進稽核 `workflow-version.delete-draft` 的 `before`。已發布 / 退役的版本不受影響。
- **檢查器**(`workflow-definition-checker.ts`)組好 `validateWorkflowDefinition` 要的目錄:共用 / 客製、本租戶的角色與使用者、`field` 來源表單與檢查用表單的**目前版本**欄位(共用流程只認共用表單;客製流程認共用表單與自己租戶的客製表單)。存草稿照收(錯誤隨 `validation` 回),發布有錯 → `VALIDATION_FAILED` + `issues`。共用流程含 `users` → `USERS_IN_SHARED`;客製流程的 `role` 沒填 / 不是本租戶的角色 → `ROLE_ID_MISSING` / `ROLE_NOT_IN_TENANT`。
- **退役目前版本 / 改版 / 收回分派**:進行中的實例照常走完(實例記自己的 `(workflowKey, workflowVersion)`),只影響新送出。

## 匯出專案設定

先以已發布版本完成流程驗證。根組織操作者具備 `system.workflows.view` 與 `system.workflows.publish` 時,可在共用流程的版本面板選定目前已發布且完成切換的版本,按「匯出專案設定」。填入定義發布識別 `revision` 與發布說明後,下載 `<key>.<revision>.seed.ts`;草稿、發布中的版本、退役版與租戶客製流程不提供匯出。

檔案使用同一套 `SeedSet` 契約,保留所選版本的關卡、連線、條件與檢查用表單 key。指定使用者、實際角色 ID 或其他環境資料引用會被可攜性檢查拒絕,畫面顯示問題位置與原因。匯出不改來源資料,不包含分派、表單綁定、實例或任務;租戶客製流程的角色仍由人員設定。

下載檔的登記、必要 migration 與驗證見[表單模組路線](../agents/module-scaffold.md#表單模組路線)的跨環境交付步驟;各環境的版本映射、發布與衝突處理見[受管定義機制](../concepts/data-layer-and-isolation.md#受管表單與流程)。

正本:`apps/api/src/workflows/workflow-design/workflow-seed-export.service.ts`、`packages/domain/src/seed/portable-definition.ts`。

## 流程綁定

`workflow-design/workflow-bindings.service.ts`。`org_form_workflow`(`tenantId` = `firstId` = 租戶頂層、`secondId` = 表單、`thirdId` = 流程);唯一鍵 `(tenantId, type, firstId, secondId)` = 一張表單最多一個流程,多張表單可綁同一個流程。綁定是 upsert(換流程 = 改 `thirdId`),解除 = 刪這筆。要站在租戶內(`TENANT_ONLY`)。

**綁定時檢查**(設計輔助,不取代送出時檢查;不過 → `VALIDATION_FAILED` + `issues[{ stepKey, stepNumber, problem, detail }]`):

| 流程的關卡來源 | 共用流程                                                                                                                 | 客製流程                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `manager`      | 可                                                                                                                       | 可                                            |
| `field`        | 屬於被綁的表單、欄位在它的目前版本且是使用者引用欄(`FIELD_FORM_MISMATCH` / `FIELD_MISSING` / `FIELD_NOT_USER_REFERENCE`) | 同左                                          |
| `role`         | 不可(`ROLE_IN_SHARED`,建客製流程)                                                                                        | `roleId` 要是本租戶角色(`ROLE_NOT_IN_TENANT`) |
| `users`        | 不可(`USERS_IN_SHARED`)                                                                                                  | 人要在本租戶(`USER_NOT_IN_TENANT`)            |

另外流程要本租戶看得到且**已發布**(沒有發布版 → `FORBIDDEN` `WORKFLOW_UNPUBLISHED`,不給綁)。`FormModel.workflowBinding` 回綁到哪個流程與 `isValid`(流程已收回分派 / 讀不到 / 沒有發布版 = 失效,送出一律擋);`formWorkflowOptions(formKey)` 列可選流程與各自的檢查結果。

本租戶綁了流程的表單不能做「舊版資料升級」(`FORM_HAS_WORKFLOW`),走過流程的提交也不在升級範圍(`docs/modules/forms.md`「舊版資料升級」)。

## 送出(綁流程時)的寫入順序

`workflow-engine/workflow-submit.service.ts`,由表單的 `submitFormSubmission`(`forms/form-runtime/form-submissions.service.ts`)呼叫:

0. 提交已是 `reviewing`(重複送出)且指向屬於目前修訂的實例 → 對它**再推進一次**(一個交易;結果與重試推進相同);不跑送出時檢查、不看目前綁定、不增加修訂,稽核記 `resumed`。指向的實例不屬於目前修訂 → `CONFLICT`(`STATUS_MISMATCH`)。
1. 表單的驗證與重算 → **送出時檢查**(`@repo/domain/workflow` 的 `checkSubmitCompatibility`,四種擋法見 `docs/concepts/workflow-engine.md`「送出:從提交到實例」):沒綁也沒進過審核 → 照不走流程的方式送出;擋下 → `FORBIDDEN` + reason(`WORKFLOW_REMOVED` / `WORKFLOW_UNPUBLISHED` / `WORKFLOW_MISCONFIGURED` + `issues`)。接著是修訂數與文件大小的上限(見 `docs/modules/forms.md`「提交的寫入規則」)。新修訂號 N = 目前 + 1。
2. 建實例,直接 `running`、`activeStepKeys = [startStepKey]`、`history: started`(`(submissionId, N)` 唯一,先查再建 —— 已有 = 另一次送出已提交 → `CONFLICT`(`EDIT_VERSION_MISMATCH`);每個節點一筆 `pending` 的 StepState)。
3. 提交的 `values` / `summary` / `revision` / 快照 / `reviewing` / `currentInstanceId` / `editVersion` **同一次**條件更新;前一個修訂被退回 / 撤回的實例 → `superseded`(推進收尾它自己的任務與歷程,不碰提交)。
4. `advance`。

**整個送出(第 2–4 步與稽核)是一個交易**:任一步失敗,實例、任務、提交的變更、稽核都不存在,提交維持送出前的狀態,重送就是重新送一次。檢查點 `submit:instance-created` / `submit:submission-linked` 在 `WorkflowEngineHooks`,測試在那裡(與推進的 `action:*`)注入中斷、驗證全部回復。

## 推進(`advance` 的執行器)

`workflow-engine/workflow-engine.service.ts`。判斷表本體與**執行合約**在 `@repo/domain/workflow` 的 `advance.ts` 檔頭,這裡只執行:

1. 讀實例(權威)、它的全部任務、對應的提交 → `advance`;列 5 需要時先解析進關結果(`step-entry.service.ts`:跳過條件用**該修訂**的值與送出當時的 `ctx`;審核者四種來源只算啟用中且仍在本租戶的人;`manager` 用 `OrgManagersService.resolveManagers`,名單規則在 `@repo/domain/workflow` 的 `managers.ts`)再呼叫一次(兩段式)。
2. 依序執行動作。實例的條件翻成 Mongo(`instance-writes.ts`):`editVersion` CAS、狀態、`outcome` / `finishedAt` 為 null、節點狀態以 `$elemMatch` 對陣列元素下條件、`activeStepKeys` 的 `$nin`;節點欄位以 `arrayFilters` 指到 `stepKey`(`BaseRepository.findOneAndUpdate` 的 `options.arrayFilters`)。任務先查 `(instanceId, taskKey)` 再建(交易內不吞重複鍵錯誤,TX-04)、投影同步帶讀到的狀態;提交用同步資格條件;`appendHistoryOnce` 以 `history` 沒有同種類 + 同 `taskKey` / `result` 的事件為條件。
3. `updateInstance` 的條件不成立就結束本輪、重讀再判斷;其他動作條件不成立 = 已做過。`invalidState` 不寫、停下、記 log(會一直出現在「需要推進」)。
4. 重複到沒事可做(上限 60 輪,超過記 log 停下,重試推進可接續)。

整段推進(含連續推進、跳過、自動通過)是**一個交易**(`TransactionService.withTransaction`);由動作觸發時併進該動作的交易。並發的另一個交易先寫了同一份實例 → 寫入衝突、整個交易由 driver 重跑。交易內讀寫依序 `await`(TX-02);`WorkflowSubmissionStore` 用原生 collection,自己帶目前交易的 session。

流程定義依實例記錄的 key 與版號讀取資料庫,不跨請求保留永久快取。重置後同 key/版號重建或刪除,既有服務程序會讀到新內容或回報版本不存在;一般改版仍建立新版,不原地修改已發布版本。

入口:送出、`decideTask`、撤回、改派、新增審核者、審核者失效 hook、`retryAdvanceInstance`(寫 `advance_retried`)。

## 決定、撤回、改派、新增審核者、審核者失效

- **`decideTask`**(`task-actions.service.ts`):前置(任務是我的且 `pending`、提交仍指向這個實例、實例進行中、關卡為 active、退回要 `allowReturn`、駁回 / 退回理由必填、任務 `expectedEditVersion`)後寫實例:條件含「關卡仍 active、我仍是這一項的有效承辦人、這個 `taskKey` 還沒有決定」→ `$push steps.$[cur].decisions` + `$push history` + `$inc editVersion`;**不比對** `editVersion`。寫決定、任務版號、稽核與推進是一個交易;兩人同時決定同一份實例 → 後到的寫入衝突、重跑後依當下狀態判(關卡已結束 → `STEP_CLOSED`;關卡仍進行中 → 照常接受)。條件不成立、任務已不是 `pending`、我已被改派走 → 回 `result: STEP_CLOSED`、任務不動。
- **撤回**(申請人本人:看得到這張單但不是申請人 → `FORBIDDEN`(`NOT_APPLICANT`),先於狀態檢查;依可見範圍與資料範圍規則根本讀不到 → `NOT_FOUND`;提交要是 `reviewing` 且有實例,否則 `CONFLICT` `STATUS_MISMATCH`;`instance-withdraw.service.ts` 另以實例的 `createdBy` 再比一次):條件更新 `{ editVersion, 進行中, 所有關卡都沒有決定 }` → `withdrawn`、active 關卡 `terminated`;撤回、推進收尾(提交同步成 `withdrawn`)與稽核是一個交易。決定在撤回讀完之後先提交 → 撤回的寫入衝突、重跑看到決定 → `CONFLICT`(`HAS_DECISIONS`);「沒有決定」也寫在條件裡。
- **改派**:對 `pending` / `blocked` 任務指定新人(啟用、在本租戶、不是申請人,否則 `ASSIGNEE_NOT_ELIGIBLE`;已在本關的計畫裡 → `ALREADY_IN_STEP`);條件更新 `{ editVersion, 該 taskKey 尚無決定 }` → 計畫該項換人、原人進 `previousAssigneeIds`、`assigneeState = active`、`reassigned`(一個交易,含稽核與推進)。決定先提交 → 改派寫入衝突、重跑讀到決定 → `ALREADY_DECIDED`。計畫固定:之後補建任務不會把原承辦人建回來。
- **新增審核者**:只對「解析為空」而阻擋的關卡(`blocked` 且計畫為空);條件更新追加一項(`taskKey` 接在最大序號之後)、`assignee_added`;推進建任務、解除阻擋(一個交易)。
- **審核者失效 hook**(`AssigneeInvalidationService.onUserChanged`):使用者管理的三個入口在稽核之後呼叫 —— 停用(`setUserEnabled(false)`;已停用再停用一次也會補做)、所屬組織異動(`setUserOrgs` 移除組織)、複製組織與角色的取代模式移除組織(`copyUserOrgRoles`)。**每個實例一個交易**(標失效 + 推進),對「進行中關卡、尚無決定、此刻已不合格(停用或已不在該租戶)」的計畫項目條件更新 `assigneeState = invalid`、`history: blocked`;該關 `any` 且仍有有效未決定的項目 → 不阻擋,否則該關與實例 `blocked`。推進同步任務投影(→ `blocked`)與提交的 `blocked`。已被接受的決定不受影響。
- **角色來源派單後被移除角色的人仍可審**(計畫固定);被停用 / 移出租戶走失效。

## 再送出、作廢、複製為新單

- **再送出**(`returned` / `withdrawn`):申請人以 `saveFormDraft` 改內容(狀態不變),再 `submitFormSubmission` → 修訂 +1、新實例從起點開始、前一個實例 `superseded`。
- **作廢**(`voidSubmission`;走過流程(`currentInstanceId` 有值)且 `completed`,否則 `CONFLICT` `STATUS_MISMATCH`;申請人本人或有該模組 `edit`;理由必填;不需審核)→ `voided`、稽核(一個交易)。看的是提交有沒有走過流程,不是表單現在有沒有綁。
- **複製為新單**(`copySubmissionToDraft`;來源 = 已作廢、讀者讀得到全部內容(只能讀某個修訂的審核者 → `FORBIDDEN`);讀者要有目標模組的 `create`;目標 = 同表單目前可新增的版本,沒有 → `FORBIDDEN` `FORM_NOT_AVAILABLE`):
  - 只複製讀者對來源有 `show`、目標版本有同 key 同型別的使用者填欄位、讀者對目標有 `edit` 的欄位;`computed` / `constant` 由目標版本重算。
  - 引用重驗來源可讀(`LookupProvidersService`),失效 → 清空;附件以 `StorageService.copyPrivateObject` 複製一份歸新單,複製失敗也清空。清空的欄位列在回傳的 `clearedFields`。
  - `clientRequestId` 去重;新草稿記 `copiedFrom`、來源記 `replacedById`;來源已複製過(`replacedById` 有值)→ `CONFLICT`(`ALREADY_COPIED`),同 `clientRequestId` 的重送仍回同一筆。

## 讀取授權(`canReadSubmissionRevision`)

`workflow-engine/submission-read-access.service.ts`;`formSubmission(id, revision)`、附件簽名網址、`workflowInstance(id)` 都走它。

| 誰                                          | 能看什麼                                                   |
| ------------------------------------------- | ---------------------------------------------------------- |
| 模組 `view` + 可見範圍 + 資料範圍者         | 表單的一般讀取規則(全部修訂)                               |
| 申請人(`createdBy = 我`)                    | 自己的提交(單筆,含所有修訂與歷程);列表不放寬               |
| 任務持有者(現在或曾經:含已取消、被改派走的) | **只有**他審的那幾個修訂的快照 + 那些實例的歷程;附件同範圍 |

- 任務持有者以 `workflow_tasks.assigneeId` + `previousAssigneeIds` 判。讀提交時:`revision` 省略 = 他可讀的修訂中最新的一個;摘要改用該修訂**實例上的快照**、`revisions` 只列可讀的、`abilities` 全為 false;提交層的現況(`currentInstanceId` / `blocked` / `voidedAt` / `voidReason` / `replacedById` / `copiedFrom`)一律不給(null / false)。讀不到的修訂 → `FORBIDDEN`。
- `formRuntimeVersion`:沒有業務模組權限、但持有(或曾持有)這張表單任務的人也拿得到定義(申請中心詳情頁不經業務模組頁面權限)。
- 以讀者的租戶為邊界找提交;停用 / 移出租戶的人本來就進不來。別人的草稿一律讀不到。

## 申請中心

`apply-center/apply-center.service.ts`,都以 `tenantId` 為邊界、跨模組,不套可見範圍與資料範圍(內容以「我」為邊界):

- `myApplications`:`createdBy = 我` 且(走過流程,或該表單目前綁了流程);依 `updatedAt` 由近到遠。`activeSteps` 是目前實例進行中的關卡(平行時多個)。
- `applicableForms`:我有該模組 `create`、表單可新增、且本租戶綁了流程,依模組分組。
- `myTasks`:`assigneeId = 我`;`done = false` 待處理(`pending`,依建立時間)/ `true` 已處理(`approved` / `rejected` / `returned` / `late`,依決定時間);`cancelled` / `blocked` 的任務兩邊都不列。**摘要與申請人讀實例快照**。
- `workflowInstance`:授權同 `canReadSubmissionRevision`,讀不到 → `NOT_FOUND`;`myTasks` 欄位是讀者自己在這個實例的任務,`abilities.canWithdraw` = 申請人、進行中、還沒有決定。
- `applyCenterCounts`:頁籤與側欄 badge 的數字,見下一節。

### 計數(`applyCenterCounts`)

`applyCenterCounts: { myTasks, myApplications }` 只做 `countDocuments`,權限同兩個列表(`apply-center.view`)。條件與兩個列表**共用同一組 builder**(`myTasksFilter` / `myApplicationsFilter`),邊界一樣是 `tenantId` + 「我」:

| 數字             | 條件                                                                                         | 顯示在                         |
| ---------------- | -------------------------------------------------------------------------------------------- | ------------------------------ |
| `myTasks`        | 「待我審核」預設的待處理:`assigneeId = 我`、`status = pending`                               | 「待我審核」頁籤、側欄申請中心 |
| `myApplications` | 「我的申請」的條件 + 狀態 `reviewing` / `returned`(草稿、已完成、已駁回、已作廢、已撤回不算) | 「我的申請」頁籤               |

admin 端(`hooks/base/useApplyCenterCounts.ts`):

- 顯示用 `@repo/ui/badge`:0 不顯示、超過 99 顯示 `99+`;「待我審核」主色、「我的申請」灰底。側欄(`app/AdminShell/ShellLayout.tsx` 把 `{ "apply-center": myTasks }` 傳給 `SideNav` 的 `badges`)展開時畫數字,收合時只畫小圓點。
- 沒有 `apply-center.view` 的人不發請求。
- 不輪詢:殼進站取一次、進申請中心(`refetchOnMount: "always"`)與切頁籤各重取一次,其餘靠寫入端失效 —— `useFormSubmissionCache`(送出、修改、刪除、撤回、作廢)、`useWorkflowCache`(決定、重試推進)、阻擋清單的 `useBlockedActions`(改派、新增審核者)都會一併呼叫 `useInvalidateApplyCenterCounts`。

## 通知信

`workflow-engine/workflow-notifier.service.ts`:任務建立(給審核者)、有結果(核准 / 駁回 / 退回,給申請人;駁回 / 退回附理由)。撤回是申請人自己的動作、`superseded` 不通知。

- 開關 `WORKFLOW_MAIL_ENABLED`(普通 env,`"true"` 才寄,每次寄信時讀;`docs/env-registry.md`):關閉時只寫 log。收件人再經 `MailService` 的 `MAIL_ALLOWLIST`(沒設 = 不限)。
- **交易內登記、提交後寄**:推進在交易內執行 `notifyTaskCreated` / `notifyResult` 時只登記寄信(`afterCommit`,TX-03),接著同一個交易追加歷程標記 —— 任務信 = 該 `taskKey` 的 `task_created`;結果信 = `notified`(帶 `result`,與流程完成事件 `completed` 分開)。交易提交後才真的寄;交易回復就不寄、標記也不存在。
- **盡力通知**:寄信失敗只記 log、不影響推進,歷程**仍記為已通知**(標記在交易內已寫入);重試推進看標記不重寄,所以不保證恰好一次、也不保證一定寄達。開關關閉時一樣追加標記、只寫 log。
- 內容只讀實例快照(表單名、實例上的標題槽、關卡名),連結 `<ADMIN_APP_URL>/apply-center/view-page/<實例 id>`。模板在 `apps/api/src/mail/mail-templates.ts`(品牌文字登記 `docs/branding.md`)。

## 阻擋清單

`workflow-engine/blocked-instances.service.ts`(`blockedInstances`,以操作者的租戶為邊界):

- `BLOCKED`:實例 `status = blocked`。
- `NEEDS_ADVANCE`:候選 = 進行中 + 終局未收尾(`finishedAt` 空)+ 任務仍待處理 / 阻擋的實例,依最久沒動排序取最多 200 筆,對它們跑一次判斷表(`WorkflowEngineService.planOf`,不寫入),還有動作 = 需要推進 —— 對應判斷表的列 2 / 4 / 4b / 4c / 5 / 5b / 6 / 7 / 8 / 8b 與資料矛盾。候選超過 200 筆回 `truncated: true`(處理完這批再查)。
- 清單與處置回傳(改派 / 新增審核者 / 重試推進)的摘要**只給標題**(`date` / `amount` 為 null):流程管理者不一定讀得到提交內容。

## admin 頁面

### 流程管理(`system.workflows`)

`apps/admin/src/pages/base/system/WorkflowsPage/`(懶載入:React Flow、dagre、檢查器不進首屏;殼層最小寬度 `xl`,`app/module-pages.tsx`)。左清單、右面板;頁首「阻擋清單」進隱藏頁(有 `system.workflows.blocked-page.reassign` 才出現)。

| 畫面                 | 做什麼                                                                                                                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 流程清單             | 搜尋;每列名稱、key、共用 / 客製、目前版本或「未發布」、分派了幾個租戶(root 視角)、有草稿、綁定的表單(租戶視角);「建立流程」看 `system.workflows.create`(站在根組織 = 共用、租戶內 = 客製)                                                 |
| 右側標頭             | 改名稱(`abilities.canEdit`)、以此為基底建流程(`canFork`)、分派(`canAssign`);分派來、含角色佔位的共用流程提示「以它為基底建客製流程」                                                                                                      |
| 流程設計(頁籤)       | 見下方「設計器」                                                                                                                                                                                                                          |
| 流程版本(頁籤)       | 草稿與各版本、發布(changelog 必填,`canPublish`)、退役目前版本、與上一版差異(以關卡 key 比:新增 / 移除 / 變更 + 分流結構有沒有變)、以任一版本為基底開新草稿、檢視某一版(唯讀)、刪除草稿(確認跳窗;設計器有未存變更時提醒一起丟掉;`canEdit`) |
| 分派跳窗             | 勾租戶 = 分派、取消勾 = 收回(只有平台)                                                                                                                                                                                                    |
| 以此為基底建流程跳窗 | 選基底版本(已發布 / 已退役)、填 key(建立後不可改)與名稱;表單管理的「建客製流程」捷徑帶著來源流程進來,直接開這個跳窗                                                                                                                       |

目前共用發布版另提供「匯出專案設定」,與表單共用 `SeedExportDialog`;條件與下載內容見[匯出專案設定](#匯出專案設定)。

**設計器**(`WorkflowDesigner/`):

- **頂列**:檢查用表單與「檢查」鈕、草稿修訂號、未存標示、在最後加一關、存草稿(帶 `expectedDraftRevision`,`CONFLICT` → 提示並可重新載入)。下方是流程圖 + 屬性面板 + 檢查結果 + JSON 預覽。改不動的流程(分派來的共用流程)只看目前版本的流程圖;沒有草稿時「開新草稿」(以目前版本為基底)。
- **編輯模型是段落串**,不是自由連線:主線上的審核關卡,或「一組分流」(從前一個審核關卡分出 N 條分支、各一關或多關、匯到同一個匯合節點)。這個形狀本身就守住允許的結構(不巢狀、不交叉、分流 / 匯合配對),每個操作是「段落串 → 段落串」的純函式,結果不合形狀就拒絕並顯示原因(`lib/base/workflow/flow-model.ts`、`flow-ops.ts`)。存檔時才產生 `steps` / `edges`(沒有分流 = 直線,`edges: null`)。草稿的結構表示不了(手改過的定義)時改成唯讀,只看檢查結果。
- **流程圖**用 React Flow(`@xyflow/react`)畫,節點位置由 `@dagrejs/dagre` 自動直式排版(`lib/base/workflow/flow-layout.ts`),使用者不手擺、**不開放自由拉線**。兩種節點:審核關卡卡片(名稱、來源、會簽、跳過條件、不可退回;有錯標紅)與匯合節點菱形(系統節點)。
- **操作**:在後面加一關、從此關分流(選分支數,只有主線上還沒分流的關卡可以)、加一條分支、在匯合後加一關、刪除此關(連線自動接上;刪掉分支最後一關 = 刪那條分支,剩一條時收成直線)、刪除整組分流(連同匯合節點)。**移動**:拖審核關卡放開,依放開位置找最近的節點插在它前 / 後或匯合之後(`lib/base/workflow/flow-drop.ts`);鍵盤也做得到:屬性面板的「上移 / 下移 / 移到分支」。分流來源不能移、會留下空分支的移動被拒。
- **檢查用表單**(`CheckFormField`):設計時對照的表單 —— 列出可選的欄位、驗證審核者欄位與跳過條件;實際送出以綁定的表單為準,綁定時會再驗一次(這句說明就放在欄位旁)。隨草稿存(`checkFormKey`,換掉也算未存變更);新草稿(`draftRevision === 0`)沒有值時預設第一張綁定的表單;存過的草稿照存的值(存了 null = 明確不指定)。
- **屬性面板**:名稱、key(已發布過的關卡 key 鎖定,以草稿的基底版本為準)、審核者來源四種(指定使用者 / 角色 / 表單欄位 / 主管;共用流程不能指定使用者、角色只填佔位)、會簽、允許退回、跳過條件(表單引擎的結構化表達式選擇器)。
  - 「表單欄位」來源與跳過條件的欄位都從檢查用表單的目前版本列(非受保護欄位;來源另限使用者型引用欄)。沒選檢查用表單時兩處欄位下拉顯示「請先選檢查用表單」;載入中、或選了但沒有可用欄位(「此表單沒有可用欄位」)也說明原因,已設的欄位值照樣顯示。檢查用表單沒有使用者引用欄時,「表單欄位」來源下方說明要先在表單設計器加一個資料來源為使用者的引用欄位並發布(唯讀檢視不提示)。
  - 候選借既有查詢:角色 `roles`、使用者 `users`、表單 `forms` / `formVersion`,拿不到就是空清單,存草稿時 api 的檢查器照樣把關。
- **即時檢查**:跑 `@repo/domain/workflow` 的 `validateWorkflowDefinition`(與 api 同一份;跳過條件與「表單欄位」來源對檢查用表單驗,`useLocalFlowReport.ts`),再併上次存草稿時 api 回的結果(api 有完整目錄;改過之後以即時為準,`lib/base/workflow/validation.ts`);每筆定位到關卡,點一下選中它。
- **「檢查」鈕**(`useFlowCheck.ts`、`FlowCheckPanel.tsx`):把目前的定義與檢查用表單送 `validateWorkflowVersion`,併入即時檢查後依關卡列出錯誤 / 警告,點一筆選中那一關並打開屬性面板;之後又改過就提示重新檢查。沒選檢查用表單時提示:跳過條件沒有對照表單時只做結構檢查,審核者的表單欄位來源仍以各自的表單驗。api 失敗時降級只列即時結果並說明。
- **唯讀檢視某一版**(`FlowVersionViewer.tsx`):版本面板「檢視 vN」時換成它,草稿的設計器照樣掛著。讀 `workflowVersion(workflowKey, version)`;節點可選、屬性面板可看不可改(`StepEditor` / `JoinPanel` 的 `isReadonly`)、不能拖、沒有存草稿;即時檢查與「檢查」鈕照樣可用(檢查用表單用那一版存的);「以 vN 為基底開新草稿」只在改得動、沒有草稿時出現,已有草稿只提示。
- **未存的變更不會無聲消失**:「流程設計 / 流程版本」兩頁籤都保持掛載;有未存變更時換流程先跳窗(留在設計 / 放棄變更 / 先存草稿);發布跳窗提示「發布的是上次存的草稿」並提供先存;關分頁 / 重新整理由瀏覽器問(狀態經 `stores/base/useWorkflowDraftStore.ts`)。

### 阻擋清單(`system.workflows.blocked-page`)

`apps/admin/src/pages/base/system/WorkflowBlockedPage/`,權限 `system.workflows.blocked-page.reassign`。

- 頁籤「阻擋」/「需要推進」(`blockedInstances` 的兩種篩選);「需要推進」的候選超過上限時(`truncated`)提示只檢查了最久沒動的一批。
- 每列:表單、實例上的標題槽(不含提交內容)、申請人、卡在哪 / 卡在誰(進行中審核關卡還沒決定的計畫項目,失效的排前面;解析為空的關卡標「找不到審核者」)、最後變動(`YYYY-MM-DD HH:mm`,讀者的租戶時區)。
- 處置:**改派**(對計畫項目,用 `plan.taskId` 呼叫 `reassignTask`)、**新增審核者**(解析為空的關卡,`addStepAssignee`)、**重試推進**。選人跳窗把申請人與已在本關的人列出但灰掉。

### 申請中心(`apply-center`)

`apps/admin/src/pages/base/apply-center/`。頁籤依序「我的申請」(預設)、「待我審核」,頁籤右側是 badge 數字(見「計數」)。

| 畫面                              | 做什麼                                                                                                                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 我的申請(頁籤)                    | `DataTable`:模組、表單、標題槽、狀態 chip(七值,阻擋時「審核中(待處理)」)、目前關卡(所有進行中的關卡名稱)、送出時間;篩選模組 / 表單 / 狀態;走過流程的列有「檢視」→ 詳情頁,草稿 / 已退回 / 已撤回有「繼續編輯」→ 該模組的編輯頁 |
| 待我審核(頁籤)                    | `DataTable`:模組、表單、實例快照的標題槽、申請人、關卡、任務狀態、建立時間;篩選模組 / 表單 / 待處理 · 已處理;待處理的列「審核」、其餘「檢視」→ 詳情頁                                                                         |
| 新申請(右上)                      | 選模組 → 選表單(`applicableForms`)→ 進該模組的新增頁 `/<模組>/create-page/<表單 key>`;沒有可選的表單時按鈕停用                                                                                                                |
| 詳情頁(隱藏頁 `view-page`,懶載入) | 網址 `/apply-center/view-page/<實例 id>`,與通知信的連結同形狀;該實例那個修訂的快照唯讀渲染(`formSubmission(id, revision)` + `FormRenderer` 的 `readonly` 模式)+ 審核區塊;不經業務模組的頁面權限                               |

模組 / 表單篩選的選項取自「新申請」的清單。零件:`hooks/base/useMyApplications.ts`、`useMyTasks.ts`、`useApplicableForms.ts`、`useApplyCenterCounts.ts`。

### 審核區塊與表單模組

- **審核區塊**(`components/base/workflow/ApprovalSection/`):表單模組的預設詳情頁(`FormViewPage`)在提交走過流程(`currentInstanceId` 有值)時掛在提交內容下方,申請中心詳情頁也用它。內容:
  - 實例狀態與流程版本、目前關卡、阻擋提示(流程管理者多一顆「重試推進」)。
  - 我的任務:核准 / 駁回 / 退回修改 —— 關卡不允許退回(`allowReturn = false`)時沒有「退回修改」;理由在跳窗裡填,駁回 / 退回必填;`STEP_CLOSED` 提示「此關已結束」並重載。
  - 申請人的撤回 / 作廢(理由必填)/ 複製為新單(成功後進新草稿的編輯頁,來源失效被清空的欄位就地提示)。只審過某個修訂的審核者讀不到提交現況,這三顆不出現。
  - 關卡 / 分支進度(每個節點一列:派任的人與他的決定、失效標示、匯合等待中 / 已匯合 / 全案終局時已結束)、時間軸(`history`,不列寄信標記)。
- **表單模組列表**:狀態 chip 七值(`components/base/workflow/SubmissionStatusTag.tsx`,列表、詳情、申請中心共用),狀態篩選也是七值;綁流程的「已完成」api 回 `canEdit = false`,列上不出現「編輯」、改出現「作廢」(`canVoid`)。
- **退回 / 撤回的單**以草稿方式改(`saveFormDraft`)再送出,編輯頁提示「改好再送出會重新審核」;送出時被擋下會顯示「流程已移除 / 尚未發布 / 設定有誤」。

### 表單管理的流程綁定欄、組織管理的主管欄

- 流程綁定欄在表單管理右面板(見 `docs/modules/forms.md`「admin 頁面」),`pages/base/system/FormsPage/WorkflowBinding/`。
- 主管欄在組織管理(見 `docs/modules/org-manager.md`)。

### 共用零件

- 錯誤解讀 `lib/base/workflow/workflow-errors.ts`(把要分開講的 `reason` 升成自己的碼,文案 `admin.workflows.errors.*`)。
- 撤回 / 作廢 / 複製 `components/base/workflow/useSubmissionActions.ts`;審核動作後的快取維護 `components/base/workflow/useWorkflowCache.ts`。
- 使用者候選 `components/base/UserPicker/useUserCandidates.ts`(借 `users`,要 `system.user-manager.view`)。

## api 介面

GraphQL 文件:`packages/graphql/src/documents/base/workflows.graphql`(設計、綁定、阻擋清單)、`apply-center.graphql`(申請中心、決定、提交的撤回 / 作廢 / 複製)。

**設計端**(`@RequirePermission` 守端點,「是不是自己的流程 / 站在哪裡」在 service):`workflows`、`workflow`、`workflowVersion(workflowKey, version?)`(省略 = 草稿)、`workflowVersions`、`validateWorkflowVersion`(query,不落庫)、`createWorkflow`、`updateWorkflow`、`forkWorkflow`、`createWorkflowVersionDraft`、`saveWorkflowVersionDraft`、`deleteWorkflowVersionDraft`(回 `WorkflowPayload`)、`publishWorkflowVersion`、`retireCurrentWorkflowVersion`、`assignWorkflowToTenants`、`revokeWorkflowFromTenant`。

**匯出專案設定**:`exportWorkflowSeed(input: { workflowKey, version, revision, changelog })`(query)回 `ExportWorkflowSeedPayload { fileName, source }` —— 把共用流程的指名版本輸出成可直接登記進專案種子的 TypeScript(檔名 `<workflowKey>.<revision>.seed.ts`)。唯讀:不寫資料庫、不留稽核、不建安裝紀錄。輸入檢查、可攜性檢查、輸出格式與錯誤外框和表單的 `exportFormSeed` 共用同一份(`apps/api/src/forms/form-design/seed-export.ts`;細節見 `docs/modules/forms.md`「api 介面」),流程這一側的差異:

- 守門:端點擋 `system.workflows.view`,其餘在 `workflow-design/workflow-seed-export.service.ts` —— `view` + `publish`(缺任一 → `FORBIDDEN`)、站在根組織(否則 `FORBIDDEN` + `ROOT_ONLY`)、共用流程(`ownerOrgId = null` 且 `tenantId = null`,兩個都驗;租戶的客製流程在根組織視角一律 `NOT_FOUND`)。
- `version`:必須是已發布的那一版,不以目前版本代替。不存在 → `NOT_FOUND`;已退役 → `VALIDATION_FAILED` + `fields: ["version"]`。`revision` / `changelog` 同表單。
- 內容:`key`、身分上目前的 `name`、該版的 `checkFormKey`(沒選 = `null`)與 `definition: { steps, edges }`(`edges` 為 `null` = 直線),`desiredStatus` 固定 `published`。不含資料庫 id、版號、時間、發布者、擁有組織、分派與綁定。
- 可攜性:共用流程不可帶指名使用者、寫死的角色 id、指向租戶客製表單的欄位;`checkFormKey` 與 `field` 來源的表單要是有目前版本的共用表單;跳過條件另驗 ID 語意。不過就整份不輸出 → `VALIDATION_FAILED` + `fields: ["definition"]` + `issues`(`{ code, message, path }`,如 `definition.steps.0.assignee.userIds`)。
- 前端的顯示條件(守門仍以 api 為準):`WorkflowModel.isShared && abilities.canPublish`,且只在目前發布的那一版顯示。

**綁定**(`system.forms.edit`、站在租戶內):`bindFormWorkflow`、`unbindFormWorkflow`(回 `FormPayload`)、`formWorkflowOptions(formKey)`、`FormModel.workflowBinding`。

**阻擋清單**(`system.workflows.blocked-page.reassign`):`blockedInstances`、`reassignTask`、`addStepAssignee`、`retryAdvanceInstance`。

**申請中心**:`myApplications`、`applicableForms`、`myTasks`、`applyCenterCounts`(`apply-center.view`)、`workflowInstance`、`decideTask`(不看頁面權限);提交的 `withdrawSubmission`、`voidSubmission`、`copySubmissionToDraft`(在表單執行端的 resolver,回 `FormSubmissionPayload`)。

**掛接點**(不是 GraphQL;給專案程式碼):固定入口 `src/project/form-lifecycles.ts` 列 `registerFormLifecycle({ moduleKey, formKey?, guards, effects })`,契約與組裝驗證在 `workflow-engine/lifecycle/form-lifecycle-registration.ts`,執行在 `FormLifecycleService`(`WorkflowEngineModule` 匯出):

- `guard(name, { operator, submission, values?, stepKey? })`:動作的交易內、寫入之前呼叫;擋下 → `FORBIDDEN` + `reason` = 專案錯誤碼。
- `runApproveGuard({ operator, submission, stepKey })`:`beforeApprove` 的單一入口(目前是 `decideTask` 的核准);其他會核准的路徑一律經它,不各自呼叫 `guard`。
- `emit(event, subject, { stepKey?, skipped? })`:事後動作,以系統身分在同一個交易內執行;推進(`WorkflowEngineService`)在關卡完成 / 跳過與提交同步成終局時呼叫,送出(`WorkflowSubmitService`)在建好實例後呼叫 `submitted`。

時機與帶入的資料見 `docs/concepts/workflow-engine.md`「掛接點:守門與事後動作」。

input 欄位的缺席 / `null`:

- `CreateWorkflowVersionDraftInput.baseVersion`:缺席 / `null` = 空白草稿。
- `WorkflowDefinitionInput.edges`:缺席 / `null` / 空陣列 = 直線(存 `null`)。
- `WorkflowDefinitionInput.checkFormKey`(存草稿):缺席 = 不動已存的值;`null` / 空字串 = 清掉(存 `null`)。
- `ValidateWorkflowVersionInput.checkFormKey`:缺席 / `null` = 改看 `definition.checkFormKey`;兩者都沒有 = 跳過條件對第一個 `field` 來源的表單驗;也沒有 `field` 來源 → 只驗形狀。
- `DecideTaskInput.comment`:缺席 / `null` / 空白 = 沒有理由(駁回 / 退回時 → `VALIDATION_FAILED` `comment`)。
- `MyApplicationsInput` / `MyTasksInput` 的篩選欄位缺席 = 不篩;`MyTasksInput.done` 缺席 = 待處理。

輸出欄位:

- `WorkflowTaskModel.summary` / `WorkflowInstanceModel.summary` 是**實例上的**快照(該修訂的標題槽),不是提交最新的摘要。
- `WorkflowTaskPayload.result`:`decideTask` 回 `ACCEPTED` / `STEP_CLOSED`;改派 / 新增審核者一律 `ACCEPTED`。
- `WorkflowPlanItemModel.taskId`:這一項對應的任務 id,**只給流程管理者**(`abilities.canManage`)—— 阻擋清單要對別人的任務改派(`reassignTask` 收 taskId);其他讀者一律 null,任務還沒建出來也是 null。
- `WorkflowInstanceStepModel.allowReturn`:這一關可否退回修改(版本定義的 `allowReturn`,省略 = true;匯合節點 false)—— 審核區塊依它決定出不出現「退回修改」鈕;`decideTask` 仍照驗(不允許 → `VALIDATION_FAILED`)。
- `WorkflowVersionModel.checkFormKey`:設計器的檢查用表單(表單 key);沒選 = null。
- `WorkflowModel.hasRolePlaceholder`:目前發布版含角色佔位(共用流程),租戶不能直接綁。`boundForms` 只有租戶視角有(本租戶的綁定);`assignments` 只有 root 視角的共用流程有。
- **`abilities` 含權限**(業務模組那一種,前端直接用):`WorkflowAbilities`、`WorkflowInstanceAbilities`、`FormSubmissionAbilities` 的 `canWithdraw` / `canVoid` / `canCopy`(見 `docs/modules/forms.md`「api 介面」)。
- `FormSubmissionModel.clearedFields`:只有 `copySubmissionToDraft` 的回傳有值。
- `ApplyCenterCounts`:`{ myTasks, myApplications }`,條件見「計數」。

## 錯誤

通用碼照 GQL-04,不新增 code;「為什麼」放 `extensions.reason`(正本 `apps/api/src/workflows/workflows-error.ts`)。

- `CONFLICT`:`DRAFT_REVISION_MISMATCH`、`DRAFT_EXISTS`、`DRAFT_MISSING`、`NO_CURRENT_VERSION`、`CURRENT_VERSION_CHANGED`、`EDIT_VERSION_MISMATCH`、`STATUS_MISMATCH`、`HAS_DECISIONS`(撤回:已有審核意見)、`ALREADY_DECIDED`(改派:此任務已決定)、`ALREADY_IN_STEP`(改派 / 新增:此人已在本關)、`INSTANCE_CHANGED`(實例已結束、關卡已前進、不是解析為空的阻擋、一直被別的動作搶先)。送出時的容量上限 `REVISION_LIMIT` / `DOCUMENT_TOO_LARGE` 屬表單的錯誤(`docs/modules/forms.md`「錯誤」)。
- `FORBIDDEN`:`ROOT_ONLY`、`NOT_WORKFLOW_OWNER`、`TENANT_ONLY`、`WORKFLOW_REMOVED` / `WORKFLOW_UNPUBLISHED` / `WORKFLOW_MISCONFIGURED`(送出時檢查,後者附 `issues`;綁定時沒有發布版也是 `WORKFLOW_UNPUBLISHED`)、`ASSIGNEE_NOT_ELIGIBLE`(改派 / 新增的對象停用、不在本租戶或是申請人)、`NOT_APPLICANT`(撤回別人的單)。
- `VALIDATION_FAILED`:發布的檢查器錯誤 → `fields: ["definition"]` + `issues`(`@repo/domain/workflow` 的 `WorkflowIssue`);綁定時檢查 → `fields: ["workflowKey"]` + `issues`(`BindingIssue`);匯出可攜性錯誤 → `fields: ["definition"]` + `issues[{ code, message, path }]`,匯出版本狀態不符 → `fields: ["version"]`;其餘照一般的 `fields`。
- 送出時檢查擋下時給申請人看的訊息是「流程設定有誤,請聯絡管理員」「流程尚未發布」「此表單的審核流程已移除,請聯絡管理員」(`SUBMIT_CHECK_MESSAGES`),前端依 reason 對應。

## 稽核

| action                                                                                     | targetType          | 記什麼                                                                                     |
| ------------------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------ |
| `workflow.create` / `.update` / `.fork` / `.assign` / `.revoke`                            | `workflow`          | key、名稱、fork 來源、分派的租戶                                                           |
| `workflow-version.create-draft` / `.save-draft` / `.delete-draft` / `.publish` / `.retire` | `workflow_version`  | workflowKey、版號、draftRevision、changelog、檢查用表單;刪草稿的 `before` 記刪前的整份定義 |
| `form.bind-workflow` / `form.unbind-workflow`                                              | `form`              | 綁定前後的流程                                                                             |
| `task.decide` / `task.reassign`                                                            | `workflow_task`     | 決定種類 / 改派前後的承辦人                                                                |
| `task.add-assignee` / `instance.retry-advance`                                             | `workflow_instance` | 關卡、taskKey、新增的人                                                                    |
| `submission.submit` / `.withdraw` / `.void` / `.copy`                                      | `form_submission`   | 修訂號、流程版本、作廢理由、複製來源(**不記值**)                                           |
