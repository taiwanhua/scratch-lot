# 資料範圍(技術)

## 用途

讓根組織的系統管理員對模組資料的資料目標(一個模組一個:示範模組1 的 `demo_items_one`、各示範表單的 `form_submissions`)設定額外的過濾規則:規則依「套用對象」(人員條件:所有人,或由使用者 / 角色 / 所屬組織 / 權限組成的條件樹)命中操作者,再以「條件組合」過濾他查得到的資料。規則只會讓看到的資料**變少**,永遠疊在租戶隔離保底之內。機制本體見 ADR-0008,查詢時的合成順序見 ADR-0011。

正本:`docs/adr/0008-data-scope.md`、`docs/adr/0011-permission-resolution-flow.md`

## 模組 key 與畫面

| key                 | 名稱     | sidebarType | 路由                 | 備註                                            |
| ------------------- | -------- | ----------- | -------------------- | ----------------------------------------------- |
| `system.data-scope` | 資料範圍 | link        | `/system/data-scope` | 掛「系統管理」群組;**根組織專屬**(`isRootOnly`) |

- 畫面:Figma「Screen / 資料範圍」166:318 —— 左資料目標清單、右規則編輯器;合成規則說明見註記卡 167:1901,日期條件列 167:1804 / 167:1819,捲動提示 169:277。
- 側欄初始圖示 `filter`(可在「模組與權限」頁更換)。

正本:`apps/db-migrator/seeds/base/modules/system.ts`、`docs/standards/general/figma.md`(FIGMA-09 節點表)

## 權限表

每個模組固定有一筆 `<key>.*`(seed 自動產生,本表不列)。綁定原則:綁「按鈕 / 欄位所在的那一頁」(ADR-0004)。

| 權限 key                 | 它是哪一頁的什麼                                                           |
| ------------------------ | -------------------------------------------------------------------------- |
| `system.data-scope.view` | 看資料目標清單與各目標的規則                                               |
| `system.data-scope.edit` | 規則編輯器「儲存」+ API(整份 `data_scope_rules` 覆蓋;儲存即作廢記憶體快取) |

整頁根組織專屬:模組節點在 seed 宣告標了 `isRootOnly`,租戶管理員模板複製時整個模組被扣除(ADR-0009),所以租戶的側欄根本沒有「資料範圍」這一列;api 另有第二道門(見「規則」)。若未來開放給租戶,套用對象與值選擇器本來就受可見範圍限制,保底不可關。

正本:`apps/db-migrator/seeds/base/modules/system.ts`

## 資料

- **`data_scope_rules`**:每個資料目標一份規則文件 —— `collection` + `moduleKey`(**`(collection, moduleKey)` unique 索引**)、`combineOp`(`AND` / `OR`)、`rules[{ audience, filter }]`。**沒有掛 `tenantScopePlugin`**:規則是全域設定,一個資料目標全站只有一份,由 root 維護、對所有租戶同時生效(「命中誰」由套用對象決定)。
- **`data_scope_targets`**:資料目標目錄,**一個模組一個目標**,來源是各模組 seed 的 `dataScopeTarget` 宣告(collection、中文名、描述、可篩欄位);識別鍵 `(collection, moduleKey)`,`moduleKey` 由 seed runner 填宣告檔所在的模組。基礎欄位由底座自動掛進欄位目錄,不必宣告。
- **同一張表可以有多個目標**:所有表單模組的資料都存在 `form_submissions`,每個表單模組各宣告一個目標(`collection` 固定 `form_submissions`),各自一份規則。表單模組的欄位目錄 = 基礎欄位 + 提交狀態 `status`(enum,七種:草稿 / 審核中 / 已退回 / 已撤回 / 已完成 / 已駁回 / 已作廢;任何一個表單模組都可能被綁流程,所以一律給全),表單自訂欄位不進條件。目標由 `form-module-declaration.ts` 統一產生。
- **示範模組1 的目標**:`demo_items_one`。它宣告了一個 enum 欄位 **`status`**(草稿 / 已發布 / 已封存),`value` 與 `demo-item-one.schema.ts` 的 `status` 一一對應,權限劇本的「enum 固定選項」在這裡驗。示範模組2 刻意不宣告,是對照組。
- 執行面快取:規則設定放記憶體快取,`saveDataScopeRule` 儲存時作廢。

