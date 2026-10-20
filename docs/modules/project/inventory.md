# 庫存管理(技術)

刮刮樂的本、張與張數事件,是進貨、調貨、店面、盤點、庫存管理共用的帳本(專案規格 7.1、7.2、7.5、7.6)。本檔目前只有「資料與帳本」;模組的用途、畫面與權限表由庫存管理的頁面寫入時補上。

## 資料與帳本

四張模組資料表(`moduleKey = inventory`),登記在 `apps/api/src/project/database/lottery-inventory/registration.ts`。

### 歸屬與所在分店

底座的一般更新不准改 `orgId`(租戶隔離),而本與張會換分店,所以兩件事分開存:

| 表                      | `orgId`(歸屬,建立後不變) | 規格的「所在分店」               | 分店怎麼看得到                                                       |
| ----------------------- | ------------------------ | -------------------------------- | -------------------------------------------------------------------- |
| `lottery_books`         | 最上層組織               | `storeOrgId`(整本調貨時跟著改)   | 資料共用 `sharedByFields`:`storeOrgId`、`holderOrgIds`(持有任何一張) |
| `lottery_tickets`       | 最上層組織               | `storeOrgId`(零碎調貨只改被調的) | 資料共用 `sharedByFields`:`storeOrgId`                               |
| `lottery_ticket_events` | 事件後這張所在的分店     | 同 `orgId`                       | 可見範圍                                                             |
| `lottery_allocations`   | 分店                     | 同 `orgId`                       | 可見範圍                                                             |

- 讀取放行(規格 7.1:分店持有某本任何一張,就能讀那一本)= `holderOrgIds`,由帳本服務在張換分店、或跳號進出時重算;所有可用(非跳號)的張都在同一家店時,`storeOrgId` 改成那家店(整本調貨)。
- 最上層組織的人看得到全部(可見範圍);分店的人看得到自己店的本與張。

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

| 欄位                             | 規則                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `bookId`、`gameId`、`bookNo`     | 本與快照                                                                                                          |
| `ticketNo`                       | 3 碼字串                                                                                                          |
| `ticketKey`                      | `5164-0056527-001`,租戶內唯一                                                                                     |
| `status`                         | `unsold` / `sold` / `skipped` / `scrapped` / `investigating`(待查)/ `lost`;跳號 = 實體不存在,不算庫存、成本與損失 |
| `location`                       | `{ kind: stock \| counter \| in_transit, cashPointId }`                                                           |
| `lockedBy`                       | `{ refType: transfer \| sale_reversal, refId }` 或 null;被調貨單鎖定 = 「調貨中」;鎖定時不能賣                    |
| `responsibleOrgId`               | 待查或遺失時的責任分店                                                                                            |
| `unitCost`                       | 點收時 = 本的成本 ÷ 標準張數(不四捨五入,報表加總);調入時由調貨改                                                  |
| `soldAt`、`soldBy`、`soldSource` | 最近一次售出(`scan` / `manual` / `stocktake`)                                                                     |
| `version`                        | 樂觀鎖,每次變動 +1(含鎖定 / 解除)                                                                                 |

索引:`(bookId, ticketNo)` 唯一、`(storeOrgId, bookNo, ticketNo)`、`(storeOrgId, location.kind, status)`。

### 張數事件 `lottery_ticket_events`(只新增)

欄位:`eventId`、`ticketId`、`bookId`、`gameId`、`orgId`、`at`、`by`、`type`、`from`、`to`(狀態、位置、收銀點、所在分店的快照)、`quantity`(一筆一張)、`amount`(**一律正數**)、`cashEffect`(`none` / `increase` / `decrease`)、`cashPointId`、`shiftId`、`refType`、`refId`、`reasonKey`、`reasonNote`。索引 `eventId` 唯一、`(orgId, at)`、`(cashPointId, at)`、`(ticketId, at)`、`(orgId, gameId, type)`。

事件類型(`packages/domain/src/project/lottery/ticket-events.ts`):`purchase` 進貨、`purchase_void` 進貨作廢、`open` 拆本、`recall` 收回、`move` 移櫃、`sale` 售出、`sale_stocktake` 售出(盤點補登)、`sale_undo` 撤銷、`skip` 跳號、`unskip` 取消跳號、`scrap` 報廢、`transfer_out` 調出、`in_transit` 在途、`transfer_in` 調入、`investigate` 待查、`lose` 遺失、`recover` 尋回。

### 帳本服務(唯一入口)

張的目前狀態與事件**只經** `apps/api/src/project/lottery/tickets/ticket-ledger.service.ts` 的 `TicketLedgerService` 寫入,在呼叫端給的同一個交易裡(呼叫端先 `TransactionService.withTransaction`,把 session 傳進來):

