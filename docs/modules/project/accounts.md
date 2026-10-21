# 帳戶管理(技術)

## 用途

刮刮樂的錢(專案規格第 9 章、10.1–10.4):**銀行帳戶與交易**、**即時現金帳與現金流水**、**收付機制**(進貨單、調貨單的付款 / 退款 / 收款)、**待結清款項**與**關帳**(整個租戶某月的鎖帳)。一頁四個分頁(銀行帳戶 | 即時現金帳 | 待結清款項 | 關帳)。

銀行交易與現金流水是跨功能共用的帳本:店面的出庫 / 投庫 / 存銀行 / 退貨退款 / 現金更正、調貨的現金收付都寫進同一組流水;進貨單、調貨單以收付機制登記後寫進同一組交易。

正本:`apps/db-migrator/seeds/project/accounts.ts`、`packages/domain/src/project/lottery-accounts/`

## 模組 key 與畫面

| key                  | 名稱         | sidebarType  | 路由                       | 說明                                                                                                                                    |
| -------------------- | ------------ | ------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `accounts`           | 帳戶管理     | link(列表頁) | `/accounts`                | 分頁 銀行帳戶 \| 即時現金帳 \| 待結清款項 \| 關帳(Figma AC-01 93:17、AC-04 93:834、AC-05 93:1143、AC-06 93:1417;關帳彈窗 AC-07 93:1664) |
| `accounts.view-page` | 銀行帳戶詳情 | hidden       | `/accounts/view-page/<id>` | 餘額卡、交易清單、帳戶設定(AC-02 93:400);新增帳戶 / 登記交易 / 沖正是彈窗(AC-03a / b / c)                                               |

- 側欄順序 `order: 40`、圖示 `business`;側欄數字 = 待結清款項的筆數(見「規則」)。
- 分頁**不是模組節點**:各看一條 `view-*` 權限(`PageTabs` 的 `permission`);只剩一個時不顯示分頁籤。
- `SettlementPanel`(`apps/admin/src/components/project/lottery/SettlementPanel/`)給進貨單、調貨單的檢視頁用(Figma PU-07 127:2714 / 127:26961 / 127:27369),待結清款項頁的按鈕開同一個付款視窗。

正本:`apps/db-migrator/seeds/project/accounts.ts`、`apps/admin/src/app/project/module-pages.ts`

## 權限表

規格 3.2 的 `accounts` **沒有 `view`**:進不進得去看模組本身;分頁各一條權限。