正本:`apps/api/src/database/schemas/data-scope-rule.schema.ts`、`apps/api/src/database/schemas/data-scope-target.schema.ts`、`apps/db-migrator/seeds/base/modules/demo.sub.sample-one.ts`(`dataScopeTarget`)、`apps/db-migrator/seeds/base/form-module-declaration.ts`

## 規則

**只有 root 進得去**:`isRootOnly` 擋在側欄與路由(第一道),service 再守「當前組織是根組織」(第二道,判斷點 `OwnerProtectionService.isRootOperator`,與租戶作業、模組與權限同一個)—— 權限可能經角色被帶到別的組織,**站在哪裡**才是判準。所以凡是「建一條資料範圍規則」的步驟,帳號一律是 root(驗收劇本 2 / 4 的建規則帳號是 root,劇本 16 驗租戶看不到這一列)。

### 執行面的回傳語意

BaseRepository 查詢時套用;GQL-07 的語意正本在此。

- 規則只套**模組資料表**(`tenantScopePlugin({ moduleData: true })`,必為業務類);`users` / `orgs` 這類底座 / 治理資料,以及 `fields` / `audit_logs` / `customers` 這類業務類但非模組資料的表,不做資料範圍。
- **沒有規則命中操作者 = 不過濾**(只剩租戶保底),不是「什麼都看不到」。
- 規則永遠以 `$and` 疊在租戶保底之內 —— 規則只會讓看到的**變少**,保底不可關。
- 規則套在 `SCOPED_QUERY_MIDDLEWARE` **整組**(與租戶保底同一組),**含寫入與刪除的查詢** —— 看不到的資料也改不到 / 刪不到。
- **`combineOp` 只作用在「命中同一個人的那幾條規則」之間**:`OR` = 聯集、`AND` = 交集;只命中一條的人就只受那一條限制,沒命中的規則不參與合成。
- 套用對象由 `AudienceService.matchesAudience`(`apps/api/src/audience/`)判斷,與流程審核者 / 通知同一份程式:使用者比操作者 id;角色比 `roleIds`(**啟用中**的角色 —— 停用角色後規則立刻不再命中,與管理範圍同一條規則);所屬組織比 `memberOrgIds`(`org_user` 直接關聯),「含下層」= 所屬組織本身或任一上層是指定組織、「含上層」= 所屬組織是指定組織本身或它的上層;權限比**實際授予**的有效權限(`PermissionResolver.grantedPermissionKeys`:看 key 在不在展開後的有效權限集合裡 —— 停用的權限 / 模組(含祖先)/ 角色不算,`<模組>.*` 展開,別租戶客製表單的動態權限以操作者當前組織的租戶剔除;**不走 `holdsPermission` 的 `*` 同層回退**,持 `X.*` 不算持有 `X` 底下已停用的 key),**不套超級管理員的略過**。同時屬於多個租戶的人,判斷用他的當前組織、列出名單(審核者 / 通知)用列名單的租戶,兩者可能不同 —— 已知並接受。同一個請求內事實只算一次。
- 存著的規則若有任一條的套用對象不是人員條件格式(改格式前的舊資料、壞資料),判斷不了套用到誰:**整個資料目標對所有人命中不到任何資料**(fail-closed;跳過那一條會變成多看)。環境清空重建,不寫遷移;遇到時到「資料範圍」頁重設那幾條的套用對象再儲存即恢復。
- 動態值在**查詢當下**代入正在查的人:`current-user` → 操作者 id、`current-user-orgs` → 操作者的**所屬組織**(`org_user` 的直接關聯,**不含**可見性開關展開的下層);代入後若是空集合,該條件命中不到任何資料(fail-closed)。
- **`rules: []` 不等於「從來沒設定過」**:整份覆蓋成空陣列 = 這個目標沒有規則(執行面只剩租戶保底),但 `dataScopeRule` 仍回一份 `rules: []` 的文件;`rule = null` 專指從來沒設定過。
- **規則是共用狀態**:因為規則不隨租戶隔離,自動化測試動到規則的劇本結尾一定要整份覆蓋成 `rules: []` 清乾淨,否則會污染同一個資料庫上跑的其他劇本(TEST-11)。

