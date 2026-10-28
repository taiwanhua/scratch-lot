# 多租戶隔離:orgId + BaseRepository 自動過濾 + ancestors 樹

> 現況說明見 `docs/concepts/data-layer-and-isolation.md`。

## 資料隔離機制

**決策**:

- 掛 orgId 的業務 collection 一律在 schema 掛 `tenantScopePlugin`;複合索引以 orgId 開頭。
- orgId 租戶資料的查詢必經 **BaseRepository**,plugin 自動把「orgId ∈ 範圍」以 `$and` 加進查詢。個別功能不自己寫、也繞不過。裸 `Model.find` 由 ESLint 規則 `@repo/no-raw-model-query` 擋。
- 資料分三類:租戶資料(自動過濾)、全域資料(不過濾)、關聯歸屬資料(users / roles,由模組先查關聯)。
- 操作者上下文是每個方法的第一參數;**沒帶上下文就拋錯(fail-closed)**。
- 根組織的範圍以 `"all"` 表示,不列舉 id。
- 寫入保護:`create` 自動寫入當前組織、不可寫到範圍外;更新不得變更 `orgId` 與建立資訊。搬移組織是獨立、明確的操作(`BaseRepository.reassignOrg`,見下方「例外出口」)。讀進來的租戶文件不能再 `save()`(不經查詢中介層),更新一律經 BaseRepository 的條件更新。
- `audit_logs` 視為租戶資料。
- **模組資料表**(schema 開 `tenantScopePlugin({ moduleData: true })`,如示範模組與 `form_submissions`)另帶 `moduleKey` 與 `tenantId`(依 `orgId` 祖先推導的租戶頂層;根組織資料為 null)。`tenantId` 只用於租戶邊界、索引與日後分片,不決定可見範圍。
- **以 `tenantId` 為邊界的專屬存取層**:業務關聯(`business_relationships`)、流程(`workflows`)、審核任務(`workflow_tasks`)不掛 plugin,各有一支專屬 repository,每個方法強制帶必填的 `tenantId`,沒帶就拋錯(同樣 fail-closed);檔頭以 eslint 豁免註明「此檔即唯一合法出口」。部門使用者的可見範圍不含租戶頂層,掛 plugin 會查不到本租戶的分派設定;審核者不一定在申請人組織的可見範圍內,任務也不能照可見範圍過濾。
- 組織與模組樹採物化路徑(`ancestors`)。

**理由**:

- 隔離寫在每個功能裡,總有一個會忘記;放在資料層中介層,新功能天生就被過濾。
- fail-closed:少帶上下文應該是程式錯誤,不是「回傳全部」。
- 物化路徑讓子樹查詢一句完成;代價是搬移節點時要批次更新子孫。

**已知限制**:`populate()` 的子查詢不帶上下文,對租戶資料會拋錯;現階段關聯資料分兩次查(待辦見 `docs/tmp/dis.md` 搜「populate」)。

## 專案資料的登記邊界

**決策**:底座與專案的 schema、repository 及組織資料檢查分開登記,由固定 DatabaseModule 入口驗證後組裝。業務模組只取得受控 repository,不取得 Mongoose model 或整個 MongooseModule。底座 repository 定義不回指組裝入口,專案新增不修改底座清單。

- model name、collection、provider token 與登記 key 不得撞名,專案不能用同名宣告替換底座資料層。provider token 以本體比較,不以 class.name 判定。
- 一般新增專案 model 使用 `orgId`、business scope、`allowGlobal: false`、baseFields 與 BaseRepository;模組資料使用 `moduleData: true`。collection 在掛 plugin 前就確定,登記驗證安裝標記與安裝時捕捉的 collection,不靠欄位形狀推論 plugin 已存在。
- 每個一般新增專案 model 都須有同登記內的 repository 與 `orgId` 存在檢查;宣告的 modelName 須一致,啟動時再核對 repository 的實際 model / collection。漏登記或錯綁資料表即失敗。
- 刪組織與撤銷開通共用底座 reader,專案只宣告檢查對象,不能提供取得放寬上下文的 callback 或任意 filter。workflows / tasks 保留底座的 tenantId 專用檢查,audit logs 不阻擋刪除。
- DataScopeRuleProvider 未註冊時,DatabaseModule 的啟動檢查必須失敗,不能讓應用只剩租戶保底而略過資料範圍規則。

