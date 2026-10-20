# 檔案管理(技術)

## 用途

刮刮樂的兩份主檔(專案規格 5.1、5.5):**遊戲**(一款刮刮樂,整個租戶共用)與**收銀點**(分店內收錢的位置,每個收銀點對應一個崗位)。一頁兩個分頁(遊戲 | 收銀點)。其他模組引用它們:本 / 叫貨單 / 進貨單引用遊戲(引用後遊戲鎖定)、店面管理的班次與檯面掛在收銀點上(有開著的班或檯面有張數時不能停用)。

正本:`apps/db-migrator/seeds/project/master-data.ts`、`packages/domain/src/project/lottery-master-data/`

## 模組 key 與畫面

| key                             | 名稱     | sidebarType  | 路由                               | 說明                                                  |
| ------------------------------- | -------- | ------------ | ---------------------------------- | ----------------------------------------------------- |
| `master-data`                   | 檔案管理 | link(列表頁) | `/master-data`                     | 分頁 遊戲 \| 收銀點(Figma MD-01 97:17、MD-05 97:1120) |
| `master-data.games`             | 遊戲     | hidden       | 無                                 | 權限容器,兼「遊戲分頁」的進入條件                     |
| `master-data.games.view-page`   | 遊戲詳情 | hidden       | `/master-data/game-view-page/<id>` | 詳情頁(MD-03 97:822)                                  |
| `master-data.games.create-page` | 新增遊戲 | hidden       | `/master-data/game-create-page`    | 新增 / 編輯共版型(MD-02 97:456、手機 97:1054)         |
| `master-data.games.edit-page`   | 編輯遊戲 | hidden       | `/master-data/game-edit-page/<id>` | 同上                                                  |
| `master-data.cash-points`       | 收銀點   | hidden       | 無                                 | 權限容器,兼「收銀點分頁」的進入條件;新增 / 編輯是彈窗 |

- 側欄順序 `order: 17`(專案模組依規格 3.1 的順序排在 11–18:店面 11 … 檔案管理 17、班表 18;同層排序值由各模組 owner 票自己宣告)。圖示 `folder`。
- 分頁只剩一個時不顯示分頁籤(`PageTabs`);兩個都沒綁就只剩空白頁。

正本:`apps/db-migrator/seeds/project/master-data.ts`、`apps/admin/src/app/project/module-pages.ts`

## 權限表

規格 3.2 的 `master-data` **沒有 `view`**:讀取看有沒有綁對應分頁的模組(ADR-0011「進得去哪一頁 = me.modules 有沒有那個模組」)。

| 權限 key                         | moduleId 指向             | 它是哪一頁的什麼                                           |
| -------------------------------- | ------------------------- | ---------------------------------------------------------- |
| `<每個節點>.*`                   | 各節點                    | wildcard(同層語意,ADR-0004);seed 自動產生                  |
| `master-data.games.create`       | `master-data.games`       | 遊戲分頁的 [+ 新增遊戲] + `createLotteryGame`              |
| `master-data.games.edit`         | `master-data.games`       | 詳情頁的 [編輯] + `updateLotteryGame`(含改成停售)          |
| `master-data.games.delete`       | `master-data.games`       | 編輯頁的 [刪除](只有從未被引用的遊戲)+ `deleteLotteryGame` |
| `master-data.cash-points.create` | `master-data.cash-points` | 收銀點分頁的 [+ 新增收銀點] + `createLotteryCashPoint`     |
| `master-data.cash-points.edit`   | `master-data.cash-points` | 每列 [編輯](含停用 / 啟用)+ `updateLotteryCashPoint`       |

讀取的守門:

| 端點                                          | 要綁的模組                |
| --------------------------------------------- | ------------------------- |
| `lotteryGames`、`lotteryGame`                 | `master-data.games`       |
| `lotteryCashPoints`、`lotteryPositionOptions` | `master-data.cash-points` |

**開通時建立的角色**(規格 3.3;配方 `apps/db-migrator/seeds/project/onboarding/role-grants/master-data.ts`):