### 依模組

規則以 `(collection, moduleKey)` 為鍵,查詢時是**一張表**,所以在查詢中介層把該 collection 下**命中操作者的**規則依模組拼成一個 `$or`,再與租戶保底 `$and`:

```js
{
  $or: [
    { moduleKey: { $exists: true, $nin: ["demo.form", "expense"] } }, // 沒有規則命中操作者的模組:只看可見範圍
    { $and: [{ moduleKey: "demo.form" }, 示範表單(群組內)的規則] },
    { $and: [{ moduleKey: "expense" }, 報銷的規則] },
  ];
}
```

- 某模組的規則沒有命中操作者(或那個模組根本沒設規則)→ 那個模組的資料維持只看可見範圍,不會被別的模組的規則影響。
- 那一支要求 `moduleKey` **存在**:沒有 `moduleKey` 的文件(`data_module-data-fields` migration 回填前寫入的資料、所屬組織已不存在而沒回填的孤兒)在有規則命中操作者時看不到(fail-closed),不會從 `$nin` 溜過去。規則文件本身缺 `moduleKey` 的(回填前)不載入。
- 固定欄位模組的表只有一個 `moduleKey`,結果等於「該模組的規則」本身。
- 單筆 / 更新 / 刪除 / lookup 都走同一條路徑(同一組查詢中介層)。
- 記憶體快取以 collection 為外層、`moduleKey` 為內層;`saveDataScopeRule` 儲存時作廢整個 collection。

**條件樹**:條件列 = 欄位(依目錄)→ 運算子(依型別)→ 值(依值來源,含動態值【操作者本人】【操作者的所屬組織】);群組任意深、每層與頂層各有 AND / OR 切換。

正本:`apps/api/src/data-scope/data-scope.service.ts`、`apps/api/src/database/plugins/data-scope-provider.ts`、`apps/api/src/database/plugins/tenant-scope.plugin.ts`、`apps/api/src/database/base.repository.ts`

## api 介面

```graphql
dataScopeTargets: DataScopeTargetsPayload!                          # { targets: [DataScopeTarget!]! },依 moduleKey 排序
dataScopeRule(targetId: ID!): DataScopeRulePayload!                 # { rule: DataScopeRule }(rule = null → 從來沒設定過)
saveDataScopeRule(input: SaveDataScopeRuleInput!): SaveDataScopeRulePayload!   # { rule: DataScopeRule! }

type DataScopeTarget {
  id: ID! # 讀寫規則以它指定目標(一列 = 一個模組)
  collection: String! # 資料所在的 collection(如 demo_items_one;form_submissions 可有多列)
  moduleKey: String! # 宣告這個目標的模組
  moduleName: String! # 模組顯示名(左清單主文字;模組已不存在時退回 name)
  name: String!
  description: String
  fields: [DataScopeTargetField!]! # seed 宣告的業務欄位在前、基礎欄位殿後
  hasRule: Boolean! # 已設規則(見下)
}

type DataScopeTargetField {
  name: String!
  label: String!
  type: DataScopeFieldType! # ORG / USER / DATE / ENUM
  options: [DataScopeFieldOption!]! # 只有 ENUM 非空
  isBase: Boolean! # 底座自動掛入的基礎欄位(非模組 seed 宣告)
}

type DataScopeRule {
  targetId: ID!
  collection: String!
  moduleKey: String!
  combineOp: DataScopeCombineOp! # AND / OR
  rules: [DataScopeRuleEntry!]!
  updatedAt: DateTime!
}

type DataScopeRuleEntry {
  audience: JSONObject! # 人員條件:{ mode: "all" } | { mode: "match", filter }(形狀正本 @repo/domain/audience)
  filter: JSONObject! # 條件樹(形狀見下)
}

input SaveDataScopeRuleInput {
  targetId: ID! # 不存在(或不是 ObjectId)→ NOT_FOUND
  combineOp: DataScopeCombineOp! = OR
  rules: [DataScopeRuleEntryInput!]! # 整份覆蓋;[] = 刪掉這個目標的規則
}
```

