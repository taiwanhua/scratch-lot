# 資料共用:讀取放寬寫在 schema 宣告,寫入不放大

> 現況說明見 `docs/concepts/data-layer-and-isolation.md`「資料共用」;與資料範圍的先後見 `docs/modules/data-scope.md`「與資料共用的先後」。

## 讀和寫分開

**決策**:

- **看不看得到** = 可見範圍(所屬組織 + 租戶可見性開關)→ 加上**共用** → 再被**資料範圍規則**縮小。
- **能做什麼** = 模組與權限。**修改 / 刪除不放大**:只能對「歸屬組織在自己可見範圍內」的資料做;共用進來的資料只能看。
- 實作上 `tenantScopePlugin` 的讀取中介層(`find`、`findOne`、`countDocuments`、`distinct`,以及 `aggregate` 的 `$match` 起點)加共用分支;寫入中介層(更新、取代、刪除)只照可見範圍。`create` 照舊只能寫進可見範圍內的組織(預設當前組織)。

**理由**:共用的需求都是「讓別的組織看得到」;一旦連寫入也放大,分店改得到總部的主檔、兄弟分店刪得到彼此的單據,權限就失去意義。

## 每張表三種宣告之一

**決策**:宣告寫在 schema 的 `tenantScopePlugin({ sharing })`,不在 UI、不在呼叫端:

| 宣告          | 讀取放寬                                                                          | 用途                                         |
| ------------- | --------------------------------------------------------------------------------- | -------------------------------------------- |
| `private`     | 無(照可見範圍;預設)                                                               | 一般業務資料                                 |
| `shareable`   | 每筆的共用清單 `shareOrgs: [{ orgId, includeDescendants }]`,另可 `sharedByFields` | 主檔要給全部分店、單據要給對方分店看         |
| `inheritDown` | 所屬組織的上層鏈建的資料                                                          | 上層訂、下層沿用的設定(欄位管理維持現有機制) |

- `shareable` 的選項:
  - `defaultShareOrgs`:新增時的預設清單 —— `none`(空)或 `wholeTenant`(`[{ 租戶頂層, 含下層 }]` = 全部分店)。
  - `editable`:`false` = 清單固定,新增一律用預設、一般更新改不了(受保護欄位),畫面不出現「共用給」;`true` = 新增 / 編輯頁出現「共用給」,有該模組修改權限的人才能改。
  - `sharedByFields`:選填、可多個欄位;資料「也給這些欄位指到的組織看」(欄位是單一組織或組織陣列,任一對上就看得到;`includeDescendants` = 被指到的組織的下層也看得到)。不需同步任何清單,欄位改了看得到的人跟著變。欄位與 `{ tenantId, <欄位> }` 開頭的索引由宣告的表自己建,掛 plugin 時驗證存在。
- `shareable` 與 `refFields` 只給模組資料表(`moduleData: true`,有 `tenantId`);共用宣告只給業務類、`orgId`、`allowGlobal: false` 的表。宣告不自洽在掛 plugin 時就拋錯,app 起不來。
- 新表在 `docs/agents/module-scaffold.md` 步驟 2 選一種。

**理由**:同一張表在不同功能裡不該換共用方式,判準放在 schema 才看得到、審得到;「全部分店」是最常見的主檔需求,用預設清單表達,不另開一種宣告。

## 判斷是不是共用給我

**決策**:

- 看**全部所屬組織**(`memberOrgIds`),不看當前組織;切換當前組織,看到的共用資料不變。
- 共用給某組織且勾「含下層」→ 它的下層也看得到:比對方式是「共用的組織 ∈ 我的所屬組織的上層鏈」(不含根組織)。
- 不受可見性開關展開:開關只放大可見範圍本身,共用分支只看所屬組織。
- **別的租戶絕對看不到**:共用分支**依所屬租戶分組**(`memberTenants`),每個租戶 T 各產生 `{ tenantId: T, shareOrgs / 欄位 ∈ T 裡的所屬組織(與上層鏈)}`,由 plugin 強制帶上、呼叫端拿不掉。同時屬於兩個租戶的人,不會拿乙租戶的組織去命中甲租戶的資料;即使資料損毀、清單或欄位指到別租戶的組織也一樣。
- 根組織維持現狀:可見範圍是全部,不需要共用;要看某租戶的資料先切進那個租戶。

## 寫入共用清單

**決策**:

- 建立時歸屬 = 當前組織(沒有特例)。
- 「共用給」可以選**整個租戶**的組織(包含自己看不到的):共用只讓對方看得到,不讓分享者看更多。
- `shareOrgs` 的每個組織都要存在、且與資料**同租戶**,否則 `VALIDATION_FAILED`(`fields: ["shareOrgs"]`);由 `BaseRepository` 的建立與更新統一檢查,模組不各自寫。
- `shareOrgs` 只能整份替換(`$set` 或頂層);`$push` / 子路徑之類的局部更新拋錯 —— 檢查才看得到最後的完整清單。
- 提醒收件人不另外過濾「看不看得到這筆」:要讓事件組織的人看得到,用 `sharedByFields`。

## 例外出口與提升上下文

**決策**:

