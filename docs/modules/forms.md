# 表單引擎(技術)

表單引擎怎麼落地、選了哪些做法與為什麼。概念與名詞先看 `docs/concepts/form-engine.md`;三個示範表單模組見 [demo-form](./demo-form.md);送出後的審核見 [workflows](./workflows.md)。

程式的分布:

| 塊           | 位置                                                                                                   | 內容                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 共用純邏輯   | `@repo/domain/form`                                                                                    | 定義的型別、表達式與型別表、檢查器、值的正規化與規則驗證、計算與顯示條件收斂、時區、升級搬值 |
| api 表單設計 | `apps/api/src/forms/form-design/`                                                                      | 表單、版本、四步發布、分派 / 啟用、欄位級權限的產生與退役清理、列表欄位配置                  |
| api 表單執行 | `apps/api/src/forms/form-runtime/`                                                                     | 草稿 / 送出 / 修訂、欄位級投影、顯示名、lookup、類別選項、舊版資料升級                       |
| api 共用     | `apps/api/src/forms/`(根目錄、`form-values/`)                                                          | 可見 / 可改判準、寫入規則、欄位級權限閘門、lookup 登錄表                                     |
| admin        | `apps/admin/src/components/base/form-engine/`、`lib/base/form-engine/`、`pages/base/system/FormsPage/` | 引擎零件、純邏輯、表單管理頁                                                                 |

`@repo/domain/form` 打成一檔且模組頂層就註冊 JSONLogic 運算子;只要格式檢查(表單 key、欄位 key、租戶短碼)的地方改走輕量子路徑 `@repo/domain/form-keys`,正則的 ReDoS 檢查在 `@repo/domain/form-regex-safety`,兩者都是為了不把整個引擎拉進 admin 首屏 bundle。

## 模組 key 與權限表

「表單管理」是治理群組底下的一般模組(**不是**根組織專屬 —— 租戶管理員要管自己的客製表單);分派 / 收回另由 api 以「站在根組織」守。

| 權限 key                                          | moduleId 指向 | 它是哪一頁的什麼                                                                    |
| ------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------- |
| `system.forms.*`                                  | 表單管理      | wildcard(同層語意);seed 自動產生                                                    |
| `system.forms.view`                               | 表單管理      | 表單清單、版本、定義;設計器的檢查器與預覽                                           |
| `system.forms.create`                             | 表單管理      | 建共用表單(只有根組織)、以某版本為基底建新表單                                      |
| `system.forms.edit`                               | 表單管理      | 改名稱 / 頁籤模板、開草稿、存草稿、發布(含重試)、退役目前版本(只能動自己擁有的表單) |
| `system.forms.assign`                             | 表單管理      | 分派 / 收回共用表單(只有站在根組織)                                                 |
| `system.forms.set-enabled`                        | 表單管理      | 租戶內開關分派來的或自己的表單                                                      |
| `system.module-manager.delete-retired-permission` | 模組與權限    | 刪除已退役的欄位級權限(三層檢查;根組織專屬模組)                                     |
| `<moduleKey>.view / create / edit / delete`       | 各表單模組    | 列表與單筆 / 新增 / 修改已完成 / 刪除已完成(seed 宣告,端點在執行期判)               |
| `<moduleKey>.<action>`                            | 各表單模組    | 宣告的頁內權限(如 `store.sell`;見下方「表單模組宣告」)                              |
| `<moduleKey>.show-<formKey>-<fieldKey>`           | 各表單模組    | 欄位級:讀受保護欄位(`source: dynamic`,發布時建)                                     |
| `<moduleKey>.edit-<formKey>-<fieldKey>`           | 各表單模組    | 欄位級:改設了 `permission.edit` 的欄位(同上)                                        |
| `<moduleKey>.create-<formKey>`                    | 各表單模組    | 依表單新增(`source: dynamic`);解析認得,尚無建立流程                                 |