三者皆根組織專屬:`@RequirePermission` 先守 `.view` / `.edit`,service 再守根組織(見「規則」)。

套用對象的權限選項(AudiencePicker 的模組 / 權限樹)由共用的 `audiencePermissionOptions { modules }` 提供(`apps/api/src/audience/`):回權限矩陣的顯示樹(全部 enabled 模組與權限 ∩ 操作者自身的有效權限集,扣掉別租戶客製表單的欄位級權限)。root 站在根組織、租戶 = null,所以只列底座與專案的權限。登入即可讀,不另掛權限 —— 樹本身已是操作者持有的那一份。

**回傳欄位的語意**(GQL-07):

- `DataScopeTarget.hasRule`:這個目標**已設規則** = 有規則文件**且 `rules` 非空**。整份覆蓋時送 `rules: []` 等於刪掉規則,之後留下的空文件**不算**已設 —— 判準與執行面一致(`DataScopeService.load`:`rules` 為空即視為沒有規則)。左清單的「已設規則」讀它,不必對每個目標各查一次 `dataScopeRule`。

### `rules[].filter` 的 JSON 形狀(admin 條件樹編輯器照這份產)

節點只有兩種,靠欄位判別:**群組**有 `op` + `children`(任意深,UI 上限 3 層),**條件列**有 `field` + `cond` + `value`。

```jsonc
{
  "op": "AND", // 或 "OR";每一層各自可切
  "children": [
    {
      "field": "createdBy", // 必須在該目標的 fields 目錄內(含 isBase 的基礎欄位)
      "cond": "in", // 必須是該欄位型別允許的運算子
      "value": { "kind": "dynamic", "ref": "current-user" }, // 【操作者本人】
    },
    {
      "op": "OR",
      "children": [
        {
          "field": "orgId",
          "cond": "in",
          "value": { "kind": "dynamic", "ref": "current-user-orgs" }, // 【操作者的所屬組織】
        },
        {
          "field": "orgId",
          "cond": "not-in",
          "value": { "kind": "static", "values": ["66f0a1b2c3d4e5f60718293a"] },
        },
        {
          "field": "createdAt",
          "cond": "between",
          // 起日 / 迄日各自在規則作者(根組織)時區 00:00 的時點(帶時區的 ISO 8601)
          "value": {
            "kind": "static",
            "values": ["<ISO 起日時點>", "<ISO 迄日時點>"],
          },
        },
      ],
    },
  ],
}
```

型別 → 運算子 → 值來源(ADR-0008 那張表的執行期正本):

| 型別   | `cond`                         | `value`                                                                                    |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------ |
| `ORG`  | `in` / `not-in`                | `{ kind: "static", values: [組織 id] }` 或 `{ kind: "dynamic", ref: "current-user-orgs" }` |
| `USER` | `in` / `not-in`                | `{ kind: "static", values: [使用者 id] }` 或 `{ kind: "dynamic", ref: "current-user" }`    |
| `DATE` | `between` / `before` / `after` | `{ kind: "static", values: [ISO 時點] }`(`between` 剛好兩個,其餘一個);**無動態值**         |
| `ENUM` | `in` / `not-in`                | `{ kind: "static", values: [seed 宣告的選項 value] }`;**無動態值**                         |

`value.values` 一律是**字串陣列**(id、日期、enum value 都以字串送),型別轉換在 api 內完成。

**日期條件是日曆天,逐租戶套用**:與表單引擎的日期同一種做法(`docs/concepts/form-engine.md`「值、計算與條件」),全系統沒有第二套。規則裡的「2/1」對每個租戶都是**它自己時區的 2/1**。

