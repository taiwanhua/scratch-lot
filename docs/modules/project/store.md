# 店面管理(技術)

## 用途

店裡每天收錢、賣刮刮樂的地方(專案規格第 6 章):**看板**(每個收銀點的標題列與檯面上的本)、**本機收銀點**(每台裝置設定、存在瀏覽器)、**收銀班次**(開班、班次資訊、改對應排班)、**投庫 / 出庫**、**抽屜應有現金**與看板的**即時同步**。銷售、兌獎、拆本、盤點、交班結帳、日結、存銀行與四張表單(撤銷售出申請、現金更正單、盤點確認申請、結帳確認申請)由之後的功能各自加上。

正本:`apps/db-migrator/seeds/project/store.ts`、`packages/domain/src/project/lottery/store.ts`

## 模組 key 與畫面

| key                 | 名稱     | sidebarType  | 路由                 | 說明                                                                                              |
| ------------------- | -------- | ------------ | -------------------- | ------------------------------------------------------------------------------------------------- |
| `store`             | 店面管理 | link(列表頁) | `/store`             | 表單模組(開啟 B9b);列表頁換成分頁頁殼 `StorePage`(分頁 看板 \| 班次結帳歷史紀錄 \| … \| 其他申請) |
| `store.view-page`   | 詳情     | hidden       | `/store/view-page`   | 表單引擎的詳情(綁定的表單)                                                                        |
| `store.create-page` | 新增     | hidden       | `/store/create-page` | 表單引擎的新增                                                                                    |
| `store.edit-page`   | 編輯     | hidden       | `/store/edit-page`   | 表單引擎的編輯                                                                                    |

- 側欄順序 `order: 10`、圖示 `store`;沒有側欄數字。
- **開啟 B9b**(`perFormCreate`):每張表單發布時自動建 `store.create-<formKey>`(新增資格看它,不看模組 `create`)。
- 分頁登記在 `apps/admin/src/pages/project/lottery/store/store-tabs.ts`,各功能依規格 6.1 的順序追加自己那一列;本票有 看板(`store.view`)與 其他申請(表單引擎的預設列表 `FormListPage`)。
- 網址狀態:`?tab=`、看板的分店 `?org=`、其他申請的篩選 `?list=`(`app/project/url-state-inventory.ts`)。
- 共用元件(`apps/admin/src/components/project/lottery/`):`CashPointHeader`(收銀點標題列;按鈕用 `actions` 陣列,之後的功能追加 [兌獎] [拆本] [最近售出]…)、`BoardBookCard`(看板卡片;點卡片展開由銷售的功能接上)。

正本:`apps/db-migrator/seeds/project/store.ts`、`apps/admin/src/app/project/module-pages.ts`

## 權限表

規格 3.2:表單模組固定四條 + 頁內權限;開啟 B9b 的 `store.create-<formKey>` 由表單發布時建立。

