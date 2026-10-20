# 庫存管理(技術)

刮刮樂的本、張與張數事件,是進貨、調貨、店面、盤點、庫存管理共用的帳本(專案規格 7.1、7.2、7.5、7.6)。本檔目前只有「資料與帳本」;模組的用途、畫面與權限表由庫存管理的頁面寫入時補上。

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

即時計算不存(`@repo/domain/project/lottery` 的 `book-stats.ts`;api `LotteryBooksService.statsOf`):待標註張數、剩餘張數(未售)、各分店持有張數(不算跳號)、未拆 / 檯面中 / 售完。

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

欄位:`eventId`、`ticketId`、`bookId`、`gameId`、`orgId`、`at`、`by`、`type`、`from`、`to`(狀態、位置、收銀點、所在分店的快照)、`quantity`(一筆一張)、`amount`(**一律正數**)、`cashEffect`(`none` / `increase` / `decrease`)、`cashPointId`、`shiftId`、`refType`、`refId`、`reasonKey`、`reasonNote`。索引 `eventId` 唯一、`(orgId, at)`、`(cashPointId, at)`、`(ticketId, at)`、`(orgId, gameId, type)`。

事件類型(`packages/domain/src/project/lottery/ticket-events.ts`):`purchase` 進貨、`purchase_void` 進貨作廢、`open` 拆本、`recall` 收回、`move` 移櫃、`sale` 售出、`sale_stocktake` 售出(盤點補登)、`sale_undo` 撤銷、`skip` 跳號、`unskip` 取消跳號、`scrap` 報廢、`transfer_out` 調出、`in_transit` 在途、`transfer_in` 調入、`investigate` 待查、`lose` 遺失、`recover` 尋回。

### 帳本服務(唯一入口)

張的目前狀態與事件**只經** `apps/api/src/project/lottery/tickets/ticket-ledger.service.ts` 的 `TicketLedgerService` 寫入,在呼叫端給的同一個交易裡(呼叫端先 `TransactionService.withTransaction`,把 session 傳進來)。第二個參數 `LedgerContext` 決定讀寫範圍:

| `LedgerContext`                          | 範圍                                                                                                                                                                                            | 用在                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `{ operator }`                           | 操作者自己的範圍(張要在他的可見範圍內)                                                                                                                                                          | 一般情況:售出、拆本、移櫃、調出、盤點、報廢……           |
| `{ operator, crossStoreTenantId }`       | 這個租戶的租戶邊界上下文(例外寫入,仍記得是哪位操作者);**只能把張移進操作者看得到的店**:每一筆都要帶 `patch.orgId`、目標在他的可見範圍內,否則整批 `FORBIDDEN`(`reason: CROSS_STORE_NOT_ALLOWED`) | 張還在別的分店、由這家店的人寫:調入、尋回到刷到的那家店 |
| `{ operator: null, crossStoreTenantId }` | 租戶系統身分                                                                                                                                                                                    | 沒有操作者的系統寫入;不能換店(搬家要寫稽核)             |

| 方法                                                | 做什麼                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `applyTicketEvents(session, ledger, events)`        | 每筆以「`version` = `expectedVersion`(+ `expectedStatuses`)且沒被鎖定(或是 `allowLockedBy` 的同一個鎖)」條件更新,`version` +1,同時新增一筆事件;`patch.orgId` 換店時改走 `reassignOrg`(同一次寫入改狀態與版本)。不符 → `CONFLICT`(「已被處理」),整個交易回復。事件 id = `<ticketId>:<expectedVersion + 1>`:同 id 已寫過且內容相同 → 重送,回 `applied: false`、不重複寫入;內容不同 → `CONFLICT` |
| `lockTickets(session, operator, ticketIds, lock)`   | 設定 `lockedBy`(已是同一個鎖 → 不動;被別的鎖住 → `CONFLICT`),本的 `lockedTicketCount` 跟著加;回每張的新版本 `{ ticketId, version, changed }`;只照操作者自己的範圍(不接受跨店)                                                                                                                                                                                                                 |
| `unlockTickets(session, operator, ticketIds, lock)` | 解除自己的鎖(已沒有鎖 → 不動;別的鎖 → `CONFLICT`);回每張的新版本;只照操作者自己的範圍                                                                                                                                                                                                                                                                                                         |

- **跨店寫入的限制**:目前只有「移進來」的用途(調入、尋回),所以規則寫成「每筆都要換店、目標看得到」;跨店把別店的張賣掉、報廢、移走一律 `FORBIDDEN`。之後若出現不需要換店的跨店用途,改成依事件類型列白名單,寫在這裡。沒有操作者的系統寫入不受此限(也不能換店)。
- 「誰」(事件的 `by`、售出的 `soldBy`)一律是帳本的操作者;權限與業務規則(誰能賣、能不能撤銷)由呼叫端判斷。
- **鎖定 / 解除會用掉一個版本、不寫事件**:鎖定之後要寫事件,用鎖定回傳的版本當 `expectedVersion`。
- **同時重送時,後到的回 `CONFLICT`**:「重送不重複寫入」只在第一筆已提交之後成立;兩個相同的請求同時進來時,後到的那個在交易重跑後看到版本已變,回「已被處理」,呼叫端照「已被處理」處理(重讀後顯示已售出)。
- 金額不是正數 → `VALIDATION_FAILED`(`fields: ["amount"]`)。
- 張換分店後重算本的持有分店要看整本的張,以這本所在租戶的租戶邊界上下文讀寫(仍記得操作者)。