- 放寬範圍的出口只有 ADR-0005「例外出口」登記的那幾個。這次新增三個:`BaseRepository.existsInTenant`(租戶內唯一 / 占用檢查;條件只能是欄位等於值的組合)、`BaseRepository.findRefsInTenant`(看得到這筆就看得到它引用的名稱)、`tenantBoundaryContext(orgs, operator | null, tenantId)`(反查 / 以人為準的資料 / 排程 / 登記過的例外寫入;底層 `systemTenantReader`)。前兩個只能用在操作者所屬的租戶,呼叫端登記在 `TENANT_BOUNDARY_CALLERS`。
- **讀進來的文件不能 `save()`**:`save()` 走 `collection.updateOne`、不經查詢中介層,共用分支讀到的文件存回去就等於繞過寫入範圍;plugin 的 save 中介層只放行新建,更新一律經 `BaseRepository` 的條件更新。
- `aggregate` 拒收 `$lookup` / `$unionWith` / `$graphLookup` / `$out` / `$merge`,包含藏在 `$facet` 子管線或任何巢狀管線裡的。
- **提升上下文**(可見範圍或管理範圍寫成 `"all"` 的操作者上下文)只准出現在登記清單的檔案:底座的在 `apps/api/src/database/elevated-contexts.ts`,專案的在 `apps/api/src/project/database/elevated-contexts.ts`;`elevated-contexts.test.ts` 掃整個 src,新增未登記的一處就失敗。新需求先用登記過的出口或共用宣告。

**理由**:分析時發現底座與專案多處各自把範圍提升成 `"all"` 再手動釘 `tenantId`,沒有登記、lint 或掃描,寫錯一個條件就是跨租戶讀寫;寫入也有放大的地方。把共用變成宣告、把提升變成登記,review 才看得到每一個例外。

## 表單提交:依欄位共用

**決策**:

- 所有表單共用一張 `form_submissions`,共用與否卻因表單而異,所以宣告分兩層:表的宣告固定為 `shareable`(`defaultShareOrgs: none`、`editable: false`,提交沒有「共用給」),`sharedByFields` 只有一個頂層欄位 `sharedOrgIds`(`match: visible`,見下一條);**哪幾個欄位算數**由表單設定 `forms.sharedByFieldKeys`(表單層的組織引用欄 key)決定。
- **比對可見範圍,不比對所屬組織**:`sharedOrgIds` ∩ 讀者在該租戶的可見範圍(所屬組織 + 租戶開了「含下層」時的整棵下層)非空就讀得到;仍依所屬租戶分組、每組釘該租戶的 `tenantId`(登入線把可見範圍依租戶分組,`memberTenants[].visibleOrgIds`),寫入不放大。這和資料表的 `sharedByFields`(比對所屬組織、不受可見性開關展開)不同。
- 引擎每次寫入存值(建草稿、存草稿、送出、修改、升級)時,從設定的欄位算出 `sharedOrgIds`,與存值同一次寫入;**草稿一律空**(草稿只屬於建立者)。表單設定改了只影響之後的寫入;既有提交要回填就寫 migration(依那一版的宣告從存值算)。
- 共用進來的提交只能看:詳情的 `abilities` 不給改 / 刪 / 作廢 / 複製為新單,呼叫端點 → `FORBIDDEN`(`SHARED_READ_ONLY`);申請人本人照常走自己的路徑。
- 業務功能直接讀 `form_submissions` 的(自己的列表、單筆的讀取資格)不各自比對單據存值裡的組織欄,一律走一般讀取;「誰能操作哪一邊」這類寫入資格仍由功能自己判斷(寫入不放大)。

**理由**:「上層建的單,單上指到的組織也要看得到」是表單的業務語意,同一張表的不同表單答案不同;把欄位清單放在表單設定(受管表單由 seed 宣告),讀取條件仍由 plugin 統一加,才不會每個功能各寫一套比對。比對可見範圍是因為表單的組織欄代表「這張單屬於哪個組織」—— 看得到那個組織的人(例:可見範圍含下層的上層主管)本來就該看得到它的單,依欄位共用只是多一條讀取路,不該比單據歸屬在那個組織時看得到的範圍更窄;資料表的共用清單則是「分享給誰」,維持比所屬組織。

## lookup

**決策**:專案來源走同一套讀取,共用自動生效(搜尋、依值取回、送出重驗)。`ProjectLookupDeclaration.sharedToFilter` 宣告「依表單欄位換值的共用篩選」:`filter` 裡這個鍵的值是組織 id,只列「給那個組織看得到」的資料(歸屬是它、它沿用的上層,或共用給它),仍與操作者自己的讀取範圍 `$and`。

## 影響

- 資料範圍規則仍會縮小共用資料(先放寬、再縮小),見 `docs/modules/data-scope.md`。
- 操作者上下文多一個集合 `memberTenants`(依租戶分組的所屬組織與上層鏈),登入線計算;內部上下文明寫 `[]`。
- 示範模組 2 是「可共用、預設不共用、可編輯」的示範表(權限劇本 30–35)。
- 前端「共用給」欄位是底座 `ShareOrgsField`(`OrgTreeSelect` 的 `scope="tenant"` 多選 + 每個已選組織一個「含下層」勾選框),示範模組 2 與專案的可編輯共用清單都用它。

正本:`apps/api/src/database/plugins/tenant-scope.plugin.ts`、`apps/api/src/database/schemas/form-submission.schema.ts`、`apps/api/src/forms/form-values/shared-org-ids.ts`、`apps/api/src/database/base.repository.ts`、`apps/api/src/database/share-orgs.ts`、`apps/api/src/database/elevated-contexts.ts`、`apps/api/src/database/system-tenant-reader.ts`、`apps/api/src/database/data-sharing.test.ts`