| 角色     | 模組                                                                      | 權限                                    |
| -------- | ------------------------------------------------------------------------- | --------------------------------------- |
| 總部管理 | 全部六個節點                                                              | 各節點 `*`                              |
| 店長     | `master-data`、`master-data.games`、遊戲詳情頁、`master-data.cash-points` | `cash-points.create` / `edit`(遊戲只看) |
| 店員     | 不給                                                                      | —                                       |

正本:`packages/domain/src/project/lottery-master-data/keys.ts`

## 資料

**`lottery_games`**(模組資料,`moduleKey = master-data`):

| 欄位                                              | 規則                                                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `gameCode`                                        | `^\d{4}$`;**租戶內唯一**(service 檢查,已刪除的不算);有庫存後鎖定                                         |
| `name`                                            | 必填,30 字內                                                                                             |
| `unitPrice`                                       | 正整數;預設面額 100 / 200 / 300 / 500 / 1,000 / 2,000,也可自填;有庫存後鎖定                              |
| `ticketsPerBook`                                  | 1–999;選預設面額自動帶入 100 / 100 / 100 / 50 / 25 / 18(對照表 `denominations.ts`,只有一份);非標準只提示 |
| `bookPrice`                                       | `unitPrice × ticketsPerBook`,api 計算後存(input 不收)                                                    |
| `defaultRate`                                     | 整數 0–100(%)                                                                                            |
| `color`                                           | 標籤色票代號(`@repo/domain/project/tag-palette`)或 null                                                  |
| `status`                                          | `on_sale`(預設)/ `discontinued`                                                                          |
| `launchedAt` / `discontinuedAt` / `claimDeadline` | 時點或 null(admin 以租戶時區的當天 00:00 送)                                                             |
| `note`                                            | 1000 字內                                                                                                |

- **遊戲是租戶共用的主檔**:`orgId` 一律是最上層組織(根組織建的是根組織),讀寫時把可見範圍提升、條件釘在操作者租戶的 `tenantId` 上(`lottery/master-data-tenant.ts`;先例 `fields/field-visibility.ts` 的 `fieldReadContext`)。分店人員的可見範圍不含上層,不提升就看不到。
- 刪除是軟刪除(ADR-0007)。

**`lottery_cash_points`**(模組資料,`moduleKey = master-data`):`orgId`(分店,建立後不改)、`positionKey`(欄位管理「崗位」`schedule-position` 的選項值)、`name`(30 字內)、`order`(0 以上整數)、`enabled`、`printerId`(底座 `printers`,同分店、啟用中;null = 用分店預設)、`note`。唯一索引 `(orgId, positionKey)`、`(orgId, name)`(不能刪除,所以沒有軟刪除的資料)。範圍 = 操作者的可見範圍。

不宣告資料範圍目標。示範資料:`apps/db-migrator/seeds/project/demo/games.ts`、`cash-points.ts`(經開通腳本建立,見 [lottery-onboarding](./lottery-onboarding.md))。

正本:`apps/api/src/project/database/lottery-games/lottery-game.schema.ts`、`apps/api/src/project/database/lottery-cash-points/lottery-cash-point.schema.ts`

## 規則

### 有庫存(遊戲引用檢查)

「有庫存」= 任一個登記的引用檢查回 true。介面 `apps/api/src/project/lottery/games/game-usage.ts`:

```ts
registerGameUsageChecker(name, (tenantId, gameId) => Promise<boolean>): () => void
```

由引用遊戲的功能各登記一個(在自己 provider 的 `onModuleInit`):P15(本 `lottery_books`)、P17(叫貨單)、P18(進貨單)。目前沒有任何登記 → 一律沒有庫存。