- **存值**:選的那一天在規則作者時區 00:00 的時點。規則是根組織專屬設定、沒有 `orgId`,作者就是根組織;本頁只有站在根組織才進得來,所以 admin 的 `DatePicker` 選日後以 `me.currentOrg.timezone`(= 根組織的時區)換成時點、送帶時區的 ISO 8601 字串(`lib/base/form-engine/local-day.ts`,與日期欄的 `DateWidget` 同一組),回顯時再換回該時區的 `YYYY-MM-DD`。api 只收時點(`@repo/domain/form` 的 `toInstant` 認得的字串),`YYYY-MM-DD` 這種沒有時區的字一律 `VALUE_INVALID`。
- **比對**:api 先用**規則作者的時區**把存的時點還原成日曆天(`localDateOf`),再用**操作者所在租戶的時區**算那一天的 00:00 與次日 00:00 當邊界(`startOfLocalDay` / `addLocalCalendar`,夏令時間切換日也對)。根組織自己查資料時兩個時區相同。

| `cond`    | 條件(D、A、B 都是操作者租戶時區的那一天) | 含不含當天         |
| --------- | ---------------------------------------- | ------------------ |
| `before`  | `< D 當天 00:00`                         | 當天不含           |
| `after`   | `>= D 的次日 00:00`                      | 當天不含           |
| `between` | `>= A 當天 00:00` 且 `< B 的次日 00:00`  | 起日與迄日整天都含 |

兩個時區的來源(`apps/api/src/database/tenant-timezone.ts`;沒設或不是合法時區 → `DEFAULT_TENANT_TIMEZONE`):

| 時區         | 讀哪裡                                                                              |
| ------------ | ----------------------------------------------------------------------------------- |
| 規則作者     | 根組織的 `settings.timezone`                                                        |
| 操作者的租戶 | 操作者當前組織所屬租戶頂層的 `settings.timezone`;沒有當前組織(系統上下文)→ 根組織的 |

兩個時區都不跟著規則快取,每個請求各讀一次(只在規則裡有日期條件時讀):改時區即時生效,下一個請求就照新時區算,不必重存規則。

例:根組織是台北時區、存「2020-02-01 之前」(存值 = 台北 2/1 00:00 = 1/31 16:00Z)。台北租戶的操作者邊界是 1/31 16:00Z;倫敦租戶的操作者邊界是倫敦 2/1 00:00 = 2/1 00:00Z。

存著的值不是時點(壞資料)時,那個條件什麼都不命中(fail-closed,與動態值算不出對象同一個原則)。

正本:`apps/api/src/data-scope/`(`data-scope.resolver.ts`、`data-scope-rule.ts`、`models/data-scope.model.ts`)、`apps/api/schema.gql`

## admin 頁面

程式在 `apps/admin/src/pages/base/system/DataScopePage/`:`TargetListPanel.tsx`(左資料目標清單,一列 = 一個模組:主文字模組名、副文字 collection)、`RuleEditorPanel/`(右規則編輯器)、`DiscardChangesDialog.tsx`(未儲存離開確認)、`useDataScopeData.ts`(資料與 mutation)。