### 本的建立

`LotteryBooksService.createBook(session, operator, input)`(`books.service.ts`)**只給進貨點收用**,以點收人自己的範圍寫(點收分店要在他的可見範圍內,而且在他當前組織的租戶裡 —— 本編號以這個租戶判斷重複;不是 → `VALIDATION_FAILED`,`reason: STORE_OUTSIDE_TENANT`):本號補 0、本編號(租戶內重複 → `VALIDATION_FAILED`,`reason: BOOK_KEY_DUPLICATE`)、迄號不在「標準張數 ~ 999」→ `VALIDATION_FAILED`(`reason: LAST_TICKET_NO_OUT_OF_RANGE`);以 `createMany` 一次建立 001 到迄號的每一張(未售、庫存、`version` 1)與每張一筆「進貨」事件;回待標註張數(跳號在拆本時標註)。

### 預計要給本數

`LotteryAllocationsService`(`allocations.service.ts`):

- `allocationStatus(operator, orgId, gameId)`:已給 = 進貨 + 調入 − 調出(累計,售出不扣);每本在這家店的淨張數(扣掉跳號)≥ 標準張數算 1 本,否則算「+N 張」,零碎張數不湊成一本(例:進 2 本、調出 30 張 → 1 本 +70 張)。以操作者當前組織所在租戶的租戶邊界上下文讀整個租戶的事件(出貨店也算得出收貨店;反查),別的租戶的分店 → `NOT_FOUND`;權限由呼叫端判斷。叫貨單、進貨單、調貨單「超過只警告」與庫存管理的矩陣都用它。
- `setAllocation(operator, { orgId, gameId, plannedBooks, note })`:新增或修改(唯一 `(orgId, gameId)`),寫 audit_log `lottery-allocation.edit`;以操作者的範圍寫。

### lookup 來源 `lottery_book`

調貨單選本用(B2d 連動篩選):欄位 `bookKey`、`gameCode`、`bookNo`、`lastTicketNo`;可篩 `gameId`、`orgId`(所在分店)、`holderOrgIds`(在某店)、`lockedTicketCount`(未被鎖定 = 0)、`status`;顯示欄 `bookKey`。範圍照可見範圍 + 資料共用。正本 `apps/api/src/project/lookup-providers.ts`。

### 遊戲引用檢查

`BookGameUsage`(`book-game-usage.ts`)向檔案管理登記 `lottery-books`:租戶內有任何一本引用遊戲 → 遊戲「有庫存」(沒有操作者:租戶邊界上下文 + `existsInTenant`)。

### 例外出口的登記

| 登記檔(`apps/api/src/project/database/`) | 檔案與用途                                                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `org-reassign-callers.ts`                | `ticket-ledger.service.ts`:張換店、整本調貨                                                                                         |
| `tenant-boundary-callers.ts`(邊界出口)   | `books.service.ts`(本編號租戶內唯一)、`book-game-usage.ts`(遊戲是否有本)                                                            |
| `tenant-boundary-callers.ts`(邊界上下文) | `ticket-ledger.service.ts`(例外寫入、系統重算)、`books.service.ts` / `allocations.service.ts`(反查)、`book-game-usage.ts`(系統重算) |

### 錯誤碼

| code                | reason                        | 什麼時候                                                                |
| ------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| `CONFLICT`          | `TICKET_ALREADY_PROCESSED`    | 條件更新沒命中(`extensions.ticketIds` 列出張)                           |
| `FORBIDDEN`         | `CROSS_STORE_NOT_ALLOWED`     | 跨店寫入不是把張移進自己看得到的店(`extensions.ticketIds` 列出不合的張) |
| `VALIDATION_FAILED` | `STORE_OUTSIDE_TENANT`        | 點收分店不在操作者當前組織的租戶                                        |
| `VALIDATION_FAILED` | `BOOK_KEY_DUPLICATE`          | 同一本點收兩次                                                          |
| `VALIDATION_FAILED` | `LAST_TICKET_NO_OUT_OF_RANGE` | 迄號不在標準張數 ~ 999                                                  |
| `NOT_FOUND`         | —                             | 遊戲、本或分店不存在 / 看不到                                           |

### 前端共用

- 編號解析 `parseTicketInput`(`@repo/domain/project/lottery`):背面編號 `5164-1-056527-099-0-6`(第 5、6 段不驗證)、正面編號 `056527-099` / `056527099`、正面條碼 `0056527099`,回 `{ format, gameCode?, printVersion?, bookNo(7 位), ticketNo(3 位) }`;沒有遊戲代號時由呼叫端依本店對到的遊戲決定。
- 張數格子 `apps/admin/src/components/project/lottery/TicketGrid/`(`TicketGrid`、`TicketCell` 九種狀態、`TicketGridLegend`):狀態與顏色固定;可選的狀態、每種狀態的文字、圖例項目由使用處傳入。
- 條碼槍 `apps/admin/src/hooks/project/useScanner/`:`useScanner(purpose, handler)`、`registerDefaultScanHandler(handler)`、`injectScan(code)`;判斷門檻 `SCANNER_KEY_INTERVAL_MS = 30`(程式常數;字元間隔不超過 30ms)。

### 測試

`apps/api/src/project/lottery/tickets/tickets.test.ts`(帳本、本的建立、預計要給本數)、`packages/domain/src/project/lottery/*.test.ts`、`TicketGrid.test.tsx`、`useScanner.test.tsx`。