| 權限 key                            | moduleId 指向 | 它是哪一頁的什麼                                                                                                                                    |
| ----------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<每個節點>.*`                      | 各節點        | wildcard;seed 自動產生                                                                                                                              |
| `accounts.view-bank-accounts`       | `accounts`    | 銀行帳戶分頁、帳戶詳情、`lotteryBankAccounts` / `lotteryBankAccount` / 交易清單                                                                     |
| `accounts.create-bank-account`      | `accounts`    | [+ 新增帳戶] + `createLotteryBankAccount`                                                                                                           |
| `accounts.edit-bank-account`        | `accounts`    | 帳戶設定、[設定使用組織]、停用 / 啟用、沒有交易時 [刪除帳戶](abilities `canEdit` / `canDelete`)                                                     |
| `accounts.record-bank-transaction`  | `accounts`    | [登記交易] + 單據候選 `lotterySettlementCandidates`                                                                                                 |
| `accounts.reverse-bank-transaction` | `accounts`    | 交易清單的 [沖正]                                                                                                                                   |
| `accounts.view-cash`                | `accounts`    | 即時現金帳分頁 + `lotteryCashLedger` / `lotteryCashMovement`                                                                                        |
| `accounts.view-outstanding`         | `accounts`    | 待結清款項分頁 + 側欄數字;每列按鈕沿用單據的權限(進貨單 `settle`、調貨單 `pay` / `receive`)                                                         |
| `accounts.close-period`             | `accounts`    | 關帳分頁、[關帳]、[快照] + `lotteryPeriodCloses` / `lotteryPeriodCloseCheck` / `lotteryPeriodClose` / `closeLotteryPeriod`;關帳逾期提醒的預設收件人 |

收付按鈕(付款視窗、收付的沖正)的權限由單據登記的那一邊決定(`registerSettlementDocument` 的 `sides[].permission`),不是帳戶管理的權限。

**開通時建立的角色**(規格 3.3;配方 `apps/db-migrator/seeds/project/onboarding/role-grants/accounts.ts`):

| 角色     | 模組                             | 權限                            |
| -------- | -------------------------------- | ------------------------------- |
| 總部管理 | `accounts`、`accounts.view-page` | 各節點 `*`(含關帳)              |
| 店長     | `accounts`                       | `view-cash`、`view-outstanding` |
| 店員     | 不給                             | —                               |

正本:`packages/domain/src/project/lottery-accounts/keys.ts`

## 資料

三張模組資料表(`moduleKey = accounts`),欄位與索引的正本是 schema 檔(`apps/api/src/project/database/lottery-accounts/`)。

**`lottery_bank_accounts`**:`orgId`(建立時的當前組織)、`bankCode`(3 碼數字)、`branchName`、`accountNo`、`accountName`、`label`(戶名 + 帳號末 5 碼,api 算後存)、`openingBalance`、`openingDate`(時點)、`status`(`active` / `inactive`)、`note`;唯一 `(tenantId, bankCode, accountNo)`(未刪除的)。

- **使用組織 = 資料共用的 `shareOrgs`**(可共用、預設不共用、可編輯;ADR-0014):全部分店 = `[{ 最上層組織, 含下層 }]`。不另建關聯表。
- 餘額不存:期初 + 交易加總(收 +、支 −)。

**`lottery_bank_transactions`**(只新增):`accountId`、`occurredAt`、`type`、`direction`(`in` / `out`)、`amount`(正整數;單據送出時的自動記帳可以是 0)、`branchOrgId`、`refType` / `refId` / `refRevision`(單據)、`settlementSide`(收付記在哪一邊)、`reversalOf`(唯一:一筆只能被沖正一次)、`summary`、`handler`、`note`;登記人 / 時間 = 基礎欄位。

| 類型                                                                                                 | 方向         |
| ---------------------------------------------------------------------------------------------------- | ------------ |
| `deposit` 存入、`redemption_income` 兌獎入帳、`purchase_income` 批貨收入、`transfer_income` 調貨收入 | 收           |
| `withdrawal` 提領、`license_rent` 牌租、`purchase_expense` 批貨支出、`transfer_expense` 調貨支出     | 支           |
| `adjustment` 調整、`other` 其他(說明必填)                                                            | 使用者選     |
| 沖正(沿用原交易的類型,`reversalOf` 指向原交易)                                                       | 與原交易相反 |

**`lottery_cash_movements`**(只新增;寫入唯一入口 `CashLedgerService`):`orgId`(現金所在的分店)、`occurredAt`、`type`、`from` / `to`(`drawer` / `vault` / `bank` / `external`)、`reason`(出庫原因)、`cashPointId`、`shiftId`、`attributedShiftId`、`amount`、`refType` / `refId` / `refRevision`、`settlementSide`、`payee`、`note`、`reversalOf`(唯一)、`bankTransactionId`。

| 類型                                                       | 從 → 到                     |
| ---------------------------------------------------------- | --------------------------- |
| `withdraw` 出庫(原因 `opening_float` / `change` / `other`) | 小金庫 → 抽屜               |
| `deposit` 投庫                                             | 抽屜 → 小金庫               |
| `bank_deposit` 存銀行                                      | 小金庫 → 銀行(連到銀行存入) |
| `transfer_out` / `transfer_in` 調貨支出 / 收入             | 抽屜或小金庫 ↔ 外部         |
| `refund` 退貨退款                                          | 抽屜 → 外部                 |
| `correction_increase` / `correction_decrease` 現金更正     | 外部 ↔ 抽屜或小金庫         |

**`lottery_period_closes`**(關帳;只新增,repository 的修改 / 刪除一律拋 `AppendOnlyLedgerError`):`orgId`(租戶頂層)、`month`(`YYYY-MM`)、`periodStart` / `periodEnd`(租戶時區 1 日 00:00 至 下月 1 日 00:00,不含)、`closedAt`、`closedBy`、`note`、`snapshot`;唯一 `(tenantId, month)`。

| 快照                      | 內容                                                                                                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `snapshot.bankAccounts[]` | 每個帳戶(期初日期在月底前的)的月底餘額 = 期初 + 月底前交易的收 − 支;名稱是關帳當下的快照,之後改帳號不回頭改                                                                                                                  |
| `snapshot.stores[]`       | 每家有收銀點的分店:月底小金庫應有(`vaultExpected(…, before = periodEnd)`)、各收銀點抽屜(月底前最後一班在月底前結帳 → 它留給下一班的金額;月底還開著的跨月的班 → 金額不記、記那一班)、那個月開的班沒有被日結涵蓋計算的(只警告) |

正本:`apps/api/src/project/database/lottery-accounts/*.schema.ts`、`packages/domain/src/project/lottery-accounts/{bank,cash,period-close}.ts`

## 規則

### 可見範圍

- 帳戶:可見範圍 + 共用(使用組織)。總部(可見範圍含下層)看全部;分店看使用組織包含自己的。看不到的帳戶列表、單筆、交易清單一律 `NOT_FOUND`。
- 修改 / 刪除只對歸屬組織在可見範圍內的帳戶(共用進來的只能看,`abilities` 全 false)。
- 交易:看得到帳戶就看得到它的全部交易(交易可能是別家分店登記的),以租戶邊界讀(`TENANT_BOUNDARY_CONTEXT_CALLERS` 用途「反查」)。
- 現金流水:照可見範圍(分店的現金)。

### 帳戶的修改、刪除、停用

- 銀行代碼、帳號、戶名、分行、狀態、備註、使用組織隨時可改(交易用帳戶 id 指向帳戶;寫稽核)。
- **有交易之後期初餘額、期初日期鎖定**(`BANK_ACCOUNT_HAS_TRANSACTIONS`);「有沒有交易」以租戶邊界出口 `existsInTenant` 問(`TENANT_BOUNDARY_CALLERS`)。
- **沒有任何交易才能刪除**(軟刪除);有交易只能停用。停用的帳戶不能登記交易、付款時選不到。例外是**已送出單據的系統寫入**(`BankTransactionsService.write` 的 `allowInactiveAccount`;例:日結核准完成時寫存入):帳戶在單據送出時已驗過,之後被停用只是不能再被選用,不影響已送出的單(使用者 10/10 進貨單定案)。
- 餘額負數只警告(畫面警示色)。

### 交易

- 方向照類型;調整 / 其他要選方向且說明必填;批貨與調貨歸屬分店必填。
- 批貨收入 / 調貨收入:單據必填,只收有待退或待收的單據(那一邊 [收到退款] / [收款] 的先填 > 0),交易記在那一邊(`settlementSide`)。兌獎入帳:單據選填、不算進任何單據淨額。
- **沖正**:寫一筆同類型、方向相反、同金額的交易(`reversalOf`),原交易不改;已被沖正或本身是沖正 → `ALREADY_REVERSED`;兩人同時沖正由唯一索引擋下後到的。
- 沖正「存入」→ 連結的「存銀行」流水(`bankTransactionId`)自動寫一筆反向(租戶邊界,用途「例外寫入」)。

### 即時現金帳

- **流水一律在交易內寫**(比照 `BaseRepository.createMany`):`recordCashMovement` / `reverseCashMovement` 收 `withTransaction` 給的 session,缺席(`undefined`)= 用進行中的交易(不收 `null`,同 `createMany`);不在交易內 → `CashLedgerOutsideTransactionError`。流水與同一個動作的稽核、單據寫入一起成功、一起回復(稽核寫入失敗 → 流水回復,有測試)。
- 小金庫應有 = `vaultBaseline(orgId)` 的清點金額 + 之後流水對小金庫的加總;**只由流水算**,沒有可被改寫的數字欄位(帳本 repository 的修改 / 刪除方法一律拋 `AppendOnlyLedgerError`)。
- 起算點由日結功能以 `registerVaultBaselineProvider` 登記;登記前一律從 0 起算。
- 抽屜應有由店面(收銀班次)計算:本模組提供 `sumShiftMovements(operator, shiftId)`(流入抽屜 − 流出抽屜);即時現金帳的抽屜卡片讀店面登記的 `openDrawersOf`(`cash/open-shift.ts`;正本 `docs/modules/project/store.md`「抽屜應有」)。

### 收付機制

- 單據以 `registerSettlementDocument({ moduleKey, label, kind, payable(submission), sides })` 登記(`apps/api/src/project/lottery/settlement/settlement-registry.ts`);`sides[]`:`side`、`label`(總部 / 收貨店 / 出貨店)、`role`(`payer` 付款方 / `payee` 收款方)、`permission`、`methods`(`bank` / `cash`)、`defaultAmount(button, state)`、選填 `branchOf`。
- `payable(submission)` 可以是非同步(調貨單要讀點收紀錄);回的 `received`(選填)是付款方先填值的基準,和應付不同時才給,進 `SettlementState.received`(調貨單:已點收的批購金額)。
- 選填 `sharedByValues`:單據存值裡組織欄位的路徑(例 `values.to_branch.id`)。單據歸屬看不到、但這些欄位是讀者可見範圍內的組織時,結算區塊與待結清款項照樣讀得到(調貨單的出貨店、收貨店兩邊);記帳 / 沖正 / 帳戶選項仍要**那一邊的分店**在讀者的可見範圍內(`canSettle` 同),寫入不放大。
- 每一邊兩顆按鈕:`out`(付款 / 退款)、`in`(收到退款 / 收款);先填的金額 ≤ 0 的那一顆停用(`SETTLEMENT_NOTHING_DUE`)。帳一律以實際填的金額為準。預設值的算法在 `@repo/domain/project/lottery-accounts` 的 `payerDefaultAmount` / `payeeDefaultAmount`(規格 9 的驗算表都有測試)。
- 已付淨額 = 支出 − 收入;已收淨額 = 收入 − 支出;可以分次。沖正以反方向計入。
- 淨額只算 `settlementSide` 有值的交易 / 流水。**兌獎入帳**(`redemption_income`)可以掛單據(`refType` / `refId` / `refRevision`),但 `settlementSide` 一律是 null:不算進任何一邊的淨額、不出現在收付歷程;`bankTypeOf` 只會回批貨 / 調貨的支出與收入,不會回兌獎入帳(有測試)。
- **沖正收付**(`reverseSettlement`):要看得到單據、有那一邊的權限,且**這一邊的記帳分店在操作者的可見範圍內**(現金 = 流水的分店;銀行 = 歸屬分店,沒有時看登記的組織),銀行另要求看得到那個帳戶;不符合一律 `NOT_FOUND`。現金沖正以操作者自己的上下文寫。同一筆同時沖正只有一個成功(唯一索引,有併發測試)。
- **自動記帳**(`SettlementService.recordAutomatic(session, { operator, moduleKey, submission, side, button, accountId, amount })`):給單據在交易內記帳用(例:進貨單送出時記第一筆「批貨支出」)。不檢查按鈕權限、不看先填的金額;**金額 0 照記**(進貨單應付 0 也留一筆,淨額不受影響;人工登記仍要正數),負數或不是整數不記(回 null);沿用呼叫端的交易,不在交易內拋 `CashLedgerOutsideTransactionError`;帳戶仍要使用中、使用組織包含這一邊的分店(帳戶以單據的租戶為邊界讀)。
- 銀行:帳戶要使用中、使用組織包含這一邊的分店(`BANK_ACCOUNT_NOT_USABLE`)。現金(只有調貨):經手人 / 收款人必填;來源小金庫,或收銀點抽屜(要有開著的班,`NO_OPEN_SHIFT`;要是這一邊分店的收銀點,`CASH_POINT_NOT_AT_BRANCH`;店面以 `registerOpenShiftResolver` 登記;付款視窗的抽屜選項 = 這一邊的 `cashDrawers`,店面以 `registerOpenDrawersLister` 登記)。
- 作廢 / 駁回前每一邊淨額都要是 0:單據在自己的 `registerFormLifecycle` 掛 `settlementClearedGuard`(`beforeVoid` / `beforeReject`,`inject: [SettlementLedger]`),擋下時 `FORBIDDEN` + `reason = SETTLEMENT_NOT_CLEARED`。
- 參與收付的提交狀態:`reviewing` / `returned` / `withdrawn` / `completed`(草稿、作廢、駁回不算)。

### 待結清款項與側欄數字

- 一張單據的一邊一列(付款方:待付 / 待退;收款方:待收 / 待退),依操作者的可見範圍讀單據;收付以租戶邊界讀(另一邊可能是別家分店記的)。
- 側欄數字 = 待結清的列數;沒有 `view-outstanding` = 0。收付寫入後對操作者送 `badge:accounts`。

### 關帳

- **範圍是整個租戶**,一個月一筆;**依序關帳**(下一個要關的 = 最後一個已關帳月份的下一個;沒關過 = 起始月份,即租戶頂層建立的月份);**只能關已結束的月份**;**永遠關到該月最後一刻**(期間 = 租戶時區 1 日 00:00 至 下月 1 日 00:00,與按下的時間無關;10/31 23:59:59.999 的紀錄算 10 月)。月份規則正本 `@repo/domain/project/lottery-accounts` 的 `period-close.ts`(日期一律經 `form/temporal`)。
- **擋**(`VALIDATION_FAILED` + reason):那個月(含更早)開的班還沒送出交班結帳;下表三種單據**審核中或已退回待更正**,且判斷時間落在那個月。

| 擋的單據     | 用哪個時間判斷屬於哪個月                                                            |
| ------------ | ----------------------------------------------------------------------------------- |
| 撤銷售出申請 | 退款 = 是:退款班次的開班時間(退款 = 否不擋)                                         |
| 現金更正單   | 位置是某一班:那一班的開班時間;位置是小金庫:申請的送出時間(`submittedAt`,不新增欄位) |
| 結帳確認申請 | 交班:那一班(開班至送出交班結帳)與該月重疊;日結:涵蓋計算期間與該月重疊               |

- 盤點確認申請、進貨單、調貨單、叫貨單、支援需求單、補打卡申請,以及銷售、兌獎、投庫、出庫、存銀行**不擋**:它們的帳不是在核准時寫回過去的時間(規格 10.4 的「判斷原則」)。
- **只警告**:那個月開的班沒有被日結涵蓋計算(這家店最近一張日結的涵蓋計算期間終點 < 班送出交班結帳的時間;與店面「第一班的判斷」同一個定義),列在檢查清單並記入快照。
- [關帳] 要輸入相同的月份確認;建立關帳紀錄與稽核在同一個交易。兩人同時關同一個月由唯一索引 `(tenantId, month)` 擋下後到的(`PERIOD_ALREADY_CLOSED`)。
- **已知的低機率競態**:檢查清單(沒結帳的班、審核中的單據)與建立關帳紀錄不在同一個交易裡互鎖;檢查通過到寫入之間剛好有人開班、送出單據,關帳照樣成立。之後那筆紀錄若選到已關帳月份會被 `PeriodLock` 擋下(退款班次、現金更正位置、開班選的排班);其他紀錄照「前期更正」歸類。發生機率低(要在按下 [關帳] 的同一瞬間),目前不另加鎖。
- **不能重新開帳**(規格第 15 章「已決定不做」):關帳後沒有修改、刪除、重新開帳的端點。理由:上個月的錯誤一律**用原本的功能在現在更正**(銀行 [沖正] + [登記交易]、現金更正單、撤銷售出申請、尋回、報廢),紀錄只要指向已關帳月份(沖正的原交易、歸屬班次、撤銷的原售出),報表自動歸「前期更正」;重新開帳會讓已經交出去的月報數字改變、快照失去意義,而且更正的痕跡會消失。
- **不能選已關帳月份**(`PeriodLock`,唯一的判斷):時點 < 最後一個已關帳月份的 `periodEnd` = 已關帳。只檢查使用者自己選時間的欄位:撤銷售出申請的退款班次、現金更正單的位置(某一班,以開班時間)、開班 / 改對應排班選的排班(以開始時間)。歸屬班次可以選已關帳月份的班(只做歸屬)。
- **關帳逾期**(B14;規格 3.4、3.5):每月第 N 天的寄送時間(預設第 3 天 09:00,租戶時區;通知設定頁可調,「每月第 N 天」那個月沒有這一天用月底)檢查上個月沒關帳 → 負責人提醒「關帳逾期」(組織範圍 = 租戶,預設收件人 = 持有 `accounts.close-period`;參數 `period` = 上個月)。上個月租戶還沒開始使用不寄;同一個時點只寄一次。排程工作 `lottery.period-close-overdue`(每 15 分鐘)。

正本:`apps/api/src/project/lottery/accounts/`、`apps/api/src/project/lottery/cash/`、`apps/api/src/project/lottery/settlement/`、`apps/api/src/project/lottery/period-close/`

## api 介面

### GraphQL

| 端點                                                | 守門                       | 說明                                                                                                                                                                |
| --------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lotteryBankAccounts(input)`                        | `view-bank-accounts`       | `status` 缺席 = 全部                                                                                                                                                |
| `lotteryBankAccount(id)`                            | `view-bank-accounts`       | 看不到 → `NOT_FOUND`                                                                                                                                                |
| `lotteryBankTransactions(input)`                    | `view-bank-accounts`       | `from` / `to`(時點,`to` 不含)缺席 = 不限;`type` 缺席 = 全部;新的在前;`balanceAfter` 依時間累加;`totalIn` / `totalOut` = 期間合計                                    |
| `createLotteryBankAccount(input)`                   | `create-bank-account`      | `branchName` / `note` 缺席或 null = 不填;`shareOrgs` 缺席 = 不共用                                                                                                  |
| `updateLotteryBankAccount(input)`                   | `edit-bank-account`        | 缺席 = 不動;`branchName` / `note` 送 null = 清空;其他送 null 視同缺席;`shareOrgs` 整份替換                                                                          |
| `deleteLotteryBankAccount(id)`                      | `edit-bank-account`        | 有交易 → `BANK_ACCOUNT_HAS_TRANSACTIONS`                                                                                                                            |
| `recordLotteryBankTransaction(input)`               | `record-bank-transaction`  | `direction` 只有調整 / 其他看;`refType` + `refId` 見「交易」                                                                                                        |
| `reverseLotteryBankTransaction(input)`              | `reverse-bank-transaction` | `reason` 必填                                                                                                                                                       |
| `lotteryCashLedger(input)`                          | `view-cash`                | `orgId` 必填(可見範圍內);最多 500 筆;`vault` = 小金庫應有與起算點                                                                                                   |
| `lotteryCashMovement(id)`                           | `view-cash`                | 58mm 流水類單據 QR(`?movementId=`)用                                                                                                                                |
| `lotterySettlement(moduleKey, refId)`               | 看得到單據                 | `SettlementPanel` 的資料:金額、各邊合計與按鈕先填、收付歷程;現金紀錄帶 `cashPlace` 與抽屜的收銀點(`cashPointName` / `cashPointPrinterId`)                           |
| `lotterySettlementAccounts(moduleKey, refId, side)` | 看得到單據 + 那一邊的權限  | 付款視窗的帳戶選項(使用中、使用組織包含這一邊的分店)                                                                                                                |
| `lotteryOutstandingSettlements`                     | `view-outstanding`         | 待結清款項;`canSettle` = 有那一邊的權限                                                                                                                             |
| `lotterySettlementCandidates(input)`                | `record-bank-transaction`  | `type` = `purchase_income` / `transfer_income`:有待退或待收的單據                                                                                                   |
| `recordLotterySettlement(input)`                    | 那一邊的 `permission`      | 見「收付機制」                                                                                                                                                      |
| `reverseLotterySettlement(input)`                   | 那一邊的 `permission`      | `method` = 那一筆是 `bank` 或 `cash`;`reason` 必填                                                                                                                  |
| `lotteryPeriodCloses`                               | `close-period`             | 月份列表(新的在前):起始月份(租戶頂層建立的月份)到本月;`status` = `current` 進行中 / `open` 未關帳 / `closed` 已關帳;`canClose` 只在下一個要關的月份;`closableMonth` |
| `lotteryPeriodCloseCheck(month)`                    | `close-period`             | 關帳彈窗:`openShifts`、`pendingDocuments`(擋)、`snapshot`(含沒被日結涵蓋計算的班:只警告)、`canClose`                                                                |
| `lotteryPeriodClose(month)`                         | `close-period`             | 已關帳月份的快照;沒關 → `NOT_FOUND`                                                                                                                                 |
| `closeLotteryPeriod(input)`                         | `close-period`             | `month` + `confirmMonth`(要相同)+ `note`(選填);擋下見「錯誤碼」                                                                                                     |

### lookup 來源 `lottery_bank_account`

欄位 `label`(戶名 + 帳號末 5 碼,顯示欄)、`accountName`、`bankCode`、`branchName`;可篩 `status`、`usableBy`。「只列使用中」由使用它的表單帶固定條件 `filter: { status: "active" }`;依單據的分店篩用 `filter: { usableBy: { var: <分店欄位> } }`(`sharedToFilter`,只列使用組織包含那家分店的)。

### 給其他模組的介面

| 介面                                                                                            | 給誰                                                                                             |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `CashLedgerService.recordCashMovement(session, input)` / `reverseCashMovement(session, id, by)` | 店面、調貨、退貨退款、現金更正(現金流水寫入的唯一入口)                                           |
| `CashLedgerService.vaultExpected` / `vaultBaseline` / `sumShiftMovements`                       | 店面、日結                                                                                       |
| `registerVaultBaselineProvider(provider)`                                                       | 日結(小金庫起算點)                                                                               |
| `registerOpenShiftResolver(resolver)`                                                           | 店面(收銀點開著的班)                                                                             |
| `registerOpenDrawersLister(lister)`                                                             | 店面(分店開著班的抽屜與應有:即時現金帳的抽屜卡片、付款視窗的抽屜選項)                            |
| `registerSettlementDocument(registration)`                                                      | 進貨單、調貨單                                                                                   |
| `SettlementService.recordAutomatic(session, input)`                                             | 進貨單送出時的第一筆(交易內)                                                                     |
| `settlementClearedGuard`                                                                        | 進貨單、調貨單的 lifecycle                                                                       |
| `PeriodLock.assertPeriodOpen(tenantId, at, field)` / `closedPeriodOf(tenantId, at)`             | 店面:開班 / 改對應排班選的排班(拋錯)、撤銷售出申請的退款班次與現金更正單的位置(掛接點守門回擋下) |
| `PeriodLock.lastClosed(tenantId)`                                                               | 報表(指向已關帳月份的紀錄歸「前期更正」)                                                         |

`LotteryAccountsModule` 匯出 `CashLedgerService`、`SettlementLedger`、`SettlementService`、`BankTransactionsService`、`PeriodLock`、`AccountsAccess`。關帳的檢查清單、快照與提醒要讀店面的班與結帳單,另成 `LotteryPeriodCloseModule`(`apps/api/src/project/lottery/period-close/`;帳戶管理不依賴店面)。

正本:`packages/graphql/src/documents/project/lottery/accounts.graphql`、`apps/api/src/project/lottery/accounts/accounts.module.ts`

## admin 頁面

- `AccountsPage`:三個分頁 + 銀行帳戶分頁右上的 [+ 新增帳戶](`BankAccountDialog`)。網址狀態:`tab`、`cash`(即時現金帳的分店、日期、類型、收銀點)、`movementId`。
- `BankAccountsTab`:點列進詳情(綁了詳情頁才點得進去);使用組織含下層的加註「(含下層)」。
- `BankAccountViewPage`:頂部列(REACT-16:[← 返回列表] …… [設定使用組織] / [停用帳戶](或 [重新啟用])/ [刪除帳戶] 看 `canEdit`,有交易時 [刪除帳戶] 停用並提示;[登記交易] 看 `canRecordTransaction`,在最右)、標題卡(戶名、狀態、使用組織)、餘額 / 期間收 / 期間支、篩選(網址 `transactions`:期間預設本月 1 日到今天)、交易清單([沖正] 看 `abilities.canReverse`)、帳戶設定(`canEdit`;有交易時期初兩欄唯讀,只有 [儲存])。
- `CashLedgerTab`:分店選擇器 `OrgTreeSelect scope="visible"`、小金庫卡片、流水清單;`?movementId=` 帶到那一筆的分店與日期並標亮。
- `OutstandingTab`:每列按鈕(`canSettle`)開 `SettlementDialog`。
- `PeriodCloseTab`(`accounts.close-period`):月份列表(月份、狀態、關帳時間、關帳人);[關帳] 只在 `canClose` 那一列,開 `PeriodCloseDialog`(檢查清單:✓ 通過 / ✕ 擋下 / ! 只警告、快照預覽、輸入月份確認;輸入相同且 `canClose` 才能按);已關帳的 [快照] 開 `PeriodSnapshotDialog`。兩個彈窗在手機全螢幕。
- 三尺寸:平板 / 手機照規則(Figma 標「規則」);彈窗在手機全螢幕,表格以最小寬度橫向捲動,`SettlementPanel` 的收付歷程在手機改成清單。

正本:`apps/admin/src/pages/project/lottery/accounts/`、`apps/admin/src/components/project/lottery/SettlementPanel/`

## 錯誤碼

一律通用碼 `FORBIDDEN` / `NOT_FOUND` / `VALIDATION_FAILED`(GQL-04),細分放 `extensions.reason`:

| reason                          | 何時                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `BANK_ACCOUNT_DUPLICATE`        | 同租戶同銀行代碼 + 帳號                                                                                                      |
| `BANK_ACCOUNT_HAS_TRANSACTIONS` | 有交易後改期初餘額 / 期初日期、或刪除                                                                                        |
| `BANK_ACCOUNT_INACTIVE`         | 停用的帳戶登記交易 / 付款                                                                                                    |
| `ALREADY_REVERSED`              | 已沖正過、或沖正一筆沖正                                                                                                     |
| `SETTLEMENT_UNKNOWN`            | 單據沒登記收付 / 不參與收付 / 沒有那一邊                                                                                     |
| `SETTLEMENT_NOTHING_DUE`        | 那一顆按鈕先填 ≤ 0;銀行登記交易選的單據沒有待退 / 待收                                                                       |
| `BANK_ACCOUNT_NOT_USABLE`       | 帳戶的使用組織不含這一邊的分店                                                                                               |
| `NO_OPEN_SHIFT`                 | 現金來源選抽屜但沒有開著的班                                                                                                 |
| `CASH_POINT_NOT_AT_BRANCH`      | 現金來源選的抽屜不是這一邊分店的收銀點                                                                                       |
| `SETTLEMENT_NOT_CLEARED`        | lifecycle 守門(`FORBIDDEN` 的 reason):作廢 / 駁回前淨額 ≠ 0                                                                  |
| `PERIOD_CLOSE_INVALID`          | 月份不是 `YYYY-MM`;輸入的確認月份和要關的月份不同(`fields: confirmMonth`)                                                    |
| `PERIOD_NOT_ENDED`              | 關本月或未來的月份                                                                                                           |
| `PERIOD_ALREADY_CLOSED`         | 重關(含兩人同時關同一個月的後到者)                                                                                           |
| `PERIOD_OUT_OF_ORDER`           | 不是下一個要關的月份(跳過更早的未關帳月份)                                                                                   |
| `PERIOD_SHIFTS_NOT_CLOSED`      | 那個月(含更早)開的班還沒送出交班結帳                                                                                         |
| `PERIOD_PENDING_DOCUMENTS`      | 那個月有審核中(含已退回待更正)的撤銷售出申請、現金更正單、結帳確認申請                                                       |
| `PERIOD_CLOSED`                 | 選的時間落在已關帳的月份(`PeriodLock`;店面的開班 / 改對應排班是 `VALIDATION_FAILED`,兩張表單的掛接點是 `FORBIDDEN` + reason) |

正本:`apps/api/src/project/lottery/accounts/accounts-error.ts`

## 稽核

targetType `lottery_bank_account` / `lottery_bank_transaction` / `lottery_cash_movement` / `lottery_period_close`;動作 `lottery-bank-account.create` / `.edit` / `.delete`、`lottery-bank-transaction.create` / `.reverse`、`lottery-cash-movement.create` / `.reverse`(收付的現金)、`lottery-period.close`(after:`month`)。帳戶的 `before` / `after` 只放有變的欄位,使用組織以 `ShareOrg` 形狀記。

正本:`apps/api/src/project/lottery/accounts/accounts-audit.ts`

## 測試

- `packages/domain/src/project/lottery-accounts/lottery-accounts.test.ts`:類型與方向、從 → 到、規格 9 的進貨單 ①–⑤ 驗算、調貨單例、分次付款例、待結清種類。
- `apps/api/src/project/lottery/accounts/accounts.test.ts`(TEST-07):期初鎖定 / 刪除 / 停用、可見範圍(列表與單筆 `NOT_FOUND`、共用進來的只能看)、權限、交易方向與餘額、沖正(原交易不改、不能沖兩次)、沖正存入連動存銀行流水、小金庫只由流水算 + schema 與 repository 檢查、收付(分次付款、待結清、候選、作廢 / 駁回守門、帳戶使用組織、現金來源)。收付用兩種測試單據登記驗。
- `apps/db-migrator/seeds/project/accounts.test.ts`:模組宣告與開通角色配方。
- `packages/domain/src/project/lottery-accounts/period-close.test.ts`:月份期間(10/31 23:59:59.999 算 10 月)、依序、月份列表。
- `apps/api/src/project/lottery/period-close/period-close.test.ts`(TEST-07):沒有 `close-period` → `FORBIDDEN`;跳過 9 月關 10 月、關本月、重關、確認月份不同 → 擋下;沒結帳的班 → 擋;三種單據審核中落在那個月 → 擋(11 月的不擋);沒被日結涵蓋的班 → 警告並記快照;月底餘額 / 小金庫只算到 10/31 23:59:59.999;`assertPeriodOpen` 的邊界;關帳逾期(3 號、上月未關 → 提醒;2 號不寄;已關不寄)。退款班次 / 現金更正位置 / 開班選排班的擋下在店面的 `store-forms.test.ts`、`store.test.ts`。
- `apps/admin/src/pages/project/lottery/accounts/PeriodCloseTab/PeriodCloseTab.test.tsx`(TEST-08):分頁看 `close-period`、[關帳] 只在最早的未關帳月份、檢查清單與快照預覽、輸入月份確認、擋下時不能按、[快照]。
- `apps/admin/src/pages/project/lottery/accounts/AccountsPage/AccountsPage.test.tsx`(TEST-08):分頁依 `view-*` 權限、[+ 新增帳戶]、即時現金帳、待結清款項的按鈕與付款視窗、帳戶詳情的按鈕依 abilities、沖正。

## 使用者說明(help.md)

`apps/admin/src/md/module-help/project/additions/accounts.help.md`。

## 平台視角備註

- 根組織站在自己身上看不到任何租戶的帳戶(帳戶都屬於租戶);要看某租戶的帳戶先切進那個租戶。
- 收付的單據登記、日結起算點、開著的班的查詢都是程式登記(模組層級的登記表),不是租戶設定。
- 關帳是各租戶自己的(根組織沒有關帳分頁的資料);示範機構清空時依 `tenantId` 刪(`project/database/tenant-purge.ts`)。