- **規則卡分上下兩塊**(`RuleCard.tsx`,Figma `Draft/DataScopeRuleCard`):上「套用對象」= 共用元件 `AudiencePicker`(`apps/admin/src/components/base/AudiencePicker/`;欄位全開:使用者 / 角色 / 所屬組織 / 權限,所屬組織只能指定組織),下「條件組合」= 資料目標的欄位目錄。兩棵樹共用 `components/base/condition-tree/` 的 `ConditionGroup` / `ConditionRow`,只換欄位清單與條件列之後的控制項;根層下拉都叫「組合」,巢狀群組叫「群組組合」。
- **套用對象**:頂層「所有人 / 符合條件」二選一,新規則預設所有人。選所有人時條件樹收起,狀態裡的條件樹仍留著,切回符合條件原樣回來;送出時所有人只送 `{ mode: "all" }`。角色依擁有組織分組(Autocomplete)、組織用 `OrgTreeSelect`、權限用可搜尋的模組 / 權限樹(`audiencePermissionOptions`,只有權限列可勾)。根節點一律以群組送出(存著的根若是單一條件列,讀進來包一層 AND)。
- 純函式在 `apps/admin/src/lib/base/`:`data-scope-rule.ts`(型別目錄、編輯器狀態 ↔ api JSON)、`data-scope-issues.ts`(本地驗證、`RULE_INVALID` 的 `path` → 標在哪一棵樹的哪一格)、`condition-tree.ts`(兩棵樹共用的增刪改與 UI 上限)、`audience-draft.ts`(人員條件的編輯器狀態 ↔ JSON、本地驗證、`path` 定位)。**型別 → 運算子 → 值來源那張表在 admin 重寫了一份**(STRUCT-01 不能 import api),改動時兩邊一起改。
- 條件樹節點**不帶自產 id**:位置(`rules[n]` + 往下的 `children[i]`)就是身分,與 api 回的 `path` 同一套座標;`rules[n].audience.…` 的路徑標在套用對象那棵樹(`AUDIENCE_INVALID` 指到的條件列標紅),其餘標在條件組合。
- **UI 上限三層**(ADR-0008「任意深、UI 建議 3 層」,人員條件同為 3 層):第三層的群組不再給「+ 群組」;資料結構本身不設限,更深的規則由 api 回來仍讀得回、顯示得出來,只是不能再往下加。
- 新群組**一定帶一條條件列**;刪光條件列的空群組送出前就擋下(條件組合 `EMPTY_GROUP`、套用對象同一句),套用對象的條件列沒挑值標 `AUDIENCE_INVALID`。
- 動態值與靜態值在同一個「值」下拉裡(動態值排在最前面):選了動態值就取代整份靜態值,反之亦然。
- **左清單的「已設規則」讀 `DataScopeTarget.hasRule`**(判準見「api 介面」)。
- 選中的目標以 id 記(`selectedTargetId`;同一個 collection 可能有好幾列)。未儲存就切換資料目標 → 放棄變更確認;`saveDataScopeRule` 成功後失效該目標的 `dataScopeRule` 與 `dataScopeTargets`。
- 動作按鈕依 `system.data-scope.edit`,只有 `.view` 時整個編輯器唯讀。
- 非根組織不在頁面判斷 —— 本模組 `isRootOnly`,租戶的 `me.modules` 裡沒有它,路由層就擋掉(ADR-0011)。
- 元件測試:`DataScopePage.test.tsx`、`DataScopeRuleEditor.test.tsx`(條件組合)、`DataScopeAudience.test.tsx`(套用對象)。

正本:`apps/admin/src/pages/base/system/DataScopePage/`、`apps/admin/src/components/base/AudiencePicker/`、`apps/admin/src/components/base/condition-tree/`、`apps/admin/src/lib/base/data-scope-rule.ts`、`apps/admin/src/lib/base/data-scope-issues.ts`、`apps/admin/src/lib/base/audience-draft.ts`

## 錯誤碼

| 情況                        | 回什麼                                     |
| --------------------------- | ------------------------------------------ |
| 權限不足(`.view` / `.edit`) | `FORBIDDEN`(由 `@RequirePermission` 擋)    |
| 當前組織不是根組織          | `FORBIDDEN`                                |
| 不是 seed 宣告的資料目標    | `NOT_FOUND`                                |
| 規則不合法                  | `RULE_INVALID`(GQL-04 的表已列;見下一小節) |

### `RULE_INVALID` 的 `extensions`

`path` 指到條件樹裡出問題的位置(如 `rules[0].filter.children[1].value.values[0]`),`reason` 是原因列舉;前端依 `reason` 顯示中文、把錯誤標在 `path` 指到的那一列。一次只回第一個違規(整份覆蓋,修掉再送)。