| 權限 key               | moduleId 指向 | 它是哪一頁的什麼                                                                                                    |
| ---------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------- |
| `<每個節點>.*`         | 各節點        | wildcard;seed 自動產生                                                                                              |
| `store.view`           | `store`       | 看板分頁 + `lotteryStoreBoard`、`lotteryShiftInfo`;換發 `board:<分店>` 憑證的資格(`project/realtime-boards.ts`)     |
| `store.create`         | `store`       | 表單引擎的新增(開啟 B9b 後,有表單時改看 `store.create-<formKey>`)                                                   |
| `store.edit`           | `store`       | 表單引擎的編輯;**也代表「店長」**:可以改別人的班的對應排班(見「班次」)                                              |
| `store.delete`         | `store`       | 表單引擎的刪除                                                                                                      |
| `store.sell`           | `store`       | 銷售(銷售的功能)                                                                                                    |
| `store.undo-sale`      | `store`       | 當下撤銷售出(銷售的功能)                                                                                            |
| `store.split`          | `store`       | 拆本(銷售的功能)                                                                                                    |
| `store.move`           | `store`       | 移櫃、收回、移櫃並售出(銷售的功能)                                                                                  |
| `store.redeem`         | `store`       | 兌獎(兌獎的功能)                                                                                                    |
| `store.undo-redeem`    | `store`       | 撤銷已結帳的班或別人登記的兌獎(兌獎的功能)                                                                          |
| `store.open-shift`     | `store`       | 未開班的收銀點 [開班] + `lotteryStoreOpenShiftForm`、`openLotteryShift`、開班視窗的 [打卡] `punchLotteryShiftStart` |
| `store.deposit`        | `store`       | 本機收銀點開班中 [投庫] + `depositLotteryShiftCash`                                                                 |
| `store.withdraw`       | `store`       | 本機收銀點開班中 [出庫] + `withdrawLotteryShiftCash`;開班視窗的「從小金庫領零用金」(第一班)                         |
| `store.bank-deposit`   | `store`       | 存銀行(存銀行的功能)                                                                                                |
| `store.stocktake`      | `store`       | 盤點(盤點的功能)                                                                                                    |
| `store.checkout`       | `store`       | 交班結帳與日結(結帳的功能)                                                                                          |
| `store.skip-stocktake` | `store`       | 交班結帳、日結的「跳過盤點」(結帳的功能)                                                                            |
| `store.confirm-lost`   | `store`       | 盤點待查清單的 [確認遺失](盤點的功能)                                                                               |

- **沒有權限時**(按鈕直接不顯示):沒有 `store.open-shift` 看不到 [開班];沒有 `store.deposit` 看不到 [投庫];沒有 `store.withdraw` 看不到 [出庫](開班視窗沒有「從小金庫領零用金」)。
- 開通時建立的角色(規格 3.3,`apps/db-migrator/seeds/project/onboarding/role-grants/store.ts`):總部管理、店長 店面管理全部(各節點 `*`,含 `bank-deposit`);店員 `view`、`sell`、`undo-sale`、`split`、`move`、`redeem`、`open-shift`、`deposit`、`withdraw`、`stocktake`、`checkout`(不含 `bank-deposit`、`undo-redeem`、`skip-stocktake`、`confirm-lost`;撤銷售出與現金更正的 `create-<formKey>` 由那兩張表單的功能追加)。

## 頁面規則

### 看板(ST-01 / 02 / 34)

- 頂部:分店選擇器 `OrgTreeSelect scope="visible"`(預設目前組織,`?org=`)、本機收銀點下拉、「你開著的班:店內櫃台 · 店外攤位」(自己在這家店開著兩個以上的班時)、連線狀態小圓點(`useRealtimeStatus`:綠 = 即時、黃 = 重新連線中);沒有重新整理按鈕。上次日結、[盤點] [存銀行] [日結]、距上次盤點超過 24 小時的提醒由各自的功能加上。
- 每個啟用中的收銀點一條 `CashPointHeader`(依收銀點排序、名稱 `zh-Hant`),下面是檯面上的本(`BoardBookCard`)。
- 標題列按鈕(依狀態與權限):未開班 → [開班];開班中的本機收銀點 → [投庫] [出庫];開班中的其他收銀點、負責人是自己 → [切換到這個收銀點];其他只顯示狀態。
- 開班中的標題列:「負責人 王小明 · 08:02 開班」(臨時代班加「未對應排班」;點這一行開班次資訊)、本班已售(張 / 金額,售出 − 撤銷)、應有現金。
- 卡片:遊戲代號 + 名稱、面額、本號(6 位)· 今日售出、剩餘進度條、「剩 N / 總數」、剩很少(剩餘 ≤ 總張數 10%,`isLowStock`)。左側色條 = 遊戲顏色(標籤色票;沒設 = 灰)。
- **本機收銀點**:存在瀏覽器 `localStorage`(`lottery-store.local-cash-point.<分店>`,`lib/project/lottery/local-cash-point.ts`),依分店分開記;讀不到當作沒設定。沒設定 → 提示「這台裝置還沒設定本機收銀點…」+ [設定本機收銀點](ST-03);本機收銀點沒開班 → 提示只能查看。
- 切換本機收銀點時,目前的本機收銀點是自己開著的班 → 先確認(ST-34b)。