`show-` / `edit-` / `create-` 三種合稱表單動態權限;別租戶客製表單的那幾筆在權限解析就被剔除(見[授權](../concepts/authorization.md#表單模組的權限))。

正本:`apps/db-migrator/seeds/base/modules/system.ts`、`apps/api/src/forms/form-permission-keys.ts`

### 表單模組宣告

`formModuleDeclaration({ key, name, parentKey, route, order, icon, description, settings?, permissions? })` 產出整份骨架:列表節點(`engine: "form"`、`sidebarType: link`)、三個隱藏頁、固定四條權限、`form_submissions` 的資料範圍目標。

- `permissions: [{ action, name, description? }]`(選填):頁內額外權限,掛在模組主節點,和固定四條一起產生 `<moduleKey>.<action>`。例:`permissions: [{ action: "sell", name: "銷售" }]` → `store.sell`。
- `action` 和固定四條、`*` 或表單動態權限的前綴(`show-` / `edit-` / `create-`)撞形狀 → 宣告時丟錯。
- `<moduleKey>.*` 照常由組裝器自動產生,自然涵蓋宣告的頁內權限。

正本:`apps/db-migrator/seeds/base/form-module-declaration.ts`

## 資料

`forms`、`form_versions`、`form_submissions` 三張表,加上 `business_relationships` 的 `org_form`(分派 / 啟用)與 `permissions` 的 `source: dynamic`(欄位級權限)。表的用途與跨檔約定見 `docs/data-model.md`,欄位與索引見各 schema 檔。

登記為 seed 的共用表單由專案版本交付,沿用下述設計與發布服務;分派、提交及租戶客製表單由各環境獨立維護。受管邊界、版本映射與衝突處理見[受管表單與流程](../concepts/data-layer-and-isolation.md#受管表單與流程)。

## 可見、可改、可新增

判準只有一份:`apps/api/src/forms/form-access.service.ts`。

| 操作者     | 設計端看得到                                     | 設計端改得動         | 可以新增(`moduleForms`)                    |
| ---------- | ------------------------------------------------ | -------------------- | ------------------------------------------ |
| 站在根組織 | 共用表單(客製表單只有該租戶看得到,root 也不例外) | 共用表單(owner null) | 全部共用表單(有發布版本)                   |
| 站在租戶內 | 分派來的(有 `org_form`)+ 自己的客製              | 自己的客製表單       | 本租戶 `org_form` 啟用中的表單(有發布版本) |

- `org_form` 以租戶為邊界讀(`BusinessRelationshipsRepository`),所以部門使用者(可見範圍不含租戶頂層)也查得到本租戶的列。
- 設計端讀不到一律 `NOT_FOUND`(不透露別的租戶有這張表單);讀得到但不是自己的 → `FORBIDDEN`(`NOT_FORM_OWNER`)。root 讀不到、也不能以租戶的客製表單為基底。
- **執行端同一條邊界**(`FormAccessService.findRuntimeForm`):`formRuntimeVersion`、`formLookup` / `formLookupRecord`、`form_submission` 來源的欄位目錄與查詢、新增資格,只認共用表單與操作者自己租戶的客製表單;別租戶的客製表單(key 猜得到 `<來源 key>_<租戶短碼>`)一律當不存在(`NOT_FOUND` / 欄位目錄沒有它的欄位)。
- 租戶只能以 `forkForm` 建表單(以分派來的或自己的某一版為基底);客製表單建立時自動建本租戶的 `org_form`(預設啟用)。
- 停用(`org_form.meta.enabled = false`)、收回分派(刪 `org_form`)、退役目前版本都只擋新增;已存在的提交有模組 `view` 就照常看,草稿與已完成的單也照常可存、可修改(`saveFormDraft` / `updateFormSubmission` 不看新增資格)。
- **沒有刪除整張表單**:表單與已發布 / 已退役的版本一律保留(提交綁著它們顯示);只有未發布的草稿可刪。root 層也沒有另外的「啟用」旗標 —— 停用共用表單 = 退役目前版本或收回分派;租戶層才有 `org_form.meta.enabled` 開關。

## 表單版本

### 狀態

| 狀態         | 意思                                                                         |
| ------------ | ---------------------------------------------------------------------------- |
| `draft`      | 設計中、可改,`version = null`;一張表單同時最多一份(部分唯一索引)             |
| `publishing` | 發布步驟 2 搶到鎖、還沒切換完;存在時禁止開草稿 / 退役 / 再發布               |
| `published`  | 凍結、供新增;`forms.currentVersion` 指它                                     |
| `retired`    | 發布下一版時前一版自動變成,或「退役目前版本」;既有草稿仍可送出、歷史照常顯示 |

### 四步發布

`form-design/form-publish.service.ts`。**不用 Mongo 交易**(本機與 CI 單節點測不到交易;一致性靠冪等重試):

1. 跑檢查器(`validateDefinition` + api 端的登錄表),有錯就停,什麼都沒改。
2. 條件更新 `{ _id, status: "draft", draftRevision: 預期 } → publishing`,同時配正式版號(最大 + 1)、記 changelog。沒更新到 → `CONFLICT`。兩個發布同時送出只有一個命中。
3. 欄位級權限:這一版要的缺的建、有 `retiredAt` 的清掉、不再宣告的標 `retiredAt`、`name` 隨表單名與欄位 label 更新(「<表單名> / <欄位 label> 可見 / 可改」)。同 key 欄位沿用同一筆權限(`_id` 不變,角色的授予跟著留下)。
4. 切換三筆,依序逐筆寫:這一版 `publishing → published` → 其餘 `published → retired` → `forms.currentVersion` 指向新版。第一筆寫完到第二筆寫完之間,會**短暫有兩個 `published`**;對外(填寫、新增資格、版本面板的「目前版本」)一律以 `forms.currentVersion` 為準,最後一筆寫完前填寫者看到的仍是舊版。

**中斷**:有 `publishing` 版本,或有 `published` 版本但它不是 `currentVersion`,就是發布中斷(`FormModel.publishInterrupted`)。`retryPublishFormVersion` 從步驟 3 起重跑,每個寫入先看「已是目標狀態就跳過」,重跑幾次結果都一樣。步驟 3 / 4 每筆寫入前有一個檢查點(`form-design/form-publish-hooks.ts`),測試在那裡注入失敗來驗「中途失敗後重試 = 一次成功」。

### 退役目前版本

`retireCurrentVersion(input: { formKey, expectedVersion })`(`apps/api/src/versioning/version-lifecycle.ts`,與流程共用),版本面板帶打開跳窗時看到的版本號。固定順序兩步條件更新,**冪等**:先 `form_versions { version: expected, status: published } → retired`,再 `forms { currentVersion: expected } → null`。每一步「已是目標狀態」就算完成,所以兩步之間中斷後再呼叫一次會接著做完,同一版重複退役也不報錯。

- `currentVersion` 已指向別的版本(期間有人發布了新版)→ `CONFLICT` `CURRENT_VERSION_CHANGED`,新版不受影響;那一版既不是已發布也不是已退役 → `NO_CURRENT_VERSION`。
- `currentVersion` 的兩處寫入(退役、發布步驟 4 的最後一筆)都是條件更新 `{ currentVersion: 讀到的值 }`,讀到之後被別人改了 → `CONFLICT`(`CURRENT_VERSION_CHANGED`),不蓋掉。
- 第二步前有檢查點 `retire-current`(測試注入失敗用)。

### 存草稿與檢查器

檢查器的錯草稿可以先存(隨 payload 的 `validation` 回),發布才擋;只有正則不合法 / 可能造成 ReDoS 的不收(存草稿與發布都驗過 ReDoS 才收)。檢查器除了結構與欄位規則,還包含:

- **表達式型別檢查**(`validate-expression-types.ts`,與設計器選擇器同一張型別表 `expression-types.ts`):公式 / 預設值公式的根 = 欄位型別、條件 / 自訂驗證的根 = 是 / 否、每個參數位置型別相符(`EXPR_TYPE_MISMATCH`);比較運算子兩邊同型,日期與日期時間可混比;兩邊都沒選(`{ "==": [null, null] }`,選擇器新建條件的預設)是錯誤(`EXPR_COMPARISON_EMPTY`,一邊有值的 `x == null` 判空合法)。
- **日期運算的參數**:`dateDiff` 單位只能 `days` / `hours` / `minutes`(`EXPR_DATE_DIFF_UNIT`);`dateAdd` 方向只能 `before` / `after`、單位只能 `days` / `weeks` / `months` / `years`(`EXPR_DATE_ADD_ARG`)。
- **選項欄(單選 / 多選)公式的根型別是「選項」**(`option` / `optionList`):根與 `if` 的然後 / 否則只收 `if`、同選項來源的欄位(`options` 深比較相等)、選項常數;`concat` / `optionLabel` / 文字欄 / 文字常數不收;靜態選項的常數要在清單內(`EXPR_OPTION_UNKNOWN`,類別 / lookup 選項只驗是字串)。
- **值的合法性**:值來源「固定值」要是該型別的合法值、靜態選項要在清單內(`CONSTANT_VALUE_INVALID`,與預設值同一個判準);預設值規則(`DEFAULT_*`)、上傳欄上限(`UPLOAD_LIMIT_INVALID`)、日期時間欄上下限的格式(`RULE_RANGE_INVALID`)。
- 明細列的規則見下方「明細列」;列表欄位配置引用不到的欄位是警告(`LIST_COLUMN_MISSING` / `LIST_COLUMN_ARRAY`)。

**ReDoS 檢查注入**:`validateDefinition` 的 `regexSafety` 是必填選項;實作 `recheckRegexSafety`(recheck,固定純 JS 後端)在 `@repo/domain/form-regex-safety` —— recheck 瀏覽器版約 2.9 MB,放在 `form` 會跟著渲染器進 admin 首屏 bundle。api 的 `form-definition-checker.ts` 直接 import;admin 設計器以動態 `import()` 懶載入(`lib/base/form-engine/regex-safety-loader.ts`,模組層 promise 快取、失敗清掉下次重試),正則改動停手 300ms 才檢查、過期結果丟掉;還沒有結果時檢查結果區顯示「正則檢查中」,載入失敗顯示「存草稿時會再檢查」—— 兩種情況都先不把正則判成不安全(存草稿 / 發布時 api 照驗)。

### 刪除草稿

`deleteFormVersionDraft(input: { formKey, expectedDraftRevision })`:發布中(有 `publishing` 版本或發布中斷)→ `CONFLICT` `PUBLISH_IN_PROGRESS`;以 `BaseRepository.hardDeleteDraft` **單一條件硬刪** `{ formKey, status: "draft", version: null, draftRevision: 預期 }`。硬刪是 ADR-0007 的第三種硬刪:草稿從未發布、沒有提交綁它;軟刪會佔住 `(formKey, status)` 的部分唯一索引,讓這張表單永遠開不了新草稿。沒刪到再查草稿:有草稿 → `DRAFT_REVISION_MISMATCH`、沒有 → `DRAFT_MISSING`。刪除後寫稽核 `form-version.delete-draft`,`before` 記整份定義與 `draftRevision`。刪掉後可再以任一版本為基底開新草稿。

### 設計器預覽

`previewFormVersion`(`version` 缺席 = 草稿、有值 = 那一版已發布 / 已退役的定義;版本面板唯讀檢視歷史版本時的「以後端重算」帶它)。「不套欄位級權限」只指**本表單**的欄位(閘門對本表單全開);引用與 lookup 選項的來源照樣用操作者真實的權限 —— 否則設計者可以在草稿裡放一個引用欄、把顯示欄指到別張表單的受保護欄位,再用預覽讀出原值。

## 匯出專案設定

先以已發布版本完成試填驗證。根組織操作者具備 `system.forms.view` 與 `system.forms.edit` 時,可在共用表單的版本面板選定目前已發布且完成切換的版本,按「匯出專案設定」。填入定義發布識別 `revision` 與發布說明後,下載 `<key>.<revision>.seed.ts`;草稿、發布中的版本、退役版與租戶客製表單不提供匯出。

檔案使用同一套 `SeedSet` 契約,包含所選版本的完整欄位、版面、摘要與帶入設定,以及共用表單的名稱、模組 key、頁籤模板。可攜性檢查失敗時顯示問題位置與原因,不產生部分檔案。匯出只讀來源資料,不複製帳號、組織、提交或分派,也不代表已同步到其他環境。

將下載檔納入專案 seed 後,依[表單模組路線](../agents/module-scaffold.md#表單模組路線)的跨環境交付步驟完成登記、必要 migration 與重建/升級驗證。發布、採納及漂移處理共用[受管定義機制](../concepts/data-layer-and-isolation.md#受管表單與流程)。

正本:`apps/api/src/forms/form-design/form-seed-export.service.ts`、`packages/domain/src/seed/portable-definition.ts`。

## 提交的寫入規則

`form-values/submission-values.service.ts`。每次寫入(建草稿、存草稿、送出、已完成修改)每一欄**依序**判定,命中第一個就照那列處理:

| 順序 | 原因                            | 後端對該欄的值                             | 規則驗證(送出 / 修改時)        |
| ---- | ------------------------------- | ------------------------------------------ | ------------------------------ |
| 1    | `visibleWhen` 算出 false        | 清空(null)                                 | 不驗                           |
| 2    | `computed` / `constant`         | 後端算 / 用定義值,送來的忽略               | 驗算出的結果(必填算成 null 擋) |
| 3    | 沒有欄位級 `edit`(或看不到這欄) | 保留既有值;送來的與既有不同 → 403 整筆拒絕 | 不驗                           |
| 4    | `readonlyWhen` 算出 true        | 保留既有值,送來的忽略                      | 驗既有值                       |
| —    | 一般可填                        | 存送來的值                                 | 全驗                           |

### 條件怎麼算

- 條件以**後端算出的**為準,而且用**最終會存下的值**算:先以「既有值 + 改得動的欄位送來的值」猜一輪分類,之後每輪用上一輪的最終值(隱藏的清空、唯讀與無權的保留既有值、計算欄位重算)重算條件,分類不變為止。被忽略的送入值因此影響不了別欄(送一個會被 `readonlyWhen` 忽略的值,不能把別欄判成隱藏、清掉它的既有值),寫入時的判定也與讀取時以存值重算的 `fieldStates` 一致。
- **被顯示條件隱藏的欄位當 null 算**(明細整欄 null,彙總視為空明細):下游公式讀到被隱藏的計算欄位也是 null。前端即時預覽與後端送出同一套語意(`computeAll` 收 `hidden`、`settleHidden` 收斂條件與計算),所以預覽算出的值 = 送出後存的值;前端只替換計算輸入、不清使用者的值,隱藏再顯示時原值回來。**預設值計算不看顯示條件**(建草稿與填寫時重算兩端一致;被隱藏的欄位每次寫入照樣清空,含存草稿)。

### 「沒動」與存草稿

- 「沒動」的判定比**識別**而不是整個物件:選項比 value(多選比集合、不看順序)、引用比 id、上傳比 path、數字比數值、日期比時點;沒送算沒動;原樣送回 `"[redacted]"` 只有在讀者**真的看不到**這欄時才算沒動,看得到的人送它就是一般的值、照型別驗證。
- **存草稿放寬的只有完成資料所需的驗證**(必填 / 範圍 / 長度 / 格式 / custom / 選項是否還在);守門照常(403、computed 由後端算、隱藏清空),另驗型別與表達式可算。

### 快照與上傳

- 送出與已完成修改時,類別 / lookup 選項與引用**重取 label 寫快照**(引用重驗來源可讀);快照的 label **只取來源的非受保護欄位**(不看送出的人有沒有 show:快照存在非受保護的欄位裡,來源欄位之後改成受保護時,不能把值帶進來)。與上一個已完成修訂相同的值保留原快照(來源停用或刪除不擋整筆修改)。label 重取後再算一次計算欄位,`optionLabel` 看到的是新快照。
- 上傳欄只收本 API 簽出來的 `form/` 路徑(`FORM_ATTACHMENT` 用途,私有 bucket;檔型與大小同示範模組的附件),宣稱的 `contentType` 要與路徑副檔名一致(路徑副檔名由 api 依申報檔型決定),再套**欄位自己的**上限 `rules.accept` / `rules.maxSizeMb`(只能收窄平台上限;平台清單的正本在 api `storage/upload-rules.ts`,`@repo/domain/form` 的 `FORM_UPLOAD_CONTENT_TYPES` / `FORM_UPLOAD_MAX_SIZE_MB` 是它的鏡像,api 測試釘住兩邊一致)。存草稿驗這次換上的新檔;送出 / 已完成修改驗「與上一個已完成修訂不同」的檔(草稿時存下、送出前版本改窄上限的也擋得到;已完成修改時沒換的舊檔不擋)。不符 → `VALIDATION_FAILED` `UPLOAD_INVALID`。欄位上限**只在存草稿與送出兩處驗,不在上傳完成那一步**;大小是前端申報的值,api 不另驗實際檔案大小。

### 預設值與 `touched[]`

- **預設值**(`FieldDef.default`,只有使用者填的欄位):建草稿(`createFormDraft`、`copySubmissionToDraft`)時由後端算一次(`defaults.ts`),只填**沒碰過**(不在 `touched`)、送來 / 複製來的值是空的、操作者**改得動**的欄位;公式引用到操作者讀不到的欄位(含依賴鏈)→ 不算、留空;引用欄的預設值(填寫者 / 填寫者的組織)重驗來源可讀並取 label。複製為新單時複製來的欄位都算碰過(預設值不覆蓋來源值)。預設值填進去之後就是一般的值:照寫入規則走、送出時照 `rules` 驗。
- **`touched[]`**:使用者碰過的欄位 key。`createFormDraft` / `saveFormDraft` 的 `touched`(缺席 = 保留目前存的;只收這一版使用者填的欄位、去重);admin 填寫時沒碰過的欄位依賴變了就重算預設值,碰過就停(只在還沒送出過的草稿;送出過的單不再動)。

### 日期與時區

`date` / `datetime` 兩者都是時點,存 Mongo `Date`(`date` = 選的那天在租戶時區 00:00);`values`、`revisions[].values`、`summary.date` 都是。

- **輸入**:前端送帶時區的 ISO 8601(`YYYY-MM-DD`、不帶時區的字串拒收 `TYPE_INVALID`),值正規化的出口(`form-values/temporal-values.ts`)換成 `Date`;`date` 以租戶時區收斂成當地 00:00。
- **輸出**:讀出來的 `Date` 由 GraphQL `values`(JSON)序列化成 ISO 字串;表達式的語意值也是 ISO 字串(`semanticValueOf`)。lookup `form_submission` 來源的日期值回 ISO、顯示名以讀者的租戶時區格式化。
- **定義裡的日期**:`rules.min` / `max`、表達式常數、`default.value` 是 ISO 字串。`date` 的上下限以租戶時區的當地日期比、`datetime` 以時點比(超出時訊息以租戶時區顯示)。表達式裡的日期常數存 `{ "date": ISO }`(把常數標成日期型別),日期時間常數是 ISO 字串。
- **運算**:比較(`== != < > <= >=`)兩邊都是日期時間時比時點,一邊是日期、一邊是日期時間時換成租戶時區的當地日再比(`compareLocalDay`;付款日 = 今天 14:30 → 相等);`dateAdd(起, before | after, 數量, days | weeks | months | years)` 以租戶時區加減日曆單位(`addLocalCalendar`,月 / 年溢出取該月最後一天),日期起回當地 00:00、日期時間起回時點;`dateDiff` 的 `days` 是租戶時區的當地日期差,`hours` / `minutes` 是時點差。
- 時區來源是讀者當前組織所屬租戶的 `orgs.settings.timezone`(`me.currentOrg.timezone`,沒設或不是 `Intl` 認得的時區 = `Asia/Taipei`;`apps/api/src/database/tenant-timezone.ts`)。換算與格式化的正本是 `packages/domain/src/form/temporal.ts`(`toInstant` / `startOfLocalDay` / `compareLocalDay` / `addLocalCalendar` / `formatTemporal`)。

### 修訂與容量

- `values` / `summary` / `revision` / `revisions[]` / `editVersion` 在**同一次**條件更新寫入(條件含 `editVersion`,已完成修改另含 `revision`)。
- **每筆修訂記自己的版本**(`revisions[].version` = 填寫當時綁的版本):提交的 `version` 只有「舊版資料升級」會改綁,歷史修訂仍用自己的版本渲染;讀取一律 `revisions[r].version ?? submission.version`(沒有這個欄位的舊資料由遷移補成整筆的 `version`)。
- **容量上限**(`form-runtime/revision-limits.ts`):修訂次數只對本租戶綁了流程的表單設上限(`org_form_workflow`;每筆最多 50 筆修訂),沒綁流程的不限次數;所有表單都受**更新後的完整文件**(最新 `values`、全部 `revisions` 與這次要加的快照)BSON 位元組不超過 8MB(Mongo 單筆 16MB 的一半,留給同一次更新的其他欄位)。存草稿、送出(含走流程的再送出)、已完成修改、舊版資料升級在寫入前以 `calculateObjectSize` 估算,搭 `expectedEditVersion` 條件更新(估算後被別人改了,條件更新自然不命中);超過 → `CONFLICT`:筆數 `REVISION_LIMIT`、容量 `DOCUMENT_TOO_LARGE`,什麼都不寫。
- 「複製為新單」只開放給已作廢的提交(`canCopy`,規則見 [workflows](./workflows.md))。

## 明細列

`type: "array"`、`widget.kind: "table"`:一個欄位裝多列同結構的子欄位,存 `[{ rowId, <子欄 key>: 值 }]`(正本 `@repo/domain/form` 的 `array.ts`、`types.ts` 的 `ArrayColumnDef`)。

| 項目     | 規則                                                                                                                                                                                                                                                                                                                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 子欄     | `columns[]` 至少一個;key 同欄位 key 格式、在該明細內唯一;型別與元件白名單:文字(`textField`)、數字(`number`,含 `precision`)、日期(`datePicker`)、日期時間(`dateTimePicker`)、單選(`dropdown`,選項靜態或欄位管理類別)、是否(`checkbox`);規則只收必填、長度 / 數值 / 日期上下限、文字格式 / 正則;值來源只有使用者填或列內公式;沒有子欄級權限、顯示 / 鎖定條件、預設值;`width` 是表格欄最小寬(px) |
| 明細欄   | 規則只收 `required`(= 至少一列,空白列也算)、`minRows` / `maxRows`(非負整數,預設 0 / 100);有效最低列數 `max(minRows, required ? 1 : 0)` 必須 ≤ `maxRows`;沒有值來源 / 預設值 / 鎖定條件;版面固定 12 格                                                                                                                                                                                         |
| 硬上限   | 每版明細欄 ≤ 5、每明細子欄 ≤ 20、`maxRows` ≤ 200(檢查器 + 值正規化;送超過 200 列 → `TYPE_INVALID`);提交大小走修訂容量上限                                                                                                                                                                                                                                                                     |
| `rowId`  | 前端建列時 `crypto.randomUUID()`;UUID 格式、同一明細內不重複,否則 `VALIDATION_FAILED` + `fieldErrors[].code = "ARRAY_ROW_ID_INVALID"`(草稿也擋);修訂之間保留;「複製列」「上方插入一列」與複製為新單(`copySubmissionToDraft`)換新(複製為新單時子欄只留目標版本仍有且型別相同的使用者填子欄);陣列順序 = 列的順序                                                                                |
| 列內公式 | 子欄 `valueSource.kind = "computed"`,`{ "var": "row.<子欄 key>" }` 讀同一列的子欄,也可讀表單層欄位、`ctx.*` 與彙總;`row.*` 只在列內公式合法(`EXPR_ROW_OUT_OF_SCOPE`),不能 `var` 整個明細(`EXPR_ARRAY_REF`)                                                                                                                                                                                    |
| 彙總     | `{ "sumOf": ["items", "subtotal"] }`、`{ "countOf": ["items"] }`、`minOf` / `maxOf` / `avgOf` 同 `sumOf`;參數是字面 key,第二個必須是該明細的 `number` 子欄(`countOf` 只驗明細 key;`EXPR_AGGREGATE_ARG`);讀子欄**取位後**的值、略過空值,`avgOf` 分母 = 有值的筆數;全空或明細為 null(隱藏):`sumOf` 0、`countOf` 列數(null 為 0)、其餘 null                                                      |
| 依賴圖   | 節點 = 表單層欄位 + 每個明細子欄(`items.subtotal`);列內公式引用表單層欄位、彙總引用子欄(`countOf` 引用明細欄本身)、子欄 → 所屬明細都是邊;計算依完整依賴圖拓樸排序(`computeOrder`),每個計算子欄是自己的取位邊界;成圈 = `EXPR_CYCLE`(例:`total = sumOf(items, subtotal)` 且 `subtotal = row.qty × total`)                                                                                       |
| 不可用處 | 明細欄不能當摘要槽、帶入目標、`optionLabel` 參數(`ARRAY_NOT_ALLOWED` / `EXPR_TYPE_MISMATCH`);lookup `form_submission` 的欄位目錄與列表欄位配置不收明細欄(列表配置引用明細欄 → 警告 `LIST_COLUMN_ARRAY`)                                                                                                                                                                                       |

- **寫入規則**:明細整欄先套「不能填的四種原因」,子欄繼承整欄的分類、不獨立判:顯示條件不成立 → 整欄 null、不算不驗;沒有 `edit`(或看不到)→ 送來的列集合(`rowId` 與順序)或 input 子欄和既有不同 → 403 `FIELD_FORBIDDEN`,沒送 = 保留;保留的列其列內公式子欄仍由後端重算。處理順序:型別正規化 → 合併允許保留的既有值 → 依完整依賴圖重算與判條件 → 分類 → 整欄需驗時驗列數與每一格(input 子欄驗送來的值、列內公式子欄驗算出的結果)→ 存。除以零 / 空值 → 那一格 null(由子欄規則決定能否送出)。錯誤定位 `fieldErrors[] = { fieldKey: 明細 key, rowId, columnKey, code, message }`,列數不足 / 超過(`REQUIRED` / `MIN_ROWS` / `MAX_ROWS`)只有 `fieldKey`;任一格失敗整筆不存。
- **保護傳遞**:欄位級 `show` / `edit` 套整個明細欄;任一子欄的列內公式直接或間接引用受保護欄位 → 整個明細欄沿依賴鏈受保護(讀取投影、修訂遮蔽、條件檢查同一套),彙總它的計算欄位也受保護(`computedDependenciesOf` 把明細欄的依賴算成它所有列內公式引用的表單層欄位)。
- **送出 / 修改的快照**:單選子欄重驗(靜態清單要啟用中、類別重取 label 寫 `{ value, label }`),同一列同值保留原快照;日期 / 日期時間子欄存 Mongo `Date`。
- **執行端查詢**:`formFieldOptions` 的 `fieldKey` 可以是 `<明細 key>.<子欄 key>`(只收一段或兩段;權限看整個明細欄);`displayValues` 以同樣的 key 回類別子欄的現名(各列的值合在一組)。
- **修訂差異**以 `rowId` 對列(`arrayRowChanges`),標示新增 / 刪除 / 移動 / 改值;「移動」只標真正被搬的列(兩版共有的列取前一版順序的最長遞增子序列當作沒動,`[a, b, c] → [c, a, b]` 只有 c 是移動)。
- admin 的表格元件與設計器見下方「admin 頁面」。

## 舊版資料升級

`form-runtime/form-upgrade.service.ts`;搬值與補值欄位在 `@repo/domain/form` 的 `upgrade.ts`。**升級 = 改綁版本 + 補值 + 重算,不驗證**;只限本租戶沒綁流程的表單。

- **入口**:版本面板「已發布」的那一版的「將舊版資料升級到此版」;看的是表單所屬模組的 `edit`(不是表單設計的權限)。本租戶綁了流程時不顯示按鈕、版本清單上方改一行提示。
- **守門順序**:表單讀得到(設計端,`requireReadableForm`)→ 模組 `edit` → 目標版已發布(否則 `CONFLICT` `VERSION_NOT_PUBLISHED`)→ 本租戶沒綁流程(否則 `CONFLICT` `FORM_HAS_WORKFLOW`)。
- **範圍**:操作者看得到(可見範圍 + 資料範圍)、本租戶的資料(root 站在根組織 = 根組織自己的,`tenantId = null`)、狀態 `draft` 與**沒走過流程**的 `completed`(`currentInstanceId = null`;走過流程的已完成鎖定、不動)、`version` 不是目標版。草稿包含別人的草稿(資料範圍內)。
- **搬值**(`upgradeValues`,與「複製為新單」共用):目標版的使用者填欄位,來源版有同 key 同型別的就保留值;明細列逐子欄同規則(`rowId` 保留);目標版沒有的、型別變了的丟掉(歷史修訂的快照留著)。**補值**只填搬完後沒有值的欄位,已有值不覆蓋。
- **補值欄位**(`upgradeFillTargets`,再篩操作者改得動的):必填的使用者填欄位 ∪ 對到摘要槽的欄位 ∪ 目標版新增的欄位(任一來源版沒有同 key 同型別的);明細列、上傳、引用不列入。前端依型別呈現輸入框(`TypedValueInput`,選項查目標版的定義);api 照型別正規化,單選 / 多選再重取選項 label 寫快照、驗選項存在(每欄一次;`SubmissionValuesService.snapshotChoices`),不合法 → `VALIDATION_FAILED` + `fieldErrors`。不是目標版使用者填欄位的鍵 → `VALIDATION_FAILED`(`fills`);是目標版的使用者填欄位、但不在這一刻的補值清單內(查計畫之後清單變了、或操作者改不動)→ 忽略。
- **逐筆**(每批 200 筆,先取 id 再逐筆讀完整文件):搬值 + 補值 → settle 重算計算欄位(隱藏欄位當 null;草稿模式 = 只驗型別,不驗規則)→ 已完成重算摘要、修訂 +1(`version` = 目標版、`kind: "upgrade"`、`ctx` 沿用上一筆修訂、另記 `upgradedBy` / `upgradedAt` = 操作者與升級時間)→ 改綁 `version`;草稿只改綁與重算(草稿沒有修訂),並把 `touched` 篩成目標版仍有的使用者填欄位。條件更新帶讀到的 `editVersion`、`version`、狀態;還沒有 `version` 的舊修訂在同一次更新補成改綁前的版本(這時整個 `revisions` 換掉,平常是 `$push`)。
- **重算用那筆資料自己的上下文,不是操作者此刻**:已完成 = 最後一筆修訂的 `ctx`;草稿(沒有修訂)= 建立者、建立時間、資料歸屬組織與本租戶時區。所以引用 `ctx.user.*` / `ctx.now` 的計算欄位與條件升級前後不變(不會因為換成升級者的身分把欄位判成隱藏而清空)。修訂紀錄那一列印「<升級者> 於 <升級時間> 升級到第 N 版」(取 `upgradedBy` / `upgradedAt`,不是 ctx)。
- **不驗證**:升級後不符新版規則的已完成資料,使用者下次編輯送出時才被擋、當場補。
- **跳過並計數**:條件更新沒命中(被別人同時改,`EDIT_CONFLICT`)、加上升級修訂後超過容量(`DOCUMENT_TOO_LARGE`)、存值在目標版算不出來(`VALUES_INVALID`)。沒綁流程的表單不限修訂次數,所以不會因次數跳過。
- **冪等**:已是目標版的不在範圍內,重跑只處理剩下的;守門之後,同一張表單、同 `(操作者, clientRequestId)` 重送回第一次記下的結果(查稽核 `submission.upgrade`,條件 `{ targetType: "form", targetId, action, actorId, after.clientRequestId }` 走 `{ targetType, targetId }` 索引);拿同一個 id 升級這張表單的另一版 → `CONFLICT` `CLIENT_REQUEST_REUSED`。**重送只保證資料不重複處理,結果不保證與當下的資料相同**(第一次之後別人改的、新進的舊版資料不反映;要處理就用新的 id 再升級一次)。
- **量級**:`upgradeFormSubmissions` 是同步 mutation,整個升級在一次請求裡跑完(逐筆讀寫)。預期是幾百到幾千筆;**上萬筆建議分次做**(例如請操作者重按,已升級的不會重複處理),避免請求逾時。
- **回傳**:`upgraded: [{ fromVersion, count }]`、`skipped: [{ reason, count }]`;稽核一筆 `submission.upgrade`(筆數,不逐筆、不記值)。

## 讀取投影

`form-values/field-states.ts`、`field-permission-gate.ts`。

- 讀者沒有 `show` 的受保護欄位 → `"[redacted]"`。計算欄位的讀取資格 = 自己的 `show`(若設)**且**沿依賴鏈引用到的每個受保護欄位的 `show`(`fieldProtections`;只因依賴而受保護的欄位不另建權限)。
- 權限判斷是 **mapper 規則,不走 `hasPermission`**:有效權限集合裡要有那一個具體 key(`PermissionResolver` 已把模組 `*` 展開成存在且啟用的權限,所以持 `*` 的人自動涵蓋);權限列被刪 → 對所有人視為無權,只有超級管理員看得到,模組 `*` 不放行。
- **列表與詳情不載入全部修訂**:`formSubmissions` / `formSubmission` 的投影只取最後一筆修訂(`{ revisions: { $slice: -1 } }`,它的 `ctx` 是目前的條件上下文);讀某個修訂時只多取那一筆(`$elemMatch`)。修訂紀錄清單是 `FormSubmissionModel.revisions` 的 field resolver,只有修訂紀錄跳窗問才查,只取 metadata(`revisions.values` 不載入)。寫入路徑(容量估算)照讀完整文件。
- **修訂用自己的版本渲染**:`formSubmission(id, revision)` 的 `viewedVersion` = 那個修訂的 `revisions[r].version ?? version`,欄位投影、`fieldStates`、顯示名都用它的定義;修訂紀錄每筆帶 `version` 與 `kind`(`upgrade`)。admin 的詳情、修訂紀錄與修訂差異各用各的版本定義(差異的欄位 = 這一修訂的版本 + 只在前一修訂版本有的欄位)。
- 唯讀讀取**不重算、不清空**存值;`fieldStates` 的顯示 / 唯讀條件用**該修訂的 `ctx`**(`at` / `timezone` / `userId` / `orgId`)重算,不拿讀者現在的身分或時間補值;草稿用現在與建立者本人。
- **建立者一律讀得到自己的單**:單筆讀取在一般路徑(可見範圍 + 資料範圍規則)讀不到時,改走 `BaseRepository.findOwnById`(可見範圍照套、不套資料範圍規則、條件加 `createdBy = 操作者`);列表不放寬。草稿只屬於建立者(別人的草稿不列、讀不到)。
- **定義也依讀者投影**(`formRuntimeVersion`,`form-runtime/definition-projection.ts`,判準同一支 `canShow`):讀得到的欄位照回;讀不到的(沒有自己的 `show`,或計算欄位沿依賴鏈引用到沒有 `show` 的受保護欄位)只回骨架 `{ key, label, type, widget: { kind }, valueSource: { kind }, permission, redacted: true }` —— `constant.value`、計算公式(可能內嵌常數)、`options`、`rules`、`help`、條件、引用來源一律省略(骨架的 `expr` / `value` 為 `null`)。設計端的 `formVersion` / `formVersions` 不投影(設計者本來就要看全部)。`layout`、`summaryMap`、`prefills` 不投影:它們只列欄位 key,不含受保護欄位的內容;帶入時寫不寫得進該欄由 `canEdit` 擋,來源值經 `formLookup` 依欄位權限省略。
- 顯示名(現名 vs 快照)在 `form-runtime/display-names.service.ts` **批次**解析:整頁的值先依來源分組,每個類別、每個 lookup 來源各查一次(DataLoader 的做法,不逐列查)。

## 欄位管理類別選項

`formFieldOptions`(`form-runtime/form-field-options.service.ts`):選項欄(`options.kind = "fieldCategory"`)給填寫者取當前選項,**不需要** `system.field-manager.view`。前端只帶 `{ formKey, version, fieldKey }`,類別 key 從版本定義取(與 `formLookup` 同一原則);範圍是 `FieldCategoryOptionsService` 的合併範圍(送出時驗值、顯示名解析用的同一支),只回啟用的選項,依欄位管理的排序值、建立順序排。類別本身停用不影響這裡:既有欄位用到它照常查。

| 情況                                                  | 回什麼                                                 |
| ----------------------------------------------------- | ------------------------------------------------------ |
| 表單不存在、別租戶的客製表單、版本不是已發布 / 已退役 | `NOT_FOUND`                                            |
| 沒有該模組 `view` / `create` / `edit` 任一            | `FORBIDDEN`(無 reason,同 `formRuntimeVersion`)         |
| 欄位不存在或不是類別選項                              | `VALIDATION_FAILED`(`fields: ["fieldKey"]`)            |
| 讀者讀不到這一欄(受保護欄位沒有 `show`)               | `FORBIDDEN`(無 reason;先於欄位種類判,不透露 `options`) |
| `version` 省略(設計器預覽草稿)                        | 要 `system.forms.view` 且讀得到這張表單;不套欄位級權限 |

「表單可用」取執行端的邊界(共用表單或本租戶客製表單,`findRuntimeForm`),**不**要求表單此刻可新增:租戶停用或收回分派後,既有的草稿 / 已完成的單仍可存、可修改,選項也要拿得到。

## lookup 登錄表

`apps/api/src/forms/lookup-providers.ts`(底座三種)+ 專案登記的來源(下方「專案登記的來源」)。帶入、引用、lookup 選項都用這一張;執行時 provider 與 `filter` 一律從**版本定義**取,前端只帶 `{ formKey, version, target }` + 關鍵字。目標是欄位(lookup 選項欄 / 引用欄)時,讀者還要讀得到那一欄:受保護欄位沒有 `show` → `FORBIDDEN`(先於「有沒有 lookup 來源」判,不從錯誤碼透露定義;草稿預覽不套)。

| provider          | 可回的欄位                                          | 讀欄位要的權限                                                                    | 可當 `filter` | 範圍                                                           |
| ----------------- | --------------------------------------------------- | --------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------- |
| `user`            | `name`、`account`、`email`                          | `account` / `email` 要 `system.user-manager.view`(以它們當 `valueField` 反查也要) | `enabled`     | 可見範圍內組織的成員(根組織不限)                               |
| `org`             | `name`、`slug`                                      | —                                                                                 | `enabled`     | 可見範圍內的組織                                               |
| `form_submission` | 摘要槽(`title` / `date` / `amount`)+ 那張表單的欄位 | 受保護欄位要該表單該欄的 `show`                                                   | —             | 來源表單所屬模組的 `view` + 可見範圍 / 資料範圍;預設只列已完成 |

- `form_submission` 來源回每一筆時,欄位依**那筆自己綁的版本**判斷:存在且非受保護 → 語意值(選項 / 引用另附 label);存在但受保護且沒有 `show` → **省略**;那一版沒有這個欄位 → `null`。
- 設計時的欄位目錄 = 來源表單目前版本的非受保護欄位 + 摘要槽;檢查器以它驗 `labelField` / `valueField` / 帶入的來源欄位,以及 `labelTemplate` 的佔位符。**帶入規則**的來源是這張表單自己(從本表單先前的提交帶入)時用**這份草稿**的欄位(還沒發布也行,`form-definition-checker.ts`);選項 / 引用來源指到自己照一般規則(已發布版的欄位目錄);執行時照一般規則以那筆提交綁的版本判斷。
- 設計器的來源清單是 `formLookupProviders`(`system.forms.view`;`form-design/lookup-providers.resolver.ts`):底座三種在前、專案來源依 key 排,回宣告的名稱、欄位(型別與專案宣告的欄位名)、可當 `filter` 的欄位、預設顯示欄與值欄,不回權限與執行面。底座來源的名稱與欄位名由前端 i18n 顯示;來源有宣告 `enabled` 可當 `filter` 才出現「只列啟用中的」。
- **新增底座來源**:`LOOKUP_PROVIDERS` 加宣告 → `LookupProvidersService.providerFor` 加實作(搜尋與依值取回都要套操作者的範圍)→ 本表補一列。

### 專案登記的來源

專案在固定入口 `apps/api/src/project/lookup-providers.ts` 列 `{ declaration, repositoryToken }`(與 `project/database/registrations.ts` 同一種靜態清單;契約在 `apps/api/src/forms/lookup-provider-registration.ts`)。清單只由 `database/database.module.ts` 組裝並以 `PROJECT_LOOKUP_SOURCES` 提供,api 與受管定義 CLI(`seed/seed-runtime.module.ts`)拿到同一份;`LookupProvidersService` 啟動時以 `ModuleRef` 取 repository 實例並驗證。檢查器的登錄表(`LookupProviderRegistry`)、設計器來源清單、`formLookup` / 引用重驗 / 現名解析都含專案來源。

| 項目              | 規則                                                                                                                                                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| key               | 底座來源不加前綴;專案來源一律 `<前綴>_<名稱>`(小寫英數與底線),前綴 = repository 所綁資料表名的第一段(`lottery_game` ↔ `lottery_games`)。與底座撞名、專案之間重複、格式或前綴不合 → 啟動丟 `LookupProviderRegistrationError`,app 起不來                                                               |
| `declaration`     | `name`、`permission`(必填:讀這個來源要的權限,例該模組 `view`,沒有 → 查無;`null` = 在可見範圍內公開)、`fields`(型別、讀該欄要的權限、設計器顯示的欄位名)、`filterFields`、`labelField`(預設顯示欄)、`valueField`(預設值欄,省略 = `id`)、`keywordFields`(省略 = 只比 `labelField`)。欄位名即文件欄位名 |
| `repositoryToken` | 必須是專案資料登記裡的 repository(`project/database/registrations.ts`);拿底座的(如 `UsersRepository`)→ 組裝時丟 `DatabaseRegistrationError`,app 起不來。實例另以 `instanceof BaseRepository` 驗                                                                                                      |
| 範圍              | 搜尋與依值取回由底座固定呼叫 `BaseRepository` 的 `findMany` / `count`:租戶隔離、可見範圍、軟刪除由 plugin 套,資料範圍規則只對 `moduleData: true` 的表生效;專案沒有自訂查詢的接縫,放寬不了                                                                                                            |
| 欄位權限          | 同 `user`:讀不到的欄位省略、不拿它比關鍵字(關鍵字欄位全讀不到時打關鍵字 → 查無);以它當值欄反查也要讀得到;寫進提交的快照用 `publicOnly`(帶權限的欄位一律省略)                                                                                                                                         |
| 值欄              | 非 `id` 時只能是文字欄位(依值取回以字串等值比對):宣告的預設值欄在啟動時驗,定義裡的 `valueField` 由檢查器擋(`LOOKUP_UNKNOWN_FIELD`),設計器的值欄下拉也只列文字欄位                                                                                                                                    |

驗收夾具:`apps/api/src/test-support/project-fixture/project-fixture-lookup.ts`(`project_fixture_item`、`project_fixture_code`,只存在於測試,測試以它頂替 `project/lookup-providers.ts`)。

### 顯示模板 `labelTemplate`

來源描述的選填欄位。有值時顯示名由 api 組好回傳(`lookupDisplayLabelOf`;`formLookup` / `formLookupRecord` 的 `label`、引用與 lookup 選項寫進提交的快照 label、現名解析都走它),沒填、或套出來是空的 → 用 `labelField`。

- 每個佔位符取該欄的顯示名(日期 / 日期時間依**讀者**租戶時區格式化、選項 / 引用印 label);那版沒有的欄位換空字串。
- **模板引用的欄位只要有一個讀不到**(依這次讀取的權限被省略,例 `user` 的 `email` 沒有 `system.user-manager.view`)→ 整串退回 `labelField`,不拼接、不留符號(`{{name}}({{email}})` 對沒權限的人顯示「王小明」)。三處一致:`formLookup`(操作者權限)、引用 / lookup 選項寫進提交的快照(固定 `publicOnly`,所以帶權限的欄位一律退回)、現名解析(讀者權限)。
- 佔位符對不到 provider 可回的欄位 → 檢查器錯誤 `LOOKUP_TEMPLATE_UNKNOWN_PLACEHOLDER`(定位 `…source.labelTemplate`);`form_submission` 的 `{{value.<key>}}` 另由 api 精確到該表單目前版本的非受保護欄位。佔位符正本是 `@repo/domain/form` 的 `lookupTemplateFieldOf`:

| provider          | 佔位符                                                                     |
| ----------------- | -------------------------------------------------------------------------- |
| `user`            | `{{name}}`、`{{account}}`、`{{email}}`、`{{id}}`                           |
| `org`             | `{{name}}`、`{{slug}}`、`{{id}}`                                           |
| `form_submission` | 摘要槽 `{{title}}` / `{{date}}` / `{{amount}}`、欄位 `{{value.<欄位key>}}` |

## 列表欄位配置

`modules.settings.list = { columns: [ { kind: "slot" | "field", key, formKey?, width, order } ], builtin: { form, status, createdBy } }`,root 整份覆蓋(`setModuleListColumns`,`form-design/module-list-columns.service.ts`)。

- 寫入時驗:摘要槽 key 只能是 `title` / `date` / `amount`;表單欄位要存在於該模組**共用表單**目前版本,且在那些版本裡都**不是受保護欄位**(`formKey` 給了就只看那一張,沒給就看模組內全部);欄寬 40–2000;同一欄不能重複;`builtin` 三個鍵都要是 boolean。空陣列 = 清掉配置、回前端預設欄。
- 定義檢查器讀它出 `LIST_COLUMN_MISSING` 警告;表單改版後引用到不存在的欄位不自動清,前端顯示「—」。
- `builtin`:內建欄「表單 / 狀態 / 建立者」各自顯不顯示;沒存過(或某個鍵不是 boolean)= 顯示(`listBuiltinColumnsOf`)。
- 表單欄位欄的表頭讀該表單**目前版本**的定義(`moduleForms` 的 `currentVersion`;沒有資料列也顯示欄位名,欄位沒限定表單時取第一張有該欄位的),找不到再看這一頁資料列綁的版本,最後才顯示 key。

## 頁籤 / 標題模板

`lib/base/form-engine/tab-label.ts` 的 `renderTabLabel`:表單的 `tabLabelTemplate` 有值用它,否則用模組層模板(`ModulePageSource.forms[].options.tabLabelTemplate`,預設 `{{title}}`)。**前端從那筆資料的值即時算**,不讀後端存的 `summary`:摘要槽依那筆綁的版本 `summaryMap` 對到欄位取值;新增 / 編輯頁用正在輸入的值(`FormFillForm` 的 `tabLabelOf`),所以草稿也算得出來。api 對模板只做 trim、空字串存 `null`,不驗佔位符。

模組 options 與四頁共用一筆來源:底座在 `app/base/module-pages.ts`,專案在 `app/project/module-pages.ts`。`lib/base/form-engine/form-module-options.ts` 的 `composeFormModuleOptions` 合成唯讀設定表,`app/providers/RootProviders.tsx` 經 `FormModuleOptionsProvider` 注入;context 與 hook 同檔在 `hooks/base/useFormModuleOptions.ts`,Provider 在 `app/providers/FormModuleOptionsProvider.tsx`。有 Provider 但缺該 key 時回預設,缺 Provider 則報接線錯誤。`formModulePages(moduleKey)` 只產生預設頁,不接收 options 或修改全域 Map。

| 佔位符                                  | 值                                                                    |
| --------------------------------------- | --------------------------------------------------------------------- |
| `{{title}}` / `{{date}}` / `{{amount}}` | 摘要槽對到的欄位值;`{{date}}` 沒對欄位時 = 送出時間(草稿沒有 → 空)    |
| `{{value.<欄位key>}}`                   | 該欄位的值                                                            |
| `{{applicant}}`                         | 建立者現名(`createdBy.name`;新增頁 = 自己)                            |
| `{{form}}` / `{{module}}`               | 表單名 / 模組名                                                       |
| `{{action}}`                            | 頁面種類:檢視 / 編輯 / 新增;**模板沒寫時自動加在最前面**,以「・」分隔 |

- 值的格式化同 `templateTextOf`:選項 / 引用印 label、日期 / 日期時間 `formatTemporal`(讀者現在的租戶時區)、數字照 `precision`、是 / 否印文字、讀不到(`"[redacted]"`)為空。套出來是空的退回表單名。
- 表單模組新增 / 編輯 / 檢視頁與申請中心詳情頁都走 `components/base/form-engine/FormModulePages/useTabLabelRenderer.ts`(版本定義或 `moduleForms` 載到前回 null,頁籤維持模組名;自動加的頁面種類以字典 `admin.formEngine.pages.tabLabelWithAction` 組);刪除確認的「這一筆」用同一個算法但不加頁面種類。

## 退役權限清理

「模組與權限」頁(根組織專屬)。`retiredFormPermissions` 列出 `source: dynamic` 且 `retiredAt` 有值的權限與使用狀況;`deleteRetiredPermission` 三層檢查:

1. 有還會再寫的提交(草稿、審核中、被退回、已撤回)用到宣告該欄位的版本 → 擋下(`USED_BY_DRAFTS`,附筆數與版本)。
2. 只剩終局的提交(已完成、已駁回、已作廢)用到 → 要 `confirmCompletedUsage: true` 才刪(`CONFIRM_REQUIRED`);刪後這些單裡的該欄位只有超級管理員看得到。
3. 沒有任何提交用到 → 直接刪。

- 計數**跨全部租戶**且不受操作者的可見範圍 / 資料範圍影響(`database/form-submission-usage.ts`;少算一筆草稿就會把還在用的權限刪掉)。
- 一筆提交「用到」某版本 = 目前綁的 `version` 是它,**或任一修訂的 `revisions[].version` 是它**:升級到新版的單,舊修訂仍以舊版定義渲染,舊版欄位的權限刪掉後那一欄在舊修訂裡就只剩超級管理員看得到。計數是提交筆數,同一筆提交用到好幾個宣告該欄位的版本也只算一次;草稿 / 終局的分類看提交目前的狀態。
- 刪的順序:先寫稽核 → 刪權限列 → 解除全部 `role_permission` 綁定(硬刪:權限 key 唯一,軟刪的殭屍會擋住日後同一欄位重新發布時建回同一個 key);每一步重做都無害,中途失敗殘留的綁定指向不存在的權限列、不生效。
- **檢查使用量到真的刪之間沒有鎖**:這段時間有人新建草稿綁到宣告該欄位的版本,那筆草稿的該欄位之後只有超級管理員看得到。
- 權限矩陣與模組樹不列退役的權限;角色對退役權限的既有綁定保留(矩陣只認得它列出的 key,不會因此被清掉)。
- **權限矩陣的租戶邊界**(`roles/role-matrix.service.ts`,判斷沿用 `permission/foreign-form-permissions.ts`):表單動態權限依 key 拆出 formKey,只列共用表單與操作者自己租戶的客製表單的那幾筆(根組織操作者只看得到共用表單的);存檔時送了別租戶(或已不存在的)表單的動態權限 → `ROLE_OUT_OF_REACH`。持模組 `*` 的角色在解析時同樣剔除別租戶的那幾筆,`me.modules` 不會帶出別租戶的 formKey 與欄位 key。
- 清理只認欄位級權限(`parseFieldPermissionKey`):依表單新增權限 `create-<formKey>` 不列出;對它呼叫 `deleteRetiredPermission` → `NOT_DYNAMIC`。

## admin 頁面

### 表單管理(`system.forms`)

`apps/admin/src/pages/base/system/FormsPage/`。左清單、右面板;內容區最小寬度 `xl`(三欄設計器窄了會擠壞,在 `app/base/module-pages.ts` 的頁面宣告設定 `minWidth`,組裝為 `modulePageMinWidths` 交給殼)。客製替換未指定寬度時保留這個值。

| 畫面                   | 做什麼                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 表單清單               | 搜尋;每列名稱、key、模組、共用 / 客製、目前版本或「無發布版本」、停用、發布中斷、有草稿、綁的流程 / 「綁定的流程已失效」;「+ 建立表單」只在站在根組織 + `system.forms.create` 時出現(建共用表單;api 對租戶回 `ROOT_ONLY`)                                                                               |
| 右側標頭               | 「編輯名稱與標題」(`abilities.canEdit`)、「以此為基底建新表單」(`canFork`)、「分派租戶」(`canAssign`)、「列表欄位配置」(站在根組織 + `system.forms.edit`;與「模組與權限」共用 `pages/base/system/ListColumnsDialog/`,編輯器頂端註明「此設定影響整個模組的列表」)、「在本組織啟用」開關(`canSetEnabled`) |
| 流程綁定(右側標頭下)   | 租戶視角 + `system.forms.edit`:這張表單送出後走哪個流程(`pages/base/system/FormsPage/WorkflowBinding/`,規則見 [workflows「流程綁定」](./workflows.md))                                                                                                                                                  |
| 表單設計(頁籤)         | 元件面板 / 畫布 / 屬性面板 / JSON 預覽 / 檢查結果;見下方「設計器」                                                                                                                                                                                                                                      |
| 表單版本(頁籤)         | 見下方「版本面板」                                                                                                                                                                                                                                                                                      |
| 分派跳窗               | 勾租戶 = 分派、取消勾 = 收回(只有平台)                                                                                                                                                                                                                                                                  |
| 以此為基底建新表單跳窗 | 選基底版本、填 key(建立後不可改)與名稱;建好帶一份以該版本為基底的草稿                                                                                                                                                                                                                                   |
| 編輯名稱與標題跳窗     | 名稱與頁籤模板;模板下方列出可用佔位符,「插入欄位的值」下拉挑欄位插入 `{{value.<key>}}`(欄位取目前版本,沒發布過取草稿),並即時顯示以範例資料套用的結果(留空以預設模板示範)                                                                                                                                |

**版本面板**:草稿與各版本、發布(changelog 必填)、發布中斷時「重試發布」、退役目前版本、刪除草稿(確認跳窗,帶讀到的 `draftRevision`;發布中不可)、與上一版差異、以任一版本為基底開新草稿、「將舊版資料升級到此版」(已發布的版本;三步跳窗:各舊版本筆數 + 補值 → 確認 → 結果)。已發布 / 已退役版本的「檢視」把設計頁籤換成唯讀設計器(`FormDesigner/VersionViewer.tsx`:`formVersion(formKey, version)`,設計模式照樣標示、不能改不能存,「預覽」只在前端算,旁邊「以此為基底開新草稿」;草稿的設計器照樣掛著)。

目前共用發布版另提供「匯出專案設定」,開啟共用 `SeedExportDialog` 填寫版本識別與發布說明;條件與下載內容見[匯出專案設定](#匯出專案設定)。

**未存的變更不會無聲消失**:「表單設計 / 表單版本」兩頁籤都保持掛載;有未存變更時換表單先跳窗(留在設計 / 放棄變更 / 先存草稿);發布跳窗提示「發布的是上次存的草稿」並提供先存(狀態經 `stores/base/useDesignerDraftStore.ts`)。存草稿 / 發布收到 `CONFLICT` → 「草稿已被別人更新,請重新載入」。

### 設計器

- **畫布**:`FormRenderer` 設計模式,dnd-kit 拖拉;計算 / 固定值欄位畫成有框的唯讀輸入框,是 / 否欄位標題在元件前面。沒選欄位時右側是「表單設定」(摘要槽、帶入規則)。「預覽」切 `preview` 模式(即時跑條件與計算,「以後端重算」後以 `previewFormVersion` 回的值與顯示 / 唯讀為準)。
- **欄位身分**:設計器內部以**穩定的內部 id**(`_id`)當欄位身分,`key` 只是資料:載入草稿時配 id、存草稿 / JSON 預覽 / 預覽時丟掉(`lib/base/form-engine/design-definition.ts`);選取、拖拉、改屬性、刪除都以 id 找欄位(`designer-ops.ts`),所以舊草稿 key 重複也刪得掉、不會改錯欄。改 key 當場擋格式、保留字與重複(輸入框標紅、不寫入),不等檢查器。
- **屬性面板依型別只出現該有的設定**(`lib/base/form-engine/property-sections.ts`):上傳 / 引用欄位不顯示值來源;值來源是公式 / 固定值時隱藏鎖定條件、預設值、允許清單外的值(改成公式 / 固定值時定義裡的預設值一併拿掉);元件下拉只在有兩種以上畫法時出現,多行文字有列數、數字有單位;驗證規則裡上傳有「允許的檔型 / 大小上限(MB)」(`rules.accept` / `rules.maxSizeMb`,`lib/base/form-engine/upload-types.ts`,全勾 = 不存 `accept`);日期與日期時間有上下限(以租戶時區輸入、存 ISO;日期時間兩格直排)。是 / 否欄位的必填 = 必須勾選(`false` 與沒填都算沒勾,判準 `requiredIssueOf`;填寫頁標題帶必填記號)。自訂驗證可填錯誤訊息(`rules.customMessage`)。欄位級權限是兩個勾選:「受保護(要權限才看得到)」「限定可改(要權限才能改)」。
- **值的輸入元件**一律用 `components/base/form-engine/TypedValueInput/`(固定值、預設值、日期上下限、表達式常數共用):文字 / 數字打字、是 / 否下拉、日期 → 日期選擇器(存租戶時區當地 00:00 的 ISO)、日期時間 → 日期時間選擇器、單選 / 多選從該欄位的選項挑(靜態下拉;類別 / 資料來源用填寫時的選擇器),存正確型別(是 / 否是布林、多選是陣列、日期是 ISO);表達式常數的形狀是語意值(選項只存 value、數字存 number)。值來源「固定值」存進 `valueSource.value`,計算時照欄位型別正規化(型別不對 → null,檢查器先以 `CONSTANT_VALUE_INVALID` 擋發布)。已停用的靜態選項若是目前的值仍列出並標「已停用」;類別 / 資料來源選項以**已存的草稿**查詢(先存草稿才挑得到)。
- **預設值**編輯器(`FormDesigner/PropertyPanel/DefaultValueEditor.tsx`,種類正本 `defaultKindsOf`):文字 / 多行 / 數字 / 日期 / 日期時間 = 不設 / 固定值 / 公式(公式用型別導向選擇器,根 = 欄位型別、不列自己);單選 / 多選從選項挑;是否 = 是 / 否;引用只列「填寫者 / 填寫者的組織」。
- **類別、表單、欄位都用下拉選**:類別從啟用中的 `fieldCategories` 挑;lookup 來源「表單提交」的表單從 `forms` 挑(看得到且有已發布版本;帶入規則另列這張表單自己,即使還沒發布,欄位目錄用目前草稿的欄位),顯示欄 / 值欄 / 帶入的來源欄位從該表單目前版本的非受保護欄位 + 摘要槽挑(`FormDesigner/PropertyPanel/useLookupCatalog.ts`,與 api 的欄位目錄同一判準)。lookup 來源的設定照填表順序排:來源 → 表單(表單提交才有)→ 顯示欄(表單提交預設標題槽)→ 顯示模板(選填;文字框 + 「插入欄位」下拉,`FormDesigner/PropertyPanel/LookupLabelTemplateInput.tsx`;清空 = 拿掉 `labelTemplate`)→ 固定條件(使用者 / 組織「只列啟用中的」= `filter.enabled`;表單提交「只列已完成的提交」= `completedOnly`)→ 值欄(只有選項來源);帶入規則在前面多「規則名稱」、後面接對應表(本表單欄位只列使用者填的 ← 來源欄位只列 `isPrefillCompatible` 相容的)。
- **表達式**一律用**型別導向的結構化選擇器**(欄位 / 系統值 / 常數 / 運算,可巢狀),不做文字輸入:每個位置帶期望型別往下傳,只列型別對得上的東西(型別表正本 `expression-types.ts`,過濾在 `lib/base/form-engine/expression-options.ts`)。公式的根 = 欄位型別;條件(顯示 / 鎖定條件、自訂驗證、流程跳過條件)的根 = 是 / 否,常數與系統值不能單獨當條件的根;條件不列受保護欄位。鎖定條件與自訂驗證可引用自己(「超過 5 就鎖住」),顯示條件不可。`dateDiff` 有單位下拉(天 / 小時 / 分鐘,預設天);`dateAdd` 的方向(之前 / 之後)與單位(天 / 週 / 月 / 年)是下拉、數量是數字位置。還沒選的參數是空位「請選節點種類」(JSON 是 `null`;比較的參數選了之後可用「清空(= 空值)」回到空位),條件位置(`if` 第一格、且 / 或 / 非的參數)預設放「等於」比較,且 / 或的加參數鈕叫「+ 條件」;巢狀的運算畫成帶框縮排群組、標頭是運算子名(`ExpressionPicker/ExpressionGroup.tsx`)。常數種類有文字 / 數字 / 是否 / 日期 / 日期時間 / 清單;位置有**目標選項欄**時(選項欄公式、和選項欄比較或 `in` 的另一邊)常數改從它的選項挑(清單 = 多選挑)。
- **明細列**:屬性面板的「子欄位」清單(`PropertyPanel/ArrayColumnsEditor/`),點一個子欄整個面板換成它的縮小版(只列白名單內的設定,key 當場擋格式與同明細重複);列內公式的選擇器把同一列的其他子欄列成「本列・<標題>」(`row.<key>`);彙總的明細欄 / 數字子欄是下拉。
- **刪被引用的欄位**:先列出草稿內引用它的表達式、摘要槽、帶入規則,以及草稿外的列表欄位配置(只提示);確認後只從草稿的 `fields[]` / `layout` 移除,引用處變成檢查器錯誤。刪分區二選一:欄位移到「未放置」或連同欄位刪除。

### 模組與權限(`system.module-manager`)

- 表單模組(`engine: FORM`)的右面板多一塊**列表欄位配置**(`setModuleListColumns`,`system.forms.edit` + 站在根組織):選摘要槽或表單欄位、排序、欄寬,加內建欄「表單 / 狀態 / 建立者」各一個顯示開關。
- 頁首「退役權限清理」(`system.module-manager.delete-retired-permission`):列 `retiredFormPermissions`(顯示權限 `name`、表單、欄位、使用筆數),刪除走三層檢查:`USED_BY_DRAFTS` 顯示筆數與版本、`CONFIRM_REQUIRED` 先確認再帶 `confirmCompletedUsage: true`。

### 引擎零件與填寫頁

專案表單模組在 `app/project/module-pages.ts` 的 `forms` 新增一筆,預設展開列表、檢視、新增、編輯四頁;單頁客製用 `pageOverrides` 的 `list` / `viewPage` / `createPage` / `editPage`,元件放 `pages/project/`。若是替換底座已登記的頁,改用 `app/project/page-replacements.ts`,保留底座原檔、宣告及模組 options;移除替換就回到原版。頁面登記不替使用者授權,也不改表單執行端點。型別、碰撞檢查與完整範例見[前端架構](../concepts/frontend-architecture.md#頁面登記與客製替換)與[表單引擎](../concepts/form-engine.md#前端引擎零件與預設組裝)。

| 零件                                                                                | 檔案(`apps/admin/src/`)                                                       |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `FormRenderer`(五種 `mode`;版面以 `@repo/ui/grid` 排 12 格)、設計模式的格子與放置區 | `components/base/form-engine/FormRenderer/`                                   |
| widget 登錄表(`widget.kind` → 元件)                                                 | `components/base/form-engine/widgets/widget-registry.ts`                      |
| `FormSubmissionList` / `FormSubmissionDetail`(含修訂紀錄與差異)                     | `components/base/form-engine/FormSubmissionList.tsx`、`FormSubmissionDetail/` |
| `FormPicker` / `LookupDialog` / `ReferenceField`                                    | `components/base/form-engine/`                                                |
| `renderValue(ctx)` / `FormValue`                                                    | `components/base/form-engine/render-value.ts`、`FormValue.tsx`                |
| `formModulePages(moduleKey)` 與四個預設頁                                           | `components/base/form-engine/FormModulePages/`                                |
| 純邏輯:欄位狀態(五種 mode)、欄位級權限來源、設計器操作、帶入、修訂差異              | `lib/base/form-engine/`                                                       |
| `useModuleForms` / `useFormDraft` / `useFormSubmission` / `useFormRuntimeVersion`   | `hooks/base/`                                                                 |

- **欄位級權限**:已有提交 → 用 api 的 `fieldStates.redacted` 與 `abilities.canEditField`;新增、草稿還沒建 → 由持有的 `<模組>.show-/edit-<formKey>-<fieldKey>` 推(推錯只影響畫面,寫入仍由 api 守)。定義裡標 `redacted: true` 的欄位(`formRuntimeVersion` 的骨架)一律當讀不到、整格不渲染(`lib/base/form-engine/field-states.ts`、`field-permissions.ts`);骨架省略了公式,所以「只因依賴而受保護」的計算欄位靠這個旗標,不靠權限 key 推。
- **預設值與「碰過」旗標**在 `hooks/base/useFillValues.ts`(填寫頁與設計器預覽共用;計算在 `lib/base/form-engine/form-defaults.ts`):新增頁一打開就填預設值;改到的欄位(含帶入)記為碰過,其餘有預設值、改得動、公式引用都讀得到的欄位依目前的值重算;存草稿時 `touched` 一併送出。引用欄的預設值畫面上先用登入者名稱 / 當前組織名稱當 label,送出時 api 重取。
- **日期 / 日期時間**:`DateWidget`(`@repo/ui/date-picker`,選日 → 租戶時區當地 00:00 的 ISO;換算在 `lib/base/form-engine/local-day.ts`)與 `DateTimeWidget`(`@repo/ui/date-time-picker`,收發 ISO)以 `WidgetContext.timezone` 輸入與顯示 = **讀者現在的租戶時區**(`hooks/base/useTenantTimezone.ts`,`me.currentOrg.timezone`;填寫 / 草稿 / 設計器預覽由表達式 `ctx.timezone` 帶入,唯讀檢視由詳情明給)。**顯示一律走 `hooks/base/useTemporalText.ts`**(`formatTemporal`;時區 = 呼叫端給的 → 讀者的租戶時區 → `Asia/Taipei`,不用瀏覽器時區),元件不自己格式化日期值:列表(摘要槽「日期」對到日期欄印日期、其餘印到分鐘)、詳情、修訂差異、計算欄位、修訂時間、設計器預覽的摘要都是讀者的租戶時區。
- **唯讀檢視 = 同一套填寫元件走 readOnly**(`FormRenderer` 的 `readonly` mode 對每個 widget 傳 `isReadOnly`,不是停用):文字 / 數字 / 日期 / 選項 / 引用走 `widgets/ReadOnlyField.tsx`(有框輸入框、文字照一般顏色、`readonly`;數字帶單位、選項與引用顯示 `displayValues` 的現名或快照 +「(來源不可用)」、多選以「、」串起;不查選項),是否欄是同一個開關 / 勾選框帶 `readOnly`,上傳欄是檔名下載鈕(`onDownload`)。填寫、預覽、唯讀三種模式的分區都是有框卡片 + 標題列。`FormValue` 只給表格格子(列表、修訂差異)。
- **修訂紀錄跳窗**:詳情的表單 / 版本 / 狀態 / 建立者與修訂清單收在「修訂紀錄」跳窗(`FormSubmissionDetail` 的 `isHistoryOpen` / `onHistoryClose`,按鈕由頁面放在標題列「刪除」左邊)。客製頁用 `FormSubmissionDetail` 時要自己放「修訂紀錄」按鈕並傳這兩個 prop;不傳就沒有這個跳窗。
- **明細列表格**(`components/base/form-engine/widgets/ArrayTableWidget/`):桌機表格、手機寬(< `sm`,`@repo/ui/media-query` 的 `useBreakpointDown`)每列一張卡片;列尾「上方插入一列」「上移」「下移」(圖示鈕)與「複製」「刪除」(`lib/base/form-engine/array-rows.ts` 的純函式;第一列不能上移、最後一列不能下移;移動只換陣列順序、`rowId` 不變,修訂差異因此標「移動」)、表尾「+ 新增一列」,新增 / 插入 / 複製都到 `maxRows` 停;不做拖拉排序;每格錯誤以 `rowId` + `columnKey` 標在那一格、列數錯誤在表尾。表格裡的格子不畫標題(widget 的 `hiddenLabel`:有框輸入框因此不留 legend 缺口,標題改當 `aria-label`;`@repo/ui` 的 `SelectField` / `Autocomplete` / `DatePicker` / `DateTimePicker` 同名 prop),卡片照常顯示;格子與列動作是 `memo` 元件,回呼以 ref 取最新的列保持穩定;唯讀檢視同一元件走 `isReadOnly`;設計模式畫表格外觀的占位。每一格的元件取自 `widgets/widget-registry-core.ts`(單值 widget;完整登錄表 `widget-registry.ts` 再加 `table`,拆兩支是為了不讓明細元件與登錄表互相 import)。修訂差異的明細在 `FormSubmissionDetail/ArrayRevisionDiff.tsx`。
- **選項欄**三種來源統一在 `components/base/form-engine/widgets/useFieldOptions.ts`:靜態清單讀定義、類別選項打 `formFieldOptions`(先取前 100 筆、前端比對關鍵字;api 回的 `totalCount` 大於取回筆數時,打字搜尋改送 api 的 `keyword`;沒有搜尋框的下拉 / 單選鈕只列前 100 筆)、lookup 打 `formLookup`(關鍵字送 api)。類別選項的查詢失敗時該欄只顯示既有值、改不了。
- **容量上限**(`REVISION_LIMIT` / `DOCUMENT_TOO_LARGE`)在 `lib/base/form-engine/form-errors.ts` 細分成自己的碼,由 `hooks/base/useCapacityErrorSnackbar.ts` 以 Snackbar 告知(不是「被別人更新」,不給重新載入)。

## api 介面

GraphQL 文件:`packages/graphql/src/documents/base/forms.graphql`(設計、升級)、`form-submissions.graphql`(執行)。

**設計端**(`@RequirePermission` 守端點,「是不是自己的表單 / 站在哪裡」在 service):`forms`、`form`、`formVersion(formKey, version?)`(省略 = 草稿)、`formVersions`、`validateFormVersion`、`previewFormVersion`(兩者是 query,不落庫)、`createForm`、`updateForm`、`forkForm`、`createFormVersionDraft`、`saveFormVersionDraft`、`deleteFormVersionDraft`、`publishFormVersion`、`retryPublishFormVersion`、`retireCurrentVersion`、`assignFormToTenants`、`revokeFormFromTenant`、`setTenantFormEnabled`、`retiredFormPermissions`、`deleteRetiredPermission`、`setModuleListColumns`(`system.forms.edit` + 站在根組織)。`moduleListColumns(moduleKey)` 給該模組的使用者讀(有 view / create / edit 任一)。

**執行端**(模組是執行期的,service 依該模組的 `view` / `create` / `edit` / `delete` 判,錯誤與 `@RequirePermission` 同一種):`moduleForms(moduleKey)`、`formRuntimeVersion(formKey, version)`、`formSubmissions`、`formSubmission(id, revision?)`、`formSubmissionAttachmentUrl(id, fieldKey, revision?)`、`createFormDraft`、`saveFormDraft`、`submitFormSubmission`、`updateFormSubmission`、`deleteFormSubmission`、`formLookup`、`formLookupRecord`、`formFieldOptions`、`formUpgradePlan(formKey, targetVersion)` / `upgradeFormSubmissions`(模組 `edit`)。`FormSubmissionModel.revisions` 是 field resolver(只有修訂紀錄跳窗查)。綁了審核流程的表單另有 `withdrawSubmission`、`voidSubmission`、`copySubmissionToDraft`(規則見 [workflows](./workflows.md))。

**匯出專案設定**:`exportFormSeed(input: { formKey, version, revision, changelog })`(query)回 `ExportFormSeedPayload { fileName, source }` —— 把共用表單的指名版本輸出成可直接登記進專案種子的 TypeScript(`@repo/domain/seed` 的 `serializeSeedSet`;檔名 `<formKey>.<revision>.seed.ts`)。唯讀:不寫資料庫、不留稽核、不建安裝紀錄。

- 守門:端點擋 `system.forms.view`,其餘在 `form-design/form-seed-export.service.ts` —— `view` + `edit`(缺任一 → `FORBIDDEN`)、站在根組織(否則 `FORBIDDEN` + `ROOT_ONLY`)、共用表單(租戶的客製表單在根組織視角一律 `NOT_FOUND`)。
- `version`:必填,必須是**已發布**的那一版,不以目前版本代替。不存在(草稿沒有版號,指不到)→ `NOT_FOUND`;已退役 → `VALIDATION_FAILED` + `fields: ["version"]`;發布還沒切換完(版本已是 `published`、`currentVersion` 還沒指向它)→ `CONFLICT` + `PUBLISH_IN_PROGRESS`。
- `revision`、`changelog`:都必填,沒有缺席 / `null` 的語意。`revision` 的格式是 `@repo/domain/seed` 的 `DEFINITION_REVISION_PATTERN`;`changelog` 去掉空白後不可為空(內容原樣輸出,不修剪)。不符 → `VALIDATION_FAILED` + `fields`(`revision` / `changelog`)。
- 內容是設計端的完整版本,不是 `formRuntimeVersion` 依欄位級權限遮過的投影:`key`、`moduleKey`、身分上目前的 `name` 與 `tabLabelTemplate`、該版的 `fields` / `layout` / `summaryMap` / `prefills`,`desiredStatus` 固定 `published`。不含資料庫 id、版號、時間、發布者、擁有組織、分派與綁定。
- 可攜性由 `validatePortableDefinition` 檢查(規則正本 `packages/domain/src/seed/portable-definition.ts`),依賴目錄取自這個環境(`form-design/seed-export-catalog.service.ts`):`engine = form` 的模組、seed 宣告的欄位類別與它的全域種子選項、有目前版本的共用表單(內容取目前版本)。有任何一筆不過就整份不輸出 → `VALIDATION_FAILED` + `fields: ["definition"]` + `issues`(`PortableIssue[]`:`{ code, message, path }`;`path` 是宣告內的位置,如 `definition.fields.3.default.value`,`message` 是給設計者看的繁中修正說明)。
- 前端的顯示條件(守門仍以 api 為準):`FormModel.isShared && abilities.canEdit`、沒有發布中斷,且只在目前發布的那一版顯示 —— 共用表單只有站在根組織的人 `canEdit`,所以不另開一個 ability。

**提交狀態**:`FormSubmissionStatus` 七值(`DRAFT` / `REVIEWING` / `RETURNED` / `WITHDRAWN` / `COMPLETED` / `REJECTED` / `VOIDED`)。

- 綁流程的表單送出不經 `COMPLETED`、直接 `REVIEWING`(送出時檢查擋下回 `FORBIDDEN` + reason);`RETURNED` / `WITHDRAWN` 由申請人以 `saveFormDraft` 改內容、再 `submitFormSubmission`(修訂 +1)。
- `formSubmissions` 列出草稿以外的所有狀態(草稿只給建立者)。
- `updateFormSubmission` 只收**沒走過流程**的 `COMPLETED`(走過流程的核准後鎖定、只能作廢 → `CONFLICT` `STATUS_MISMATCH`)。
- `deleteFormSubmission` 可刪草稿 / `RETURNED` / `WITHDRAWN`(建立者本人,`create`)、沒走過流程的 `COMPLETED` 與 `REJECTED`(`delete`),其他狀態 → `CONFLICT` `STATUS_MISMATCH`。
- 單筆讀取與附件的授權是 `canReadSubmissionRevision`:建立者讀全部修訂;任務持有者只讀他審的修訂(`revision` 省略 = 其中最新的一個,摘要改用該修訂實例上的快照);`formRuntimeVersion` 對持有該表單任務的人也開放。

input 欄位的缺席 / `null`:

- `SetModuleListColumnsInput.builtin`:缺席 / `null` = 保留目前存的(沒存過 = 全開);有給就三個開關一起送(`form` / `status` / `createdBy`)。`ModuleListColumnsPayload.builtin` 一定有值(沒存過 = 全 `true`)。
- `UpdateFormInput.name`:缺席或 `null` = 不動。`tabLabelTemplate`:缺席 = 不動、`null` 或空字串 = 清空(改回模組層模板)。
- `CreateFormVersionDraftInput.baseVersion`:缺席 / `null` = 空白草稿。
- `RetireCurrentVersionInput.expectedVersion`:必填,呼叫端當時看到的目前版本號。
- `PreviewFormVersionInput.version`:缺席 / `null` = 草稿;有值 = 該已發布 / 已退役版本(不存在或是發布中的版號 → `NOT_FOUND`)。
- `SaveFormDraftInput.values` / `UpdateFormSubmissionInput.values`:**整張表單的狀態**,缺席的欄位 = 清空;看不到的欄位不送或原樣送回 `"[redacted]"` 都算沒動。`CreateFormDraftInput.values` 缺席 = 空白(沒碰過且空著的欄位由後端填預設值)。
- `CreateFormDraftInput.touched`:缺席 / `null` = 都沒碰過。`SaveFormDraftInput.touched`:缺席 / `null` = 保留目前存的,有值 = 整份取代(只收這一版使用者填的欄位)。
- `FormFieldOptionsInput`:`version` 缺席 = 草稿(同下一條);`keyword` 缺席 / 空字串 = 全部(比對顯示名與值,不分大小寫);`pageSize` 預設 100(上限 100)。
- `FormLookupInput.version`:缺席 = 草稿(設計器預覽,要 `system.forms.view` 且讀得到這張表單);有值 = 已發布或已退役版(要該模組的 `create` 或 `edit`)。`target` 的 `fieldKey` / `prefillIndex` 恰給一個。
- `UpgradeFormSubmissionsInput.clientRequestId`:必填,1–100 字(去頭尾空白後)。

輸出欄位:

- `FormSubmissionModel.values`:讀者沒有 `show` 的欄位是字串 `"[redacted]"`(不是 `null`),前端依 `fieldStates.redacted` 判斷,不要拿值猜。`displayValues` 只有類別 / lookup 選項與引用欄;`available: false` = 來源已刪或讀者無權,顯示快照 label + 「(來源不可用)」。
- `FormSubmissionModel.viewedVersion`:這次回傳的修訂用哪一版的定義渲染(見「讀取投影」)。
- `formRuntimeVersion` 的 `fields`:讀者讀不到的欄位是骨架且 `redacted: true`;`redacted` 缺席 = 完整定義。
- `FormLookupRecord.values`:受保護且無權的欄位**省略**(鍵不存在),那筆版本沒有的欄位為 `null`。
- `FormSubmissionModel.touched`:使用者碰過的欄位 key(草稿填寫時用);一定有值(沒有 = 空陣列)。
- `me.currentOrg.timezone`(`forms/me-org-timezone.resolver.ts`):讀者當前組織所屬租戶的時區(IANA;租戶頂層 `orgs.settings.timezone`,沒設或不是 `Intl` 認得的時區 = `Asia/Taipei`;根組織讀根組織的設定)。表單引擎日期時間欄輸入與顯示的單一時區來源。
- `FormModel.tenantEnabled`:站在租戶內時本租戶的開關,root 視角為 `null`;`assignments` 只有 root 視角的共用表單有。
- **`abilities` 含權限**(業務模組那一種,前端直接用,不再與 `usePermissions` 相乘):`FormAbilities` 已含 `system.forms.*` 權限與「是不是自己的表單 / 站在哪裡」;`FormSubmissionAbilities.canEdit` = 草稿 / 被退回 / 撤回:建立者本人 + `create`、沒走過流程的已完成:`edit`(走過流程的已完成為 false);`canDelete` = 草稿 / 被退回 / 撤回:建立者本人 + `create`、沒走過流程的已完成 / 已駁回:`delete`;`canWithdraw` = 建立者、審核中;`canVoid` = 走過流程的已完成、建立者或 `edit`;`canCopy` = 已作廢 + `create`;`canEditField` = 權限層面改得動的欄位(條件唯讀看 `fieldStates.readonly`)。只審過某修訂的讀者一律 false。

## 錯誤

通用碼照 GQL-04;「為什麼」放 `extensions.reason`(正本 `apps/api/src/forms/forms-error.ts`)。本模組另有兩個 code:

| code                       | 什麼情況回它                                              | 前端該做什麼                                           |
| -------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| `CONFLICT`                 | 樂觀鎖或搶鎖沒搶到,`reason` 見下                          | 提示「已被別人更新,請重新載入」;發布中斷時顯示「重試」 |
| `PERMISSION_NOT_DELETABLE` | 退役權限清理的前置檢查未過;`extensions.reasons` + `usage` | 依 reasons 顯示原因;`CONFIRM_REQUIRED` 時跳確認再送    |

- `CONFLICT` 的 `reason`:
  - 樂觀鎖 / 狀態:`DRAFT_REVISION_MISMATCH`、`DRAFT_EXISTS`、`DRAFT_MISSING`、`PUBLISH_IN_PROGRESS`、`PUBLISH_NOT_INTERRUPTED`、`NO_CURRENT_VERSION`、`CURRENT_VERSION_CHANGED`、`EDIT_VERSION_MISMATCH`、`REVISION_MISMATCH`、`STATUS_MISMATCH`、`CLIENT_REQUEST_REUSED`、`ALREADY_COPIED`(複製為新單:來源已複製過)。
  - 容量:`REVISION_LIMIT`(綁流程的表單修訂已滿 50 筆;前端文案「修訂次數已達上限,請建立新的申請」)、`DOCUMENT_TOO_LARGE`(更新後文件超過 8MB;「修訂記錄已達容量上限,無法再修改」)。這兩個前端以 Snackbar 顯示,不提示重新載入。
  - 舊版資料升級:`FORM_HAS_WORKFLOW`(本租戶綁了流程)、`VERSION_NOT_PUBLISHED`(目標版不是已發布)。
- `FORBIDDEN` 的 `reason`:`FIELD_FORBIDDEN`(附 `fieldKey`)、`FORM_NOT_AVAILABLE`、`NOT_FORM_OWNER`、`ROOT_ONLY`;端點層沒權限的 `FORBIDDEN` 沒有 reason。別人的草稿一律 `NOT_FOUND`(草稿只屬於建立者,不透露它存在)。
- `PERMISSION_NOT_DELETABLE` 的 `reasons`:`NOT_DYNAMIC`、`NOT_RETIRED`、`USED_BY_DRAFTS`、`CONFIRM_REQUIRED`。
- `VALIDATION_FAILED`:定義有錯 → `fields: ["definition"]` + `issues`(檢查器的 `DefinitionIssue[]`,每筆帶定位);值有錯 → `fields`(欄位 key)+ `fieldErrors`(`{ fieldKey, code, message }`,code 見 `@repo/domain/form` 的 `VALUE_ISSUE_CODES`);匯出可攜性錯誤同樣用 `fields: ["definition"]` + `issues`,每筆為共用契約的 `{ code, message, path }`,由彈窗逐項顯示;匯出版本狀態不符使用 `fields: ["version"]`。其他輸入錯誤照一般的 `fields`。

## 稽核

| action                                                                                                    | targetType        | 記什麼                                                                                     |
| --------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| `form.create` / `form.update` / `form.fork` / `form.assign` / `form.revoke` / `form.set-enabled`          | `form`            | key、名稱、分派的租戶、開關前後                                                            |
| `form-version.create-draft` / `.save-draft` / `.publish` / `.retry-publish` / `.retire` / `.delete-draft` | `form_version`    | formKey、版號、draftRevision、changelog;刪除草稿的 `before` 記整份定義                     |
| `submission.create-draft` / `.save-draft` / `.submit` / `.update` / `.delete`                             | `form_submission` | 修訂號、editVersion(**不記值**:可能含受保護欄位)                                           |
| `submission.upgrade`                                                                                      | `form`            | formKey、目標版、clientRequestId、各舊版本升級筆數、跳過筆數與原因、補值的欄位 key(不記值) |
| `permission.delete-retired`                                                                               | `permission`      | key、name、被解除的角色綁定數、已完成的使用筆數                                            |
| `module.set-list-columns`                                                                                 | `module`          | 配置前後的欄位清單                                                                         |