| `reason`                   | 什麼情況                                                                                                                                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MALFORMED_RULE`           | `rules` 不是陣列、單筆不是物件、缺 `audience` / `filter`                                                                                                                                                                                                                                                                  |
| `MALFORMED_NODE`           | 節點既不是群組也不是條件列,或 `op` / `field` 型別不對                                                                                                                                                                                                                                                                     |
| `EMPTY_GROUP`              | 群組的 `children` 是空的                                                                                                                                                                                                                                                                                                  |
| `UNKNOWN_FIELD`            | `field` 不在該目標的欄位目錄內                                                                                                                                                                                                                                                                                            |
| `CONDITION_NOT_ALLOWED`    | `cond` 不是該欄位型別允許的                                                                                                                                                                                                                                                                                               |
| `VALUE_SOURCE_NOT_ALLOWED` | `value.kind` 不是 static / dynamic,或該型別不支援這個動態值                                                                                                                                                                                                                                                               |
| `VALUE_INVALID`            | 空清單、id 不是 ObjectId、日期不是帶時區的 ISO 時點、`between` 不是兩個、enum 不在選項內                                                                                                                                                                                                                                  |
| `AUDIENCE_INVALID`         | 套用對象不是人員條件格式:`mode` 不認得、`match` 沒有條件列(含空群組)、欄位不是使用者 / 角色 / 所屬組織 / 權限、值不合法(id / 權限 key、所屬組織沒給範圍或用了動態來源)、群組超過 3 層;舊格式 `{ type, ids }` 一律拒絕。`path` 指到出錯的條件列(如 `rules[0].audience.filter.children[1].field`、`rules[0].audience.mode`) |

admin 的解讀集中在 `DataScopePage/data-scope-error.ts`。

正本:`apps/api/src/data-scope/data-scope-error.ts`、`apps/api/src/data-scope/data-scope-rule.ts`、`apps/admin/src/pages/base/system/DataScopePage/data-scope-error.ts`

## 稽核

`saveDataScopeRule` 寫一筆 `data-scope.edit`,`targetType = "data_scope_rule"`,`targetId` 為該目標的規則文件;`after` 帶 `collection` / `moduleKey` / `combineOp` / `rules`。

正本:`apps/api/src/data-scope/data-scope.service.ts`

## 測試

- api:`apps/api/src/data-scope/data-scope.test.ts`(端點、根組織守門、`RULE_INVALID`、`hasRule`、同 collection 兩個模組各自的規則);執行面 `apps/api/src/database/data-scope-provider.test.ts`、`apps/api/src/database/base.repository.test.ts`、`apps/api/src/demo-items-one/demo-items-one-scope.test.ts`
- admin:`apps/admin/src/pages/base/system/DataScopePage/DataScopePage.test.tsx`、`DataScopeRuleEditor.test.tsx`、`apps/admin/src/lib/base/data-scope-rule.test.ts`
- 劇本 E2E(`docs/testing/permission-scenarios.md`):劇本 2 資料範圍規則 `scenario-02-data-scope-rule.spec.ts`、劇本 3 未宣告對照 `scenario-03-undeclared-target.spec.ts`、劇本 4 頂層合成 OR / AND `scenario-04-combine-op.spec.ts`、劇本 16 租戶視角 `scenario-16-tenant-perspective.spec.ts`(皆在 `apps/e2e/src/specs/`)

正本:上列檔案、`docs/testing/permission-scenarios.md`

## 使用者說明(help.md)

[system.data-scope.help.md](../../apps/admin/src/md/module-help/base/system.data-scope.help.md) —— 根組織專屬模組,help 的讀者就是系統管理員,可用平台詞彙。

正本:`apps/admin/src/md/module-help/base/system.data-scope.help.md`

## 平台視角備註

- 規則是全站一份、跨租戶生效(見「資料」);租戶管理員看不到也改不到,只有 root 維護。
- root 挑「套用對象 = 指定角色」時,每個租戶可能都有同名角色,靠次文字(擁有組織)分辨(`docs/modules/role-manager.md`「角色選單怎麼分辨同名角色」);挑錯租戶的同名角色,規則會命中不到任何人。

正本:`apps/api/src/database/schemas/data-scope-rule.schema.ts`、`docs/testing/permission-scenarios.md`
