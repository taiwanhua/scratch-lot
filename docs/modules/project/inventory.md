# 庫存管理(技術)

## 用途

刮刮樂的本、張與張數事件(專案規格第 7 章):**庫存**(以本為單位的列表、查刮刮樂)、**本的詳情**(張數格子、事件時間軸、來源、成本;更正跳號、尋回、報廢)、**待查·遺失**、**預計要給本數**(分店 × 遊戲)。本、張、張數事件與預計要給本數四張表是進貨、調貨、店面、盤點、庫存管理共用的帳本(見「資料與帳本」)。

遊戲詳情(檔案管理)的「庫存概況」「預計要給本數」與乙類詳情(經銷商管理)的「預計要給本數」「在店庫存」分頁讀同一份資料、守同一個權限。

正本:`apps/db-migrator/seeds/project/inventory.ts`、`packages/domain/src/project/lottery/inventory.ts`

## 模組 key 與畫面

| key                   | 名稱     | sidebarType  | 路由                                | 說明                                                                                                                               |
| --------------------- | -------- | ------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `inventory`           | 庫存管理 | link(列表頁) | `/inventory`                        | 分頁 庫存 \| 待查·遺失 \| 預計要給本數(Figma IN-01 91:17、IN-05 91:1109、IN-06 91:1375);右上 [查刮刮樂](IN-02)                     |
| `inventory.book-page` | 本的詳情 | hidden       | `/inventory/book-page/<id>?ticket=` | 頁首、來源 / 所在 / 成本、張數格子與選張操作列、事件時間軸(IN-03 125:1159 / 125:1699);更正跳號 / 尋回 / 報廢是彈窗(IN-04a / b / c) |

- 側欄順序 `order: 20`、圖示 `inventory`;沒有側欄數字。
- 分頁**不是模組節點**:綁了模組三個分頁都看得到(本模組沒有 `view`)。
- `?ticket=071`(查刮刮樂帶來的張號):打開本的詳情時把那一張選起來(標亮)。
- 查刮刮樂開著時宣告掃描用途 `inventory-lookup`(`useScanner`;條碼槍讀到的碼填進輸入框)。
- 共用元件(`apps/admin/src/components/project/lottery/`):`RecoverTicketDialog`(尋回;店面刷到待查或遺失的張也用它)、`AllocationsTable`(預計要給本數;三處共用)、`StockOverviewTable`(庫存概況 / 在店庫存)、`InventoryDetailTabs`(遊戲詳情、乙類詳情的四個分頁內容,登記在 `game-detail-tabs.ts` / `dealer-detail-tabs.ts`)、`ReasonFields`(原因下拉 + 說明)。

正本:`apps/db-migrator/seeds/project/inventory.ts`、`apps/admin/src/app/project/module-pages.ts`

## 權限表

規格 3.2 的 `inventory` **沒有 `view`**:讀取看模組有沒有綁(`InventoryAccess.assertModule`);遊戲詳情、乙類詳情的四個分頁在分頁登記加 `visible: hasInventoryModule`,沒綁庫存管理時不顯示。

| 權限 key                     | moduleId 指向 | 它是哪一頁的什麼                                                                                           |
| ---------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------- |
| `<每個節點>.*`               | 各節點        | wildcard;seed 自動產生                                                                                     |
| `inventory.mark-skipped`     | `inventory`   | 本的詳情 [更正跳號](這本有跳號時;`abilities.canCorrectSkips`)+ `correctLotterySkippedTickets`              |
| `inventory.recover`          | `inventory`   | 本的詳情選張 [尋回]、[整本尋回]、待查·遺失分頁 [尋回]、店面刷到待查 / 遺失的提示 + `recoverLotteryTickets` |
| `inventory.scrap`            | `inventory`   | 本的詳情選未售的張 [報廢] + `scrapLotteryTickets`                                                          |
| `inventory.show-cost`        | `inventory`   | 本的詳情的成本卡、待查·遺失的批購成本、報廢的損失(沒有時 api 回 null、畫面不顯示)                          |
| `inventory.edit-allocations` | `inventory`   | 預計要給本數點格子修改(庫存管理、遊戲詳情、乙類詳情三處;`canEdit`)+ `setLotteryAllocation`;沒有時唯讀      |

開通時建立的角色(規格 3.3,`apps/db-migrator/seeds/project/onboarding/role-grants/inventory.ts`):總部管理全部;店長 `mark-skipped`、`recover`、`scrap`、`show-cost`(不含 `edit-allocations`);店員不給。