### 開班(ST-04a / b / c)

- 期初零用金:**第一班**(這個收銀點沒有上一班,或上一班已被日結涵蓋)有 `store.withdraw` 時多一欄「從小金庫領零用金」(選填);**其他班** = 上一班「留給下一班」(唯讀,顯示來源)。
- 對應排班必選:預選 `findEntryForShift` 的結果;可改選這個人這天在這家店的其他排班,或「沒有排班(臨時代班)」。
- 選的排班沒有填進收銀點崗位的人力需求 → 提醒「你今天排的是「補貨」,確定要在店內櫃台開班嗎?」,按鈕改 [仍要開班](只提醒,照樣開班並記錄)。
- 選的排班還沒打上班卡、有 `schedule.my.punch` → 提示卡「你還沒打上班卡 [打卡]」。

### 班次資訊與改對應排班(ST-42a / b)

- 班次資訊:負責人與開班時間、期初零用金、對應排班、任務快照;開班時崗位不一致時另外標示。
- [改對應排班]:api 回 `canReassign`(負責人或店長、交班結帳送出前)才顯示;選負責人那天在這家店的另一筆排班或「沒有排班」,原因必填(欄位管理「改對應排班原因」`schedule-entry-reassign-reason`,選「其他」說明必填)。

### 投庫 / 出庫(ST-12a / b)

- 投庫:顯示這個收銀點的應有現金;金額超過 → api 擋下(`AMOUNT_EXCEEDS_DRAWER`)。出庫:顯示小金庫應有;原因必填(欄位管理「出庫原因」`lottery-withdraw-reason`)。不用審核,做完就生效;「自動列印」由列印的功能加上。

## api 介面

### GraphQL

| 端點                                     | 權限                       | 說明                                                                                                                                      |
| ---------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `lotteryStoreBoard(orgId)`               | `store.view`               | 看板:啟用中的收銀點(排序)、各自開著的班(負責人、`isMine`、期初、應有、本班已售、未對應排班)、檯面上的本;`myOpenShifts`;小金庫應有         |
| `lotteryStoreOpenShiftForm(cashPointId)` | `store.open-shift`         | 開班視窗:`plan`(`first` / `handover`)、上一班留給下一班與來源、`canTakeFloat`、`suggestedEntryId`、這天的排班(任務、快照、是否已打上班卡) |
| `openLotteryShift(input)`                | `store.open-shift`         | `{ cashPointId, scheduleEntryId?, temporaryCover, floatFromVault? }`                                                                      |
| `punchLotteryShiftStart(entryId)`        | `store.open-shift`         | 打這一班的上班卡(排班模組再查 `schedule.my.punch`)                                                                                        |
| `lotteryShiftInfo(id)`                   | `store.view`               | 班次資訊 + `canReassign` + 可以改選的排班                                                                                                 |
| `reassignLotteryShiftEntry(input)`       | 負責人或店長(service 判斷) | `{ shiftId, scheduleEntryId?, temporaryCover, reasonKey, reasonNote? }`                                                                   |
| `depositLotteryShiftCash(input)`         | `store.deposit`            | `{ shiftId, amount, note? }`                                                                                                              |
| `withdrawLotteryShiftCash(input)`        | `store.withdraw`           | `{ shiftId, amount, reasonKey, reasonNote?, note? }`                                                                                      |

- 排班只經 `ScheduleModule` 匯出的 `ScheduleEntryLookup` 讀(`findEntryForShift` / `listEntriesOfDay` / `taskSnapshotFor` / `punchStart` / `hasStartPunch`;依賴方向刮刮樂 → 排班)。
- 現金流水經 `CashLedgerService.recordCashMovement`(交易內)。出庫原因的欄位管理選項對到流水的原因代碼:「開班零用金」→ `opening_float`、「補零錢」→ `change`、其他(含租戶自己加的選項)→ `other`,選項名稱與說明寫進流水備註(`store-cash.service.ts` 的 `withdrawReasonOf`)。
- 讀取照操作者的可見範圍;負責人名稱以租戶邊界讀(`shift-views.ts`,反查)。