| 操作                                           | 沒有庫存           | 有庫存                                                             |
| ---------------------------------------------- | ------------------ | ------------------------------------------------------------------ |
| 改 `gameCode` / `unitPrice` / `ticketsPerBook` | 照改(整本金額重算) | `VALIDATION_FAILED`,`fields` = 改到的那幾欄,`reason = GAME_IN_USE` |
| 送和原值一樣的鎖定欄位                         | 照常               | 不算改,照常                                                        |
| 改其他欄位(含停售)                             | 照改               | 照改                                                               |
| 刪除                                           | 軟刪除             | `VALIDATION_FAILED`,`reason = GAME_IN_USE`                         |
| `abilities.canDelete`                          | 有 `delete` 權限   | false                                                              |
| 畫面                                           | —                  | 編輯頁上方提示、三欄唯讀、沒有 [刪除]                              |

### 停售

只提供狀態;「停售的遊戲不能出現在新的叫貨單與進貨單」由 P17 / P18 送出前檢查,調貨、銷售、盤點照常。

### 收銀點

| 操作                             | 結果                                                                        |
| -------------------------------- | --------------------------------------------------------------------------- |
| 同分店已有這個崗位               | `VALIDATION_FAILED`,`fields: ["positionKey"]`,`reason = POSITION_DUPLICATE` |
| 同分店已有同名                   | `VALIDATION_FAILED`,`fields: ["name"]`,`reason = NAME_DUPLICATE`            |
| 兩個請求同時送出撞唯一索引       | 同上兩列(service 把重複鍵錯誤轉成同一個錯誤)                                |
| 崗位不是這家分店看得到的啟用選項 | `VALIDATION_FAILED`,`fields: ["positionKey"]`                               |
| 印表機不是這家分店的啟用印表機   | `VALIDATION_FAILED`,`fields: ["printerId"]`                                 |
| 分店不在可見範圍                 | `VALIDATION_FAILED`,`fields: ["orgId"]`;崗位選單回空清單                    |
| 停用,有登記的停用守門回 true     | `VALIDATION_FAILED`,`fields: ["enabled"]`,`reason = CASH_POINT_IN_USE`      |
| 刪除                             | 沒有刪除端點                                                                |

- 崗位選單 = 全域種子 + 這家分店的上層(一路到最上層組織)+ 自己加的、啟用中的,依欄位管理排序(規則同欄位管理的上層繼承,`lottery/cash-points/position-options.ts`);選單與送出時的驗證同一支。
- 停用守門介面 `apps/api/src/project/lottery/cash-points/cash-point-deactivation.ts`:`registerCashPointDeactivationGuard(name, (tenantId, cashPointId) => Promise<boolean>)`,由店面管理(P21)登記「有開著的班或檯面上還有張數」;目前沒有登記。
- 對應崗位只用來說明關係與提醒,不用來找排班(規格 14.9)。

## api 介面

### GraphQL

形式見 GQL-02 / GQL-03;operation 文件 `packages/graphql/src/documents/project/lottery/master-data.graphql`。

| 端點                                                                                    | 守門                             | 說明                                                                              |
| --------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------- |
| `lotteryGames(input: LotteryGamesInput!): LotteryGamesPayload!`                         | 綁 `master-data.games`           | 操作者租戶的遊戲;`status?`、`unitPrice?`、`keyword?`(代號或名稱)+ 分頁;代號大到小 |
| `lotteryGame(id: ID!): LotteryGamePayload!`                                             | 綁 `master-data.games`           | 別租戶、已刪除 → `NOT_FOUND`                                                      |
| `createLotteryGame(input: CreateLotteryGameInput!): LotteryGamePayload!`                | `master-data.games.create`       | `status` 缺席 = 販售中                                                            |
| `updateLotteryGame(input: UpdateLotteryGameInput!): LotteryGamePayload!`                | `master-data.games.edit`         | 見下方缺席 / null                                                                 |
| `deleteLotteryGame(input: { id }): DeleteLotteryGamePayload!`                           | `master-data.games.delete`       | 有庫存 → `GAME_IN_USE`                                                            |
| `lotteryCashPoints(input: LotteryCashPointsInput!): LotteryCashPointsPayload!`          | 綁 `master-data.cash-points`     | 可見範圍內;`orgId?`、`enabled?`、`keyword?`(名稱)+ 分頁;依分店、排序              |
| `lotteryPositionOptions(orgId: ID!): LotteryPositionOptionsPayload!`                    | 綁 `master-data.cash-points`     | 崗位選單 `{ value, label }`;分店不在可見範圍 → 空清單                             |
| `createLotteryCashPoint(input: CreateLotteryCashPointInput!): LotteryCashPointPayload!` | `master-data.cash-points.create` | 新增一律啟用                                                                      |
| `updateLotteryCashPoint(input: UpdateLotteryCashPointInput!): LotteryCashPointPayload!` | `master-data.cash-points.edit`   | 見下方缺席 / null                                                                 |