## 頁面規則

### 庫存分頁(IN-01)

- 分店選擇器 `OrgTreeSelect scope="visible"`,預設目前組織,記在網址 `?stock=`;列出那個組織與它底下的分店**持有任何一張**的本(`holderOrgIds`)。
- 欄位:本編號(開頭 0 顯示 6 位)、遊戲、面額、所在分店(拆開的本顯示「台北 70 / 新竹 30」)、剩餘 / 總張數、待標註、批購日、進貨甲類;篩選:遊戲、狀態(未拆 / 檯面中 / 售完 / 有待標註)、批購日起迄、本號。最多 500 本。

### 本的詳情(IN-03)

- 格子狀態:未售 / 已售 / 跳號 / 報廢 / 待查·遺失 / 已選;被單據鎖定的未售顯示「已售 / 不能選」。能選:未售、待查·遺失。
- 選張後的操作列:全部未售 → [報廢];全部待查 / 遺失 → [尋回];混在一起只有 [取消選取]。
- 整本(可用的張)都待查或遺失 → 頁首狀態列「這本待查中:日期 單號,責任分店 = …」+ [整本尋回]。
- 事件時間軸:同一時間、類型、人、單據、原因、從 → 到的張合成一列(「#041–065」或「整本」);人 / 單據欄有單號顯示單號,否則顯示操作的人。
- 跨班更正(規格的「銷售流水」就是張數事件;規格 6.12、10.4,使用者 10/08 定案):撤銷(當下撤銷、撤銷售出申請完成)和它撤銷的原售出不在同一班 → 類型後面標「(前期更正,屬於 X 班)」,X = 原售出那一班;盤點補登的事後更正(`postCloseOf`)→ 標它指向的那一班。讀取時從同一本的事件找原售出、以班次的 `label` 帶出(`correctionOfShift`),不另存欄位;格式與即時現金帳的流水相同。兌獎的事後更正不是張數事件,不在時間軸上。

### 更正跳號(IN-04a)

- 只有已經有跳號的本(拆本時標過)能更正;改完的張數要等於**待標註張數 = 迄號 − 標準張數**;新標的要是未售、沒被鎖定;原因必填(欄位管理「更正跳號原因」,「其他」要說明)。
- 寫「取消跳號」(原本是跳號、改完不是 → 未售)+「跳號」(新標的),同一個交易;帳本順便重算本的 `skippedTicketNos`。

### 尋回(IN-04b)

- 待查 / 遺失的張 → 未售、庫存、`orgId` = 回到的**店**、清掉責任分店;原因必填(「尋回原因」)。
- 回到的要是操作者看得到的店(`store-orgs.ts` 的 `isVisibleStore`:沒有下層組織;與分店清單共用同一個認定),否則 `VALIDATION_FAILED` `RECOVER_TARGET_NOT_STORE`。畫面:呼叫端給了店(刷到的那家店)就用它;沒給時目前組織是店就回到它,不是店(最上層組織、區域)就選「回到哪家店」(`lotteryInventoryStores`)。
- 張可能在別的分店:經帳本的跨店寫入(只能移進操作者看得到的店)。

### 報廢(IN-04c)

- 只能報**未售**、沒被鎖定的張(位置不變);原因必填(「報廢原因」)。
- 報廢事件存當下的成本快照 `cost`(= 那張的單張成本);**報表的報廢損失加總報廢事件的 `cost`**(四捨五入到元),`amount` 是 0。

### 預計要給本數(IN-06)

- 列 = 操作者看得到的**分店**(看得到的店 `isVisibleStore`,加上有庫存或預計要給本數的組織);欄 = 販售中的遊戲 + 有資料的遊戲。每格「已給 / 預計」;已給 = 整本 N 本 + 零碎「+N 張」;已給超過預計用警告色(只警告)。
- 遊戲詳情 = 一個遊戲、每家分店一列;乙類詳情 = 對應分店、每個遊戲一列(沒有對應分店時只顯示說明)。
- 修改寫 audit_log `lottery-allocation.edit`。

### 待查·遺失(IN-05)

- 列出操作者看得到的分店裡有待查或遺失的張的本,一本 × 一種狀態一列:本、遊戲、狀態、責任分店、來源(最近一筆待查 / 遺失事件的單號與張數)、日期、批購成本、[尋回]。「確認遺失」在盤點確認申請(店面管理)。

### 庫存概況 / 在店庫存

- 分店 × 遊戲:未拆(本;這本在這家店的張全部未售且在庫存)、檯面(張;未售且在檯面)、已售(張)。張照操作者的範圍讀。

## api 介面

### GraphQL

| 端點                                  | 權限                         | 說明                                                                                          |
| ------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------- |
| `lotteryInventoryBooks(input)`        | 綁了 `inventory`             | 庫存分頁;`orgId`(子樹)、`gameId`、`state`、`purchasedFrom` / `purchasedTo`、`bookNo`          |
| `lotteryInventoryBook(id)`            | 綁了 `inventory`             | 本的詳情:本、全部的張(含版本)、所在、事件時間軸、來源、成本(`show-cost`)、狀態列、`abilities` |
| `lotteryTicketLookup(input)`          | 綁了 `inventory`             | 查刮刮樂:`{ gameCode?, bookNo, ticketNo }`;沒有遊戲代號時列出本號對到的每一款                 |
| `lotteryInvestigations`               | 綁了 `inventory`             | 待查·遺失分頁;`canRecover`                                                                    |
| `lotteryAllocations(input)`           | 綁了 `inventory`             | 預計要給本數:`{ orgId?, gameId? }` → 分店、遊戲、格子、`canEdit`                              |
| `lotteryStockOverview(input)`         | 綁了 `inventory`             | 庫存概況 / 在店庫存:`{ orgId?, gameId? }`                                                     |
| `lotteryInventoryStores`              | 登入即可                     | 看得到的店(尋回「回到哪家店」的選項)                                                          |
| `lotteryFieldOptions(categoryKey)`    | 登入即可                     | 刮刮樂的原因類別下拉(只收 `LOTTERY_FIELD_CATEGORY_KEYS`)                                      |
| `setLotteryAllocation(input)`         | `inventory.edit-allocations` | 修改一格(0 以上的整數、備註 200 字內)                                                         |
| `correctLotterySkippedTickets(input)` | `inventory.mark-skipped`     | `{ bookId, ticketNos, reasonKey, reasonNote? }`                                               |
| `recoverLotteryTickets(input)`        | `inventory.recover`          | `{ tickets: [{ ticketId, version }], orgId, reasonKey, reasonNote? }`                         |
| `scrapLotteryTickets(input)`          | `inventory.scrap`            | `{ tickets: [{ ticketId, version }], reasonKey, reasonNote? }` → `lossCost`(`show-cost`)      |

- 讀取範圍:**本**照操作者自己的範圍(所在分店或持有任何一張的分店,資料共用 `holderOrgIds`);讀得到本,就以租戶邊界上下文讀它全部的張與事件(反查,`inventory-view.service.ts`)。
- 組織、使用者名稱以租戶邊界讀(`inventory-names.ts`);收銀點、經銷商、單號照操作者的範圍讀(看不到的不顯示)。
- 原因檢查:底座 `FieldOptionsService.assertReason`(`apps/api/src/fields/field-options.service.ts`;類別白名單 `LOTTERY_FIELD_CATEGORIES`,`apps/api/src/project/lottery/field-options/lottery-field-options.ts`;要是該類別啟用中的選項,「其他」說明必填)。下拉 `lotteryFieldOptions` 用同一支的 `optionsOf`。

正本:`apps/api/src/project/lottery/inventory/`、`packages/graphql/src/documents/project/lottery/inventory.graphql`

## 資料與帳本

四張模組資料表(`moduleKey = inventory`),登記在 `apps/api/src/project/database/lottery-inventory/registration.ts`。

### 所在分店與可見範圍

四張表的 `orgId` 都是**分店**:本 = 所在分店、張 = 目前所在分店、張數事件 = 事件後這張所在的分店、預計要給本數 = 分店。

- 換店(調入、尋回到刷到的那家店、整本調貨)只經帳本服務呼叫底座的搬家入口 `reassignOrg`(一般更新不准改 `orgId`;每搬一筆寫一筆稽核 `data.reassign-org`)。
- 讀取放行(規格 7.1:分店持有某本任何一張,就能讀那一本):本宣告資料共用 `sharedByFields: holderOrgIds`。帳本在張換分店、或跳號進出時重算 `holderOrgIds`;所有可用(非跳號)的張都在同一家店時,本搬到那家店(整本調貨)。
- 張、事件、預計要給本數照可見範圍(`private`):分店的人只看得到自己店的張;中間層(區域)與最上層組織的人照可見性開關看得到底下的分店。
- 四張表**不能是資料範圍目標**:帳本、本的即時計算、預計要給本數、遊戲引用檢查會用租戶邊界上下文讀寫,那個上下文沒有角色,規則會把它收窄(`apps/db-migrator/seeds/project/inventory-data-scope.test.ts` 鎖住)。

### 本 `lottery_books`

| 欄位                                                      | 規則                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `gameId`、`gameCode`                                      | 遊戲與代號快照                                                          |
| `bookNo`                                                  | `^\d{7}$`;輸入 6 位自動補 0;開頭 0 時顯示 6 位                          |
| `bookKey`                                                 | `5164-0056527`,租戶內唯一(部分唯一索引,只算未刪除的);顯示 `5164-056527` |
| `printVersion`                                            | 預設 "1"                                                                |
| `purchaseSubmissionId`、`purchasedAt`、`purchaseDealerId` | 進貨快照                                                                |
| `rate`、`cost`                                            | 批購金額率(整數 %)、成本(元);小數四捨五入                               |
| `standardTickets`                                         | 遊戲整本張數的快照;待標註張數 = 迄號 − 標準張數 − 已標跳號              |
| `firstTicketNo`、`lastTicketNo`                           | 起號一律 "001";迄號 ≥ 標準張數且 ≤ 999                                  |
| `skippedTicketNos`                                        | 跳號(拆本時標註,數量 = 待標註張數)                                      |
| `lockedTicketCount`                                       | 被單據鎖定的張數(lookup 篩「未被鎖定」= 0)                              |
| `status`                                                  | `normal` / `revoked`(進貨單作廢)                                        |

即時計算不存(`@repo/domain/project/lottery` 的 `book-stats.ts`;api `LotteryBooksService.statsOf`):待標註張數、剩餘張數(未售 − 待標註;還沒標的跳號實體不存在)、各分店持有張數(不算跳號)、未拆 / 檯面中 / 售完。

### 張 `lottery_tickets`

| 欄位                             | 規則                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `bookId`、`gameId`、`bookNo`     | 本與快照                                                                                                                        |
| `ticketNo`                       | 3 碼字串                                                                                                                        |
| `ticketKey`                      | `5164-0056527-001`,租戶內唯一                                                                                                   |
| `status`                         | `unsold` / `sold` / `skipped` / `scrapped` / `investigating`(待查)/ `lost`;跳號 = 實體不存在,不算庫存、成本與損失               |
| `location`                       | `{ kind: stock \| counter \| in_transit, cashPointId }`                                                                         |
| `lockedBy`                       | `{ refType: transfer \| sale_reversal, refId }` 或 null;被調貨單鎖定 = 「調貨中」;鎖定時不能賣                                  |
| `responsibleOrgId`               | 待查或遺失時的責任分店                                                                                                          |
| `unitCost`                       | 點收時 = 本的成本 ÷ 標準張數,**不四捨五入**(存除出來的值,一本加總 = 這本的成本;報表加總單張成本後再四捨五入到元);調入時由調貨改 |
| `soldAt`、`soldBy`、`soldSource` | 最近一次售出(`scan` / `manual` / `stocktake`)                                                                                   |
| `version`                        | 樂觀鎖,每次變動 +1;鎖定 / 解除也用掉一個版本(不寫事件)                                                                          |

索引:`(bookId, ticketNo)` 唯一、`(orgId, bookNo, ticketNo)`、`(orgId, location.kind, status)`、`(tenantId, ticketKey)` 唯一。

### 張數事件 `lottery_ticket_events`(只新增)

欄位:`eventId`、`ticketId`、`bookId`、`gameId`、`orgId`、`at`、`by`、`type`、`from`、`to`(狀態、位置、收銀點、所在分店的快照)、`quantity`(一筆一張)、`amount`(**一律正數**)、`cost`(成本快照;報廢寫入)、`cashEffect`(`none` / `increase` / `decrease`)、`cashPointId`、`shiftId`、`refType`、`refId`、`reasonKey`、`reasonNote`。索引 `eventId` 唯一、`(orgId, at)`、`(cashPointId, at)`、`(ticketId, at)`、`(orgId, gameId, type)`。

事件類型(`packages/domain/src/project/lottery/ticket-events.ts`):`purchase` 進貨、`purchase_void` 進貨作廢、`open` 拆本、`recall` 收回、`move` 移櫃、`sale` 售出、`sale_stocktake` 售出(盤點補登)、`sale_undo` 撤銷、`skip` 跳號、`unskip` 取消跳號、`scrap` 報廢、`transfer_out` 調出、`in_transit` 在途、`transfer_in` 調入、`investigate` 待查、`lose` 遺失、`recover` 尋回。

### 帳本服務(唯一入口)

張的目前狀態與事件**只經** `apps/api/src/project/lottery/tickets/ticket-ledger.service.ts` 的 `TicketLedgerService` 寫入,在呼叫端給的同一個交易裡(呼叫端先 `TransactionService.withTransaction`,把 session 傳進來)。第二個參數 `LedgerContext` 決定讀寫範圍:

| `LedgerContext`                                         | 範圍                                                                                                                                                                                            | 用在                                                                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `{ operator }`                                          | 操作者自己的範圍(張要在他的可見範圍內)                                                                                                                                                          | 一般情況:售出、拆本、移櫃、調出、盤點、報廢……                                                                          |
| `{ operator, crossStoreTenantId }`                      | 這個租戶的租戶邊界上下文(例外寫入,仍記得是哪位操作者);**只能把張移進操作者看得到的店**:每一筆都要帶 `patch.orgId`、目標在他的可見範圍內,否則整批 `FORBIDDEN`(`reason: CROSS_STORE_NOT_ALLOWED`) | 張還在別的分店、由這家店的人寫:調入、尋回到刷到的那家店                                                                |
| `{ operator: null, crossStoreTenantId }`                | 租戶系統身分                                                                                                                                                                                    | 沒有操作者的系統寫入;不能換店(搬家要寫稽核)                                                                            |
| `{ operator: null, crossStoreTenantId, systemActorId }` | 租戶系統身分,代表觸發它的人                                                                                                                                                                     | 事後動作的系統寫入要換店(作廢調貨單把張搬回出貨店):目標可以是租戶內任何一家店,搬家稽核與事件的「誰」記 `systemActorId` |

| 方法                                                                                     | 做什麼                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `applyTicketEvents(session, ledger, events)`                                             | 每筆以「`version` = `expectedVersion`(+ `expectedStatuses`)且沒被鎖定(或是 `allowLockedBy` 的同一個鎖)」條件更新,`version` +1,同時新增一筆事件;`patch.orgId` 換店時改走 `reassignOrg`(同一次寫入改狀態與版本)。不符 → `CONFLICT`(「已被處理」),整個交易回復。事件 id = `<ticketId>:<expectedVersion + 1>`:同 id 已寫過且內容相同 → 重送,回 `applied: false`、不重複寫入;內容不同 → `CONFLICT` |
| `lockTickets(session, operator, ticketIds, lock)`                                        | 設定 `lockedBy`(已是同一個鎖 → 不動;被別的鎖住 → `CONFLICT`),本的 `lockedTicketCount` 跟著加;回每張的新版本 `{ ticketId, version, changed }`;只照操作者自己的範圍(不接受跨店)                                                                                                                                                                                                                 |
| `unlockTickets(session, operator, ticketIds, lock)`                                      | 解除自己的鎖(已沒有鎖 → 不動;別的鎖 → `CONFLICT`);回每張的新版本;只照操作者自己的範圍                                                                                                                                                                                                                                                                                                         |
| `lockTicketsInTenant(session, tenantId, ticketIds, lock)` / `unlockTicketsInTenant(...)` | 同 `lockTickets` / `unlockTickets`,以這個租戶的租戶邊界上下文改(事後動作的系統身分只看得到單據的組織,張在別家店);只動這個鎖、不換店、不寫事件                                                                                                                                                                                                                                                 |

- **跨店寫入的限制**:目前只有「移進來」的用途(調入、尋回),所以規則寫成「每筆都要換店、目標看得到」;跨店把別店的張賣掉、報廢、移走一律 `FORBIDDEN`。之後若出現不需要換店的跨店用途,改成依事件類型列白名單,寫在這裡。沒有操作者的系統寫入不受此限(也不能換店)。
- 「誰」(事件的 `by`、售出的 `soldBy`)一律是帳本的操作者;權限與業務規則(誰能賣、能不能撤銷)由呼叫端判斷。
- **鎖定 / 解除會用掉一個版本、不寫事件**:鎖定之後要寫事件,用鎖定回傳的版本當 `expectedVersion`。
- **同時重送時,後到的回 `CONFLICT`**:「重送不重複寫入」只在第一筆已提交之後成立;兩個相同的請求同時進來時,後到的那個在交易重跑後看到版本已變,回「已被處理」,呼叫端照「已被處理」處理(重讀後顯示已售出)。
- 金額不是正數 → `VALIDATION_FAILED`(`fields: ["amount"]`)。
- 張換分店或跳號進出後重算本的持有分店與跳號清單(`skippedTicketNos`),要看整本的張,以這本所在租戶的租戶邊界上下文讀寫(仍記得操作者)。

### 本的建立

`LotteryBooksService.createBook(session, operator, input)`(`books.service.ts`)**只給進貨點收用**,以點收人自己的範圍寫(點收分店要在他的可見範圍內,而且在他當前組織的租戶裡 —— 本編號以這個租戶判斷重複;不是 → `VALIDATION_FAILED`,`reason: STORE_OUTSIDE_TENANT`):本號補 0、本編號(租戶內重複 → `VALIDATION_FAILED`,`reason: BOOK_KEY_DUPLICATE`)、迄號不在「標準張數 ~ 999」→ `VALIDATION_FAILED`(`reason: LAST_TICKET_NO_OUT_OF_RANGE`);以 `createMany` 一次建立 001 到迄號的每一張(未售、庫存、`version` 1)與每張一筆「進貨」事件;回待標註張數(跳號在拆本時標註)。

### 預計要給本數

`LotteryAllocationsService`(`allocations.service.ts`):

- `allocationStatus(operator, orgId, gameId)`:已給 = 進貨 + 調入 − 調出(累計,售出不扣);每本在這家店的淨張數(扣掉跳號)≥ 標準張數算 1 本,否則算「+N 張」,零碎張數不湊成一本(例:進 2 本、調出 30 張 → 1 本 +70 張)。以操作者當前組織所在租戶的租戶邊界上下文讀整個租戶的事件(出貨店也算得出收貨店;反查),別的租戶的分店 → `NOT_FOUND`;權限由呼叫端判斷。叫貨單、進貨單、調貨單「超過只警告」用它。
- `allocationStatuses(operator, orgId, gameIds)`:一家店 × 多個遊戲(叫貨單新增頁);同上的規則,回傳順序同 `gameIds`、沒有資料補 0 列;`allocationStatus` 取它的第一筆。三個方法與 `allocationMatrix` 共用同一份計算 `cellsOf`。
- `allocationMatrix(operator, orgIds, gameIds?)`:多家店 × 多個遊戲一次算(庫存管理的矩陣、遊戲詳情、乙類詳情);只回有設定預計或已給 > 0 的格子;操作者看不到的分店直接略過(防線)。需要算操作者看不到的分店時(例:調貨單由出貨店算收貨店的已給),不要經過 `allocationMatrix`,改走內部的 `cellsOf`(租戶邊界上下文;**權限與可見性由呼叫端負責**)。
- `setAllocation(operator, { orgId, gameId, plannedBooks, note })`:新增或修改(唯一 `(orgId, gameId)`),寫 audit_log `lottery-allocation.edit`;以操作者的範圍寫。

### lookup 來源 `lottery_book`

調貨單選本用(B2d 連動篩選):欄位 `bookKey`、`gameCode`、`bookNo`、`lastTicketNo`;可篩 `gameId`、`orgId`(所在分店)、`holderOrgIds`(在某店)、`lockedTicketCount`(未被鎖定 = 0)、`status`;顯示欄 `bookKey`。範圍照可見範圍 + 資料共用。正本 `apps/api/src/project/lookup-providers.ts`。

### 遊戲引用檢查

`BookGameUsage`(`book-game-usage.ts`)向檔案管理登記 `lottery-books`:租戶內有任何一本引用遊戲 → 遊戲「有庫存」(沒有操作者:租戶邊界上下文 + `existsInTenant`)。

### 例外出口的登記

| 登記檔(`apps/api/src/project/database/`) | 檔案與用途                                                                                                                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `org-reassign-callers.ts`                | `ticket-ledger.service.ts`:張換店、整本調貨                                                                                                                                                                                                      |
| `tenant-boundary-callers.ts`(邊界出口)   | `books.service.ts`(本編號租戶內唯一)、`book-game-usage.ts`(遊戲是否有本)                                                                                                                                                                         |
| `tenant-boundary-callers.ts`(邊界上下文) | `ticket-ledger.service.ts`(例外寫入、系統重算)、`books.service.ts` / `allocations.service.ts`(反查)、`book-game-usage.ts`(系統重算);庫存管理的 `inventory/inventory-view.service.ts`、`inventory-names.ts`、`inventory-actions.service.ts`(反查) |

### 錯誤碼

| code                | reason                              | 什麼時候                                                                      |
| ------------------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| `CONFLICT`          | `TICKET_ALREADY_PROCESSED`          | 條件更新沒命中(`extensions.ticketIds` 列出張)                                 |
| `FORBIDDEN`         | `CROSS_STORE_NOT_ALLOWED`           | 跨店寫入不是把張移進自己看得到的店(`extensions.ticketIds` 列出不合的張)       |
| `VALIDATION_FAILED` | `STORE_OUTSIDE_TENANT`              | 點收分店不在操作者當前組織的租戶                                              |
| `VALIDATION_FAILED` | `BOOK_KEY_DUPLICATE`                | 同一本點收兩次                                                                |
| `VALIDATION_FAILED` | `LAST_TICKET_NO_OUT_OF_RANGE`       | 迄號不在標準張數 ~ 999                                                        |
| `NOT_FOUND`         | —                                   | 遊戲、本或分店不存在 / 看不到                                                 |
| `VALIDATION_FAILED` | `NO_SKIPPED_TICKETS`                | 更正跳號:這本沒有跳號                                                         |
| `VALIDATION_FAILED` | `SKIP_COUNT_MISMATCH`               | 更正跳號:改完的張數不等於待標註張數,或張號不在這本                            |
| `VALIDATION_FAILED` | `SKIP_UNCHANGED`                    | 更正跳號:跟目前的跳號一樣                                                     |
| `VALIDATION_FAILED` | `RECOVER_TARGET_NOT_STORE`          | 尋回:回到的不是店(有下層組織,例:最上層組織)                                   |
| `VALIDATION_FAILED` | `TICKET_STATUS_NOT_ALLOWED`         | 報廢不是未售、尋回不是待查 / 遺失、新標的跳號不是未售(`extensions.ticketIds`) |
| `VALIDATION_FAILED` | —(`fields: reasonKey / reasonNote`) | 原因沒選、不是啟用中的選項,或選「其他」沒寫說明                               |
| `FORBIDDEN`         | —                                   | 沒綁庫存管理(讀取)或沒有那條權限(寫入)                                        |

### 前端共用

- 編號解析 `parseTicketInput`(`@repo/domain/project/lottery`):背面編號 `5164-1-056527-099-0-6`(第 5、6 段不驗證)、正面編號 `056527-099` / `056527099`、正面條碼 `0056527099`,回 `{ format, gameCode?, printVersion?, bookNo(7 位), ticketNo(3 位) }`;沒有遊戲代號時由呼叫端依本店對到的遊戲決定。
- 張數格子 `apps/admin/src/components/project/lottery/TicketGrid/`(`TicketGrid`、`TicketCell` 九種狀態、`TicketGridLegend`):狀態與顏色固定;可選的狀態、每種狀態的文字、圖例項目由使用處傳入。
- 條碼槍 `apps/admin/src/hooks/project/useScanner/`:`useScanner(purpose, handler)`、`registerDefaultScanHandler(handler)`、`injectScan(code)`;判斷門檻 `SCANNER_KEY_INTERVAL_MS = 30`(程式常數;字元間隔不超過 30ms)。

### 測試

`apps/api/src/project/lottery/tickets/tickets.test.ts`(帳本、本的建立、預計要給本數)、`apps/api/src/project/lottery/inventory/inventory.test.ts`(庫存管理的端點:更正跳號、尋回、報廢、讀取放行、預計要給本數三處、庫存概況)、`apps/db-migrator/seeds/project/inventory.test.ts`(模組宣告與角色配方)、`packages/domain/src/project/lottery/*.test.ts`、`TicketGrid.test.tsx`、`useScanner.test.tsx`。

## 使用者說明(help.md)

`apps/admin/src/md/module-help/project/additions/inventory.help.md`(租戶使用者看的說明;守詞彙表)。admin 元件測試:`InventoryPage.test.tsx`、`BookPage.test.tsx`;假 api `apps/admin/src/test/msw/project/lottery/inventory-handlers.ts`。