正本:`apps/api/src/project/lottery/store/`、`packages/graphql/src/documents/project/lottery/store.graphql`

## 資料

### 收銀班次 `lottery_shifts`

| 欄位                                                    | 說明                                                                                         |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `orgId`、`cashPointId`                                  | 分店、收銀點                                                                                 |
| `openedBy`、`openedAt`                                  | 開班的人就是負責人                                                                           |
| `openingFloat`、`openingFloatSource`、`previousShiftId` | 期初零用金與來源(`vault` 第一班從小金庫領 / `none` 第一班沒領 / `handover` 上一班留給下一班) |
| `openingMovementId`                                     | 第一班領零用金寫的出庫流水(期初已算進 `openingFloat`,抽屜應有的現金流水來源扣掉這一筆)       |
| `scheduleEntryId`、`scheduleTaskSnapshot`               | 對應排班(臨時代班 = null)、任務快照(職責 + 任務內容 + 崗位;改對應排班時重寫)                 |
| `positionMismatch`                                      | 崗位不一致的提醒紀錄 `{ cashPointPositionKey, entryPositionKeys }`;一致或臨時代班 = null     |
| `closedAt`、`checkoutId`                                | 送出交班結帳時填(結帳的功能)                                                                 |
| `drawerVersion`                                         | 動到這一班抽屜的動作在交易內先 +1,同一班同時的投庫互相衝突、重試時依序檢查                   |

- 部分唯一索引 `(cashPointId)`(`closedAt`、`deletedAt` 為 null):同一個收銀點同時只能有一班;兩人同時開班由索引擋下後到的(`SHIFT_ALREADY_OPEN`)。
- 一個人只能同時開同一家店的班:開班時以租戶邊界查他在別家店開著的班(`SHIFT_IN_OTHER_STORE`)。
- 資料共用 `private`;模組 key `store`;清空示範機構依 `tenantId` 刪(`project/database/tenant-purge.ts`)。
- 第一班的判斷用兩個登記(`lottery/store/previous-shift.ts`):`registerHandoverAmount`(交班結帳登記「留給下一班」)、`registerDailyCloseCoverage`(日結登記「已被日結涵蓋」);沒有登記 = 留給下一班 0、沒被涵蓋。上一班的交班結帳被退回、修改留給下一班時,下一班的期初由結帳的功能更新。

### 抽屜應有

`expectedDrawerCash(reader, shift)`(`lottery/store/drawer-cash.ts`)= 期初零用金 + 每個登記來源的淨額(流入抽屜 +、流出 −)。來源以 `registerDrawerCashSource(name, source)` 登記(名稱全域唯一):

| 來源             | 登記處                   | 算什麼                                                                                  |
| ---------------- | ------------------------ | --------------------------------------------------------------------------------------- |
| `ticket-events`  | `store-registrations.ts` | 這一班的張數事件:`cashEffect` 增加(售出)+、減少(撤銷)−                                  |
| `cash-movements` | `store-registrations.ts` | 這一班的現金流水(投庫、出庫、調貨、退貨退款、現金更正);扣掉開班領零用金那一筆(已是期初) |

兌獎等之後的項目由那些功能在自己的 provider `onModuleInit` 登記自己的來源。

### 對其他功能的登記(`store-registrations.ts`)

| 登記                                              | 給誰                     | 內容                                                                          |
| ------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------- |
| `registerOpenShiftResolver`(`cash/open-shift.ts`) | 收付(現金來源選抽屜)     | 收銀點開著的班                                                                |
| `registerOpenDrawersLister`(`cash/open-shift.ts`) | 即時現金帳、收付付款視窗 | 分店開著班的收銀點抽屜與應有(即時現金帳列出;付款視窗的現金來源 `cashDrawers`) |
| `registerCashPointDeactivationGuard`              | 檔案管理的收銀點停用     | 有開著的班、或檯面上還有未售的張 → 不能停用                                   |
| `registerPositionAnnotationProvider`              | 排班表(崗位旁的註記)     | 這家店各收銀點:崗位 → 收銀點名稱                                              |
| `registerEntryDeletionGuard`                      | 排班作業刪除排班         | 已被收銀班次綁定的排班不能刪                                                  |