| 方法                                      | 做什麼                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `applyTicketEvents(session, events)`      | 每筆以「`version` = `expectedVersion`(+ `expectedStatuses`)且沒被鎖定(或是 `allowLockedBy` 的同一個鎖)」條件更新,`version` +1,同時新增一筆事件。不符 → `CONFLICT`(「已被處理」),整個交易回復。事件 id = `<ticketId>:<expectedVersion + 1>`:同 id 已寫過且內容相同 → 重送,回 `applied: false`、不重複寫入;內容不同 → `CONFLICT` |
| `lockTickets(session, ticketIds, lock)`   | 設定 `lockedBy`(已是同一個鎖 → 不動;被別的鎖住 → `CONFLICT`),本的 `lockedTicketCount` 跟著加                                                                                                                                                                                                                                   |
| `unlockTickets(session, ticketIds, lock)` | 解除自己的鎖(已沒有鎖 → 不動;別的鎖 → `CONFLICT`)                                                                                                                                                                                                                                                                              |

- 權限與業務規則(誰能賣、能不能撤銷)由呼叫端判斷;帳本以這個租戶的系統身分(`systemTenantReader`)讀寫,同一批事件必須同一個租戶(`tenantId` 寫在每筆事件上)。
- 金額不是正數 → `VALIDATION_FAILED`(`fields: ["amount"]`)。

### 本的建立

`LotteryBooksService.createBook(session, input)`(`books.service.ts`)**只給進貨點收用**:本號補 0、本編號(租戶內重複 → `VALIDATION_FAILED`,`reason: BOOK_KEY_DUPLICATE`)、迄號不在「標準張數 ~ 999」→ `VALIDATION_FAILED`(`reason: LAST_TICKET_NO_OUT_OF_RANGE`);建立 001 到迄號的每一張(未售、庫存、`version` 1)並各寫一筆「進貨」事件;回待標註張數(跳號在拆本時標註)。

### 預計要給本數

`LotteryAllocationsService`(`allocations.service.ts`):

- `allocationStatus(operator, orgId, gameId)`:已給 = 進貨 + 調入 − 調出(累計,售出不扣);每本在這家店的淨張數(扣掉跳號)≥ 標準張數算 1 本,否則算「+N 張」,零碎張數不湊成一本(例:進 2 本、調出 30 張 → 1 本 +70 張)。以操作者的租戶讀整個租戶的事件(出貨店也算得出收貨店);權限由呼叫端判斷。叫貨單、進貨單、調貨單「超過只警告」與庫存管理的矩陣都用它。
- `setAllocation(operator, { orgId, gameId, plannedBooks, note })`:新增或修改(唯一 `(orgId, gameId)`),寫 audit_log `lottery-allocation.edit`;以操作者的範圍寫。

### lookup 來源 `lottery_book`

調貨單選本用(B2d 連動篩選):欄位 `bookKey`、`gameCode`、`bookNo`、`lastTicketNo`;可篩 `gameId`、`storeOrgId`、`holderOrgIds`(在某店)、`lockedTicketCount`(未被鎖定 = 0)、`status`;顯示欄 `bookKey`。範圍照可見範圍 + 資料共用。正本 `apps/api/src/project/lookup-providers.ts`。

### 遊戲引用檢查

`BookGameUsage`(`book-game-usage.ts`)向檔案管理登記 `lottery-books`:租戶內有任何一本引用遊戲 → 遊戲「有庫存」(用 `existsInTenant`,呼叫端登記在 `TENANT_BOUNDARY_CALLERS`)。

### 錯誤碼

| code                | reason                        | 什麼時候                                      |
| ------------------- | ----------------------------- | --------------------------------------------- |
| `CONFLICT`          | `TICKET_ALREADY_PROCESSED`    | 條件更新沒命中(`extensions.ticketIds` 列出張) |
| `VALIDATION_FAILED` | `BOOK_KEY_DUPLICATE`          | 同一本點收兩次                                |
| `VALIDATION_FAILED` | `LAST_TICKET_NO_OUT_OF_RANGE` | 迄號不在標準張數 ~ 999                        |
| `NOT_FOUND`         | —                             | 遊戲、本或分店不存在 / 看不到                 |

### 前端共用

- 編號解析 `parseTicketInput`(`@repo/domain/project/lottery`):背面編號 `5164-1-056527-099-0-6`(第 5、6 段不驗證)、正面編號 `056527-099` / `056527099`、正面條碼 `0056527099`,回 `{ format, gameCode?, printVersion?, bookNo(7 位), ticketNo(3 位) }`;沒有遊戲代號時由呼叫端依本店對到的遊戲決定。
- 張數格子 `apps/admin/src/components/project/lottery/TicketGrid/`(`TicketGrid`、`TicketCell` 九種狀態、`TicketGridLegend`):狀態與顏色固定;可選的狀態、每種狀態的文字、圖例項目由使用處傳入。
- 條碼槍 `apps/admin/src/hooks/project/useScanner/`:`useScanner(purpose, handler)`、`registerDefaultScanHandler(handler)`、`injectScan(code)`;判斷門檻 `SCANNER_KEY_INTERVAL_MS = 30`(程式常數)。

### 測試

`apps/api/src/project/lottery/tickets/tickets.test.ts`(帳本、本的建立、預計要給本數)、`packages/domain/src/project/lottery/*.test.ts`、`TicketGrid.test.tsx`、`useScanner.test.tsx`。