**缺席與 null**(GQL-06):

- `updateLotteryGame`:缺席 = 不動;必填欄位(`gameCode` / `name` / `unitPrice` / `ticketsPerBook` / `defaultRate` / `status`)送 null 視同缺席;`color` / `launchedAt` / `discontinuedAt` / `claimDeadline` / `note` 送 null = 清空(`$set: null`)。
- `createLotteryGame`:選填欄位缺席或 null = 不設定(null)。
- `updateLotteryCashPoint`:缺席 = 不動;`positionKey` / `name` / `order` / `enabled` 送 null 視同缺席;`printerId` / `note` 送 null = 清空(印表機改回用分店預設)。分店不能改(沒有這個欄位)。
- `createLotteryCashPoint`:`order` 缺席 = 0;`printerId` / `note` 缺席或 null = 不設定。

**回傳欄位語意**:

- `LotteryGame.inUse`:有任何引用檢查回 true。`abilities.canEdit` = 有 `games.edit`;`abilities.canDelete` = 有 `games.delete` 且 `inUse = false`。
- `LotteryCashPoint.positionLabel`:崗位選項的顯示名;選項已不在這家分店的選單裡時為 null(畫面顯示 `positionKey`)。`printer`:null = 用分店預設(讀不到那台印表機時也是 null)。`abilities.canEdit` = 有 `cash-points.edit`。

### lookup 來源 `lottery_game`

登記在 `apps/api/src/project/lookup-providers.ts`(底座 B2a):欄位 `name`(顯示欄)、`gameCode`、`unitPrice`、`ticketsPerBook`、`bookPrice`、`defaultRate`;關鍵字比對名稱與代號;`permission: null`(在可見範圍內公開);**可當固定條件的欄位 `status`**。

「只列販售中」由使用它的表單定義帶 `filter: { status: "on_sale" }`(叫貨單、進貨單的票):底座的 lookup 不讓專案改寫查詢,而依值取回(已存單據的現名解析)仍要讀得到之後停售的遊戲。範圍照底座 = 操作者的**可見範圍**(見「平台視角備註」)。

### 給其他模組的登記介面

| 介面                                 | 檔案                                                                   | 誰登記                      |
| ------------------------------------ | ---------------------------------------------------------------------- | --------------------------- |
| `registerGameUsageChecker`           | `apps/api/src/project/lottery/games/game-usage.ts`                     | P15、P17、P18               |
| `registerCashPointDeactivationGuard` | `apps/api/src/project/lottery/cash-points/cash-point-deactivation.ts`  | P21                         |
| 遊戲詳情頁分頁 `GAME_DETAIL_TABS`    | `apps/admin/src/pages/project/lottery/master-data/game-detail-tabs.ts` | P20(庫存概況、預計要給本數) |

正本:`apps/api/src/project/lottery/`

## admin 頁面