**理由**:新增資料表若只登記 schema,容易漏掉 repository 的隔離接線或刪組織的資料引用檢查。把三者連在同一份登記,並檢查實際 repository 身分,才能在啟動時發現漏接或錯綁。純登記驗證、來源限制與 review 各有範圍,不以此介面執行不受信任的 Nest 外掛。

底座的 project 資料登記預設為空,沒有專案裸查豁免或可選的 unsafe/global 模式。新增租戶模組須符合上述登記與隔離檢查;存放位置及完整契約見[資料層組裝](../concepts/data-layer-and-isolation.md#底座與專案資料的組裝)。

正本:`apps/api/src/database/registration.ts`、`apps/api/src/database/database.module.ts`、`apps/api/src/database/org-business-data.reader.ts`、`apps/api/src/database/plugins/`。

## 可見範圍

**決策**:

- 「使用者可見自身組織的下層組織資料」開關掛在**租戶頂層**的 `settings.visibility`(`"own"` / `"subtree"`,未設視為 `"own"`),套整棵租戶;不做逐層自決。
- 可見範圍 = 所有所屬組織的聯集(開關 ON 時各含下層)。根組織預設可見全部。
- 頁面預設顯示範圍是各頁的慣例,不是設定:治理模組攤開整個管理範圍;業務模組預設篩當前組織。新資料一律寫入當前組織。

**理由**:逐層自決會出現嵌套矛盾(上層開、下層關);保守預設讓租戶要開才開。

## 可見性開關與角色授予的關係

**決策**:開關只影響業務資料;不影響角色資格(恆以擁有組織子樹判定,ADR-0003),切換不觸發重算或回收。選人器候選由角色決定,再與操作者的可見範圍取交集。

## 管理範圍與可見範圍的分工

**決策**:兩個範圍各管各的:

| 範圍     | 誰決定                                   | 管什麼                                              |
| -------- | ---------------------------------------- | --------------------------------------------------- |
| 管理範圍 | 持有的啟用中角色之擁有組織子樹(ADR-0003) | 治理模組:組織樹的根、使用者清單、角色候選、搬移候選 |
| 可見範圍 | 所屬組織 + 租戶頂層的可見性開關          | 業務資料看多少(資料範圍規則在其中再縮小)            |

- 治理類 / 業務類寫在 schema 上,由 plugin 選用範圍,不由呼叫端選。
- 上下文另帶兩個集合給資料範圍用:`memberOrgIds`(所屬組織的直接關聯)與 `roleIds`(啟用中角色)。四個集合不可互相代用。
- 開關由租戶頂層的擁有者、持 `system.org-manager.set-visibility` 的租戶使用者、或根組織設定;它是租戶自己的資料政策。
- 開關不影響治理頁、角色資格、管理範圍。
- 租戶頂層本身的停用 / 刪除 / 搬移只有根組織可做(ADR-0009)。

**理由**:若治理頁也綁在可見範圍上,租戶管理員在開關為 `own` 時只看得到自己所屬的幾個組織,管不了自己的租戶。治理工作天生跨組織,應由角色決定;業務資料的多寡才是租戶的資料政策。四個集合語意不同,混用會讓資料範圍規則命中錯的人。

## 例外出口(登記在案)

**決策**:租戶資料存取需要放寬可見範圍或資料範圍時,只有下列登記過的受控出口,新增出口要在這裡登記(讀取的放寬另有資料共用宣告,ADR-0014):

| 出口                                                                                                                                       | 放寬了什麼                                                                                                                                                                                                              | 誰能用                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 為什麼                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BaseRepository.findOwnById` / `findOwnOne` / `findOwnAndUpdate`                                                                           | 不套**資料範圍規則**;可見範圍照套,條件加 `createdBy = 操作者`                                                                                                                                                           | 只給表單提交:建立者讀自己的單、寫(存 / 送 / 刪)自己的草稿                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 規則把草稿擋在範圍外時,建立者連自己剛存的草稿都送不出去;列表不放寬,別人的單照規則                                                                                                                                                                                 |
| `BaseRepository.existsAny`                                                                                                                 | 不套**資料範圍規則**;條件只能是歸屬欄(`orgId` / `ownerOrgId`)等於某個組織,只回有無                                                                                                                                      | 只給前置檢查(刪組織、撤銷開通的「無業務資料引用」);允許的檔案登記在 `base.repository.ts` 的 `EXISTS_ANY_CALLERS`,測試掃 src 斷言                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 前置檢查問「有沒有」,被規則收窄的操作者會數到 0、把還有資料的組織誤判成可刪;帶不了任意條件,列表與詳情不放寬                                                                                                                                                       |
| `apps/api/src/database/form-submission-usage.ts`                                                                                           | 不套可見範圍、不套資料範圍規則,**跨全部租戶**計數                                                                                                                                                                       | 只給退役欄位級權限清理的三層檢查                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 少算一筆草稿就會把還在用的權限刪掉;只回筆數與版本號,不回任何提交內容(檔頭 eslint 豁免附理由);以原生驅動 `model.collection.aggregate` 計數(不經 `tenantScopePlugin` 的 aggregate 中介層 —— 那裡沒帶上下文一律拋錯);原生 aggregate 只准出現在這個檔,測試掃 src 斷言 |
| `apps/api/src/database/workflow-submission-store.ts`                                                                                       | 不套可見範圍、不套資料範圍規則;以 **`tenantId`** 為邊界(每個方法必填)                                                                                                                                                   | 只給審核流程:引擎(推進、送出、決定)、讀取授權 `canReadSubmissionRevision`、申請中心;允許的檔案登記在該檔 `WORKFLOW_SUBMISSION_STORE_CALLERS`,測試掃 src 斷言                                                                                                                                                                                                                                                                                                                                                                                                                          | 審核者 / 上層主管 / 背景推進不在申請人組織的可見範圍內,而對全員生效的資料範圍規則連系統上下文也收窄(ADR-0008);寫入只有引擎的條件同步與狀態欄位                                                                                                                    |
| `BaseRepository.existsInTenant(operator, tenantId, equals)`                                                                                | 不套可見範圍、共用與**資料範圍規則**;以必填的 **`tenantId`** 為邊界(plugin 釘上),且必須是操作者所屬的租戶(根組織除外);條件只能是**欄位等於值**的組合(`{ orgId, name }` 這類;不收運算子物件、不能是 `tenantId`),只回有無 | 只給租戶內唯一 / 占用檢查(證號、代碼、同店名稱、「這個組織是否已被占用」);只給有 `tenantId` 欄的表(模組資料表或自己宣告 ObjectId `tenantId` 的表);允許的檔案登記在 `base.repository.ts` 的 `TENANT_BOUNDARY_CALLERS`(專案的登記在 `project/database/tenant-boundary-callers.ts`),測試掃 src 斷言                                                                                                                                                                                                                                                                                      | 問的是整個租戶,不是操作者看得到的那一部分;只回有無,不回筆數或文件                                                                                                                                                                                                 |
| `BaseRepository.findRefsInTenant`                                                                                                          | 同上,以必填且屬於操作者的 `tenantId` 為邊界;明列 id,只回 schema 宣告的 `refFields`(`tenantScopePlugin` 選項)與 `_id`                                                                                                    | 只給「看得到這筆就看得到它引用的名稱」;呼叫端同樣登記在 `TENANT_BOUNDARY_CALLERS`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 引用的對象可能不在讀者的可見範圍;欄位白名單寫在 schema,出口回不了其他欄位                                                                                                                                                                                         |
| `BaseRepository.reassignOrg(operator, filter, newOrgId, { session, update })`(搬家)                                                        | 一般更新不准改的 `orgId`;新組織**可以**在操作者的可見範圍外                                                                                                                                                             | 只給「把資料改歸屬到同租戶另一個組織」(例:把資料移給別的分店);被搬的資料要在操作者可見範圍內(寫入範圍),新組織要存在、同租戶、不能是根組織(否則 `VALIDATION_FAILED`、`fields: ["orgId"]`);有 `tenantId` 欄的表照新組織重新推導;條件更新;**必須在交易內**(不在交易內 → `TenantScopeError`),同一個交易寫稽核 `data.reassign-org`(誰、哪筆、從哪到哪);已經在新組織 = 冪等(不寫入、不記稽核,回原文件);允許的檔案登記在 `base.repository.ts` 的 `ORG_REASSIGN_CALLERS`(底座)與 `project/database/org-reassign-callers.ts` 的 `PROJECT_ORG_REASSIGN_CALLERS`(專案),測試以呼叫語法掃 src 斷言 | 一般更新若能改 `orgId` 就能把資料搬進別的租戶;搬家收成一個具名方法,租戶檢查、重新推導與稽核都在裡面,呼叫端漏不掉                                                                                                                                                  |
| `BaseRepository.reassignOrgMany(operator, target, newOrgId, { session, expected, update })`(批次搬家)                                      | 同 `reassignOrg`:一般更新不准改的 `orgId`;新組織**可以**在操作者的可見範圍外                                                                                                                                            | 一次搬多筆(`target` = id 清單或選取條件);規則同 `reassignOrg`(可見範圍內、新組織同租戶且不是根組織、重推 `tenantId`、欄位保護、**必須在交易內**);**全有或全無**:逐筆核對看不到 / 不存在 / 不符 `expected` 各自條件的,任何一筆不符就不寫入、回 `mismatched`,寫入筆數與核對結果不同 → `CONFLICT`;已在新組織的跳過(`skipped`),全部跳過不記稽核;整批只寫**一筆**稽核 `data.reassign-org`(來源組織、新組織、id 清單、筆數);呼叫端登記與 `reassignOrg` 同一份清單                                                                                                                           | 同 `reassignOrg`;逐筆呼叫 `reassignOrg` 在交易內每筆都要往返(TX-06),批次版把核對與寫入收成固定次數,租戶檢查與稽核照樣在方法裡                                                                                                                                     |
| `BaseRepository.createMany(operator, docs, { session })`(一次寫多筆)                                                                       | 不放寬範圍;只是把 `create` 的逐筆檢查換成一次 ordered `insertMany`                                                                                                                                                      | 任何呼叫端;每筆的檢查與 `create` 相同(可見範圍、`tenantId` 推導並覆蓋、`moduleKey`、`shareOrgs` 驗證、建立者),一筆不過整批不寫;**必須在交易內**(不在交易內 → `TenantScopeError`)                                                                                                                                                                                                                                                                                                                                                                                                      | `insertMany` 不走 `save` 中介層,直接呼叫就繞過寫入檢查;收進 BaseRepository 才每筆都照 `create` 檢查,中途撞唯一索引由交易回復前面已寫的                                                                                                                            |
| `apps/api/src/database/tenant-boundary-context.ts` 的 `tenantBoundaryContext(orgs, operator \| null, tenantId)`(底層 `systemTenantReader`) | 可見範圍與管理範圍 = 該租戶整棵組織樹;有操作者時 `tenantId` 必須是他所屬的租戶(根組織除外)並保留他的 `actorId`,沒有操作者 = 租戶系統身分;資料範圍規則照套(ADR-0008)                                                     | **讀**:反查(整個租戶的關聯反查、看得到的資料的關聯列)、以人為準的資料(跨組織屬於人的資料,例:個人的出缺勤、人員檔案)、排程逐租戶跑、系統重算(別的單據在交易內觸發的重算);**例外寫入**:登記在呼叫端清單(底座目前沒有)。允許的檔案與用途登記在該檔 `TENANT_BOUNDARY_CONTEXT_CALLERS`(專案的登記在 `project/database/tenant-boundary-callers.ts`),`tenant-boundary-context.test.ts` 依 import 來源掃 src 斷言;`system-tenant-reader` 只准由它 import;不得傳入提升上下文(會被當成根組織成員)                                                                                               | 問的是整個租戶;取代「提升成 `"all"` 再自己釘 `tenantId`」。**前提:用它讀寫的表不是資料範圍目標**(系統身分沒有角色,對全員生效的規則會收窄)                                                                                                                         |
| `apps/api/src/database/tenant-purge.store.ts` 的 `TenantPurgeStore`(清空租戶)                                                              | **全部**:不經 BaseRepository 與 schema 中介層,以原生 collection 硬刪一整個租戶的資料(含軟刪除的與只能新增的帳本 `audit_logs`、流水、事件),範圍由刪除登記(`database/tenant-purge.ts`)決定                                | 只給清空示範機構(`orgs/demo-tenant-purge.service.ts`,demo 指令 `purge` / `rebuild`):操作者站在根組織、持 `system.org-manager.tenant-ops.purge-demo`,目標以固定短碼找到的租戶頂層**必須有「示範」標記**(沒有 → `FORBIDDEN`,一筆都不刪);刪除與稽核 `org.purge-demo` 同一個交易;允許的檔案登記在該檔 `TENANT_PURGE_STORE_CALLERS`,`exists-any-callers.test.ts` 掃 src 斷言                                                                                                                                                                                                               | 重建示範機構要「當作沒發生過」:同一組短碼與帳號要能重新開通,中介層的租戶保底與只增不改正是要繞過的東西;只對標「示範」的機構生效,真實租戶永遠刪不到;登記制讓新表不會漏刪                                                                                           |

**提升上下文**(把可見範圍或管理範圍寫成 `"all"` 的操作者上下文)不是出口,但同樣要登記:只准出現在 `apps/api/src/database/elevated-contexts.ts`(底座)與 `apps/api/src/project/database/elevated-contexts.ts`(專案)列出的檔案,每筆附理由;`elevated-contexts.test.ts` 掃整個 src(測試檔與 `test-support/` 除外),新增未登記的一處就失敗。新需求先用上表的出口或資料共用宣告。

`existsAny` 的唯一受控 caller 是 `apps/api/src/database/org-business-data.reader.ts`,由 `EXISTS_ANY_CALLERS` 與測試鎖定。專案新增業務資料檢查走資料登記,不把 project 目錄加入 caller 例外。reader 的查詢錯誤必須讓刪除 / 撤銷失敗,不可當成沒有資料。

**理由**:每一個都是「照常規會算錯」的特定用途,出口收窄到具名方法 / 單一檔案,讀程式的人一眼看得到豁免;其他模組不得借用。

## 其他

- UI 提示用白話(如「或其下層組織」),不用內部術語。
- front 會員註冊預設歸屬根組織,底座允許指定其他組織。
- 欄位管理:類別是全域資料(seed 宣告的系統類別,或根組織在畫面新增的類別),租戶不可自訂;選項帶可空 `orgId`(null = 全域種子)。自訂選項沿組織樹向下繼承:看得到 = 全域 + 祖先 + 自己 + 可見範圍內的下層,只能編輯自己這一層加的。規則正本 `docs/modules/field-manager.md`。

## 影響

- 新增專案業務 collection:在 `project/database/` 建立 schema 與 repository,掛齊基礎欄位與租戶 plugin,並在專案資料登記連結 model、repository 與組織存在檢查。真 API 測試須驗隔離、資料範圍、刪組織及撤銷開通,不能只驗 schema 有欄位。步驟見 `docs/agents/module-scaffold.md`。
- 需要讀可見範圍外的資料時,先用資料共用宣告(ADR-0014)或上表的出口;仍需提升範圍(如祖先的商標、祖先的欄位選項)時要明列 orgId、不能繞過 BaseRepository,並登記在提升上下文清單。