這些查詢沒有操作者(或問的是整個租戶),以租戶邊界的系統身分讀(`project/database/tenant-boundary-callers.ts`,系統重算)。

### 即時同步

- 看板頻道登記 `{ key: "store-board", moduleKey: "store", permission: "store.view" }`(`apps/api/src/project/realtime-boards.ts`):換發含 `board:<分店>` 的憑證時,只在持有 `store.view` 且那家店在可見範圍內時放進去(RT-04)。
- 開班、投庫、出庫、改對應排班後對 `board:<分店>` 送 `board` 信號(交易提交後;每 2 秒合併,RT-05;`store-board-signal.ts`)。之後的功能(銷售、兌獎…)呼叫同一支。
- 前端:看板頁 `useRealtimeBoard("store-board", orgId)`;`board` 信號 invalidate 看板資料(`apps/admin/src/app/project/realtime-signals.ts`)。

### 稽核

| action                         | targetType      | 什麼時候                                                   |
| ------------------------------ | --------------- | ---------------------------------------------------------- |
| `lottery-shift.reassign-entry` | `lottery_shift` | 改對應排班(before / after:對應排班、任務快照;after 含原因) |

### 錯誤碼

| code                | reason                          | 什麼時候                                                   |
| ------------------- | ------------------------------- | ---------------------------------------------------------- |
| `VALIDATION_FAILED` | `SHIFT_ALREADY_OPEN`            | 這個收銀點已經有開著的班(含兩人同時開班的後到者)           |
| `VALIDATION_FAILED` | `SHIFT_IN_OTHER_STORE`          | 操作者在別家店還有開著的班                                 |
| `VALIDATION_FAILED` | `SHIFT_CLOSED`                  | 這一班已送出交班結帳(改對應排班、投庫、出庫)               |
| `VALIDATION_FAILED` | `CASH_POINT_DISABLED`           | 收銀點已停用                                               |
| `VALIDATION_FAILED` | `ENTRY_NOT_AVAILABLE`           | 選的排班不是這個人那天在這家店的排班                       |
| `VALIDATION_FAILED` | `OPENING_FLOAT_NOT_ALLOWED`     | 不是第一班、或沒有 `store.withdraw`,卻要從小金庫領零用金   |
| `VALIDATION_FAILED` | `AMOUNT_EXCEEDS_DRAWER`         | 投庫金額超過抽屜目前的應有                                 |
| `VALIDATION_FAILED` | —(`fields: scheduleEntryId` 等) | 沒選對應排班、金額不是正整數、原因沒選或選「其他」沒寫說明 |
| `FORBIDDEN`         | —                               | 沒有那條權限;改對應排班不是負責人也不是店長                |
| `NOT_FOUND`         | —                               | 分店、收銀點或班次不存在 / 看不到                          |

### 測試

`apps/api/src/project/lottery/store/store.test.ts`(端點 + 真 MongoDB:開班、同店兩個收銀點 / 跨店、同時開班、對應排班與快照、崗位不一致、改對應排班、投庫 / 出庫、同時投庫、排班刪除守門、收銀點停用守門、收付與即時現金帳的登記、看板卡片)、`store-board-ticket.test.ts`(`board:<分店>` 換發,RT-04)、`apps/db-migrator/seeds/project/store.test.ts`(模組宣告與角色配方)、`packages/domain/src/project/lottery/store.test.ts`。

## 使用者說明(help.md)

`apps/admin/src/md/module-help/project/additions/store.help.md`(租戶使用者看的說明;守詞彙表)。admin 元件測試:`StorePage.test.tsx`;假 api `apps/admin/src/test/msw/project/lottery/store-handlers.ts`。