| 頁面              | 檔案                                                | 重點                                                                                                                                                                                                    |
| ----------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 列表(兩個分頁)    | `pages/project/lottery/master-data/MasterDataPage/` | 分頁依綁的模組出現;右上按鈕跟著分頁換(新增遊戲導向新增頁、新增收銀點開彈窗)                                                                                                                             |
| 遊戲分頁          | `GamesTab/`                                         | 篩選列 狀態(預設販售中)/ 面額 / 關鍵字,放網址 `?games=`;點列進詳情;手機改卡片                                                                                                                           |
| 遊戲新增 / 編輯   | `GameFormPage/`                                     | 三個可收合區塊(遊戲資訊 / 顏色 / 備註);單張金額是可輸入的下拉(datalist),選預設面額帶入張數、非標準提示;整本金額即時算;有庫存時提示並唯讀;儲存列固定底部                                                 |
| 遊戲詳情          | `GameViewPage/`                                     | 標題卡 + 分頁(`game-detail-tabs.ts`,本票只有「基本資料」);[編輯] 看 `abilities.canEdit`                                                                                                                 |
| 收銀點分頁 + 彈窗 | `CashPointsTab/`、`CashPointDialog/`                | 每列 [編輯] 看 `abilities.canEdit`,記在網址 `?edit=`;選崗位自動帶入名稱;「找不到?到欄位管理新增」只在有欄位管理時出現;印表機選單只在有 `api.printing.print` 時出現;分店選單 = 管理範圍 + 自己的所屬組織 |

文案 namespace `admin.lotteryMasterData`;錯誤解讀 `master-data-error.ts`。

## 錯誤碼

只用通用碼(GQL-04),細分原因放 `extensions.reason`:

| code / reason                                                 | 何時                           | 畫面                     |
| ------------------------------------------------------------- | ------------------------------ | ------------------------ |
| `FORBIDDEN`                                                   | 沒有寫入權限、沒綁讀取要的模組 | 「你沒有這個操作的權限」 |
| `NOT_FOUND`                                                   | 別租戶 / 不在可見範圍 / 已刪除 | 「找不到這筆資料」       |
| `VALIDATION_FAILED`                                           | 欄位不合(`fields` 標回欄位)    | 欄位標紅 + 通用說明      |
| `VALIDATION_FAILED` + `GAME_CODE_DUPLICATE`                   | 代號在租戶內重複               | 「遊戲代號已被使用」     |
| `VALIDATION_FAILED` + `GAME_IN_USE`                           | 有庫存還改鎖定欄位 / 刪除      | 說明鎖定原因             |
| `VALIDATION_FAILED` + `POSITION_DUPLICATE` / `NAME_DUPLICATE` | 同分店重複                     | 對應說明                 |
| `VALIDATION_FAILED` + `CASH_POINT_IN_USE`                     | 停用守門擋下                   | 說明不能停用的原因       |

## 稽核

`lottery-game.create` / `.edit` / `.delete`(`targetType = lottery_game`)、`lottery-cash-point.create` / `.edit`(`targetType = lottery_cash_point`;停用 / 啟用也是 `edit`);`before` / `after` 只放有變的欄位。

## 測試

- api:`apps/api/src/project/lottery/games/games.test.ts`(面額每列 + 非標準、代號格式與唯一、範圍、權限、有庫存鎖定與刪除)、`game-lookup.test.ts`(lookup 只列販售中)、`cash-points/cash-points.test.ts`(重複、不能刪除、停用守門、範圍)。專案模組不在 api 測試的底座 seed 裡,模組樹與權限由 `test-support/master-data-fixtures.ts` 寫進測試資料庫。
- admin:`MasterDataPage.test.tsx`(分頁與按鈕依權限、收銀點彈窗)、`GameFormPage.test.tsx`(帶入張數、非標準提示、鎖定、刪除、詳情的 [編輯])。MSW world `apps/admin/src/test/msw/project/lottery/`(mock 模式共用)。
- 開通 / 示範:`apps/db-migrator/seeds/project/onboarding/onboarding-api.test.ts`、`demo/demo-data.test.ts`。

## 使用者說明(help.md)

`apps/admin/src/md/module-help/project/additions/master-data.help.md`

## 平台視角備註

- lookup `lottery_game` 的範圍是底座固定的**可見範圍**:遊戲掛在最上層組織,只屬於分店的人(例:只屬於中山店的店長)看不到上層的資料,所以在表單裡查不到遊戲。叫貨單 / 進貨單由分店人員填時要處理(P17 決定:請總部人員填、或擴充底座 lookup 的範圍),見本票回報。
