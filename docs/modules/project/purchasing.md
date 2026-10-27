# 叫貨與進貨(技術)

## 用途

分店向總部叫貨、總部彙總後採購,進貨與調貨把刮刮樂送到分店(專案規格第 8 章共通、8.1–8.4)。一個群組三個表單模組:**叫貨、採購單**(叫貨單 + 採購清單)、**進貨單**、**調貨單**。三張單據都是底座表單 + 流程,掛接點依底座 B1(`docs/concepts/workflow-engine.md`「掛接點」)。

本檔分小節:群組與叫貨、採購單由第一張票寫;進貨單、調貨單各自追加自己的小節與 api / 頁面。

正本:`apps/db-migrator/seeds/project/purchasing.ts`、`packages/domain/src/project/lottery/requisition.ts`

## 模組 key 與畫面

| key                                  | 名稱         | sidebarType  | 路由                                              | 說明                                                                                                                                                                  |
| ------------------------------------ | ------------ | ------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `purchasing`                         | 叫貨與進貨   | group        | `/purchasing`                                     | 群組;側欄 `order: 30`,圖示 `receipt`                                                                                                                                  |
| `purchasing.requisition`             | 叫貨、採購單 | link(列表頁) | `/purchasing/requisition`                         | 表單模組(綁定 叫貨單 `requisition`);分頁 叫貨單 \| 採購清單(Figma PU-01 92:1017、PU-03 92:1340)                                                                       |
| `purchasing.requisition.view-page`   | 詳情         | hidden       | `/purchasing/requisition/view-page/<id>`          | 表單引擎的詳情頁(檢視、審核、撤回、作廢)                                                                                                                              |
| `purchasing.requisition.create-page` | 新增         | hidden       | `/purchasing/requisition/create-page/requisition` | **替換**:列出所有販售中遊戲的叫貨頁(PU-02 電腦 69:15、平板 127:26386、手機 127:26700)                                                                                 |
| `purchasing.requisition.edit-page`   | 編輯         | hidden       | `/purchasing/requisition/edit-page/<id>`          | **替換**:和新增頁同一個畫面、帶入原內容(草稿、被退回 / 撤回的單;`RequisitionEditPage`)                                                                                |
| `purchasing.purchase`                | 進貨單       | link(列表頁) | `/purchasing/purchase`                            | 表單模組(綁定 進貨單 `purchase`);**替換**列表(配置欄 + 點收進度 + 結算;Figma PU-04 92:1625);側欄計數「待點收」                                                        |
| `purchasing.purchase.view-page`      | 詳情         | hidden       | `/purchasing/purchase/view-page/<id>`             | **替換**:引擎零件(唯讀)+ 點收區塊 + 結算 + 審核(PU-06 69:651 / 127:26619 / 127:26898、PU-07 127:2714 / 127:26961 / 127:27369、PU-11 127:2993 / 127:26671 / 209:27875) |
| `purchasing.purchase.create-page`    | 新增         | hidden       | `/purchasing/purchase/create-page/purchase`       | **替換**:刷條碼的新增頁(PU-05 127:2224 / 127:26493 / 127:26791;兌獎區由兌獎的功能加)                                                                                  |
| `purchasing.purchase.edit-page`      | 編輯         | hidden       | `/purchasing/purchase/edit-page/<id>`             | **替換**:和新增頁同一個畫面、帶入原內容;已點收的列鎖住(草稿、被退回 / 撤回的單;`PurchaseEditPage`)                                                                    |
| `purchasing.transfer`                | 調貨單       | link(列表頁) | `/purchasing/transfer`                            | 表單模組(綁定 調貨單 `transfer`);**替換**列表(配置欄 + 本數 / 張數 + 點收進度 + 結算 + 在途;Figma PU-08 92:2540);側欄計數「待點收」                                   |
| `purchasing.transfer.view-page`      | 詳情         | hidden       | `/purchasing/transfer/view-page/<id>`             | **替換**:出貨確認清單 / 點收區塊 + 結算 + 審核(PU-10a 92:2768 / 573:111230 / 573:111385、PU-10b 127:26050 / 127:27289 / 127:27667)                                    |
| `purchasing.transfer.create-page`    | 新增         | hidden       | `/purchasing/transfer/create-page/transfer`       | **替換**:選本 + 張數格子 + 刷條碼加入選取(PU-09 69:1099 / 127:27025 / 127:27418)                                                                                      |
| `purchasing.transfer.edit-page`      | 編輯         | hidden       | `/purchasing/transfer/edit-page/<id>`             | **替換**:和新增頁同一個畫面、帶入原內容;已出貨 / 已點收的列鎖住(草稿、被退回 / 撤回的單;`TransferEditPage`)                                                           |

- 頁內分頁用底座 `PageTabs`(`?tab=requisitions | purchase-list`;沒有 `purchase-list` 看不到採購清單分頁,只剩一個分頁時不顯示分頁籤)。右上按鈕跟著分頁換:[+ 新增叫貨單] / [匯出 Excel]。
- 進貨單 `purchasing.purchase`、調貨單 `purchasing.transfer` 由各自的票宣告,掛在本群組底下。

正本:`apps/admin/src/app/project/module-pages.ts`、`apps/admin/src/pages/project/lottery/purchasing/`

## 權限表

| 權限 key                               | 它是哪一頁的什麼                                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `purchasing.requisition.view`          | 看叫貨單列表、詳情;列表的衍生狀態(`lotteryRequisitionStates`)                                                                |
| `purchasing.requisition.create`        | [+ 新增叫貨單]、新增頁的遊戲清單(`lotteryRequisitionCandidates`)                                                             |
| `purchasing.requisition.edit`          | 改草稿 / 被退回的單;作廢(申請人本人或有 `edit`)                                                                              |
| `purchasing.requisition.delete`        | 刪草稿                                                                                                                       |
| `purchasing.requisition.purchase-list` | 「採購清單」分頁、[匯出 Excel](`lotteryPurchaseList`)                                                                        |
| `purchasing.purchase.view`             | 看進貨單列表、詳情;列表的點收進度 / 結算(`lotteryPurchaseProgress`)、甲類詳情的批購紀錄(`lotteryDealerPurchases`)            |
| `purchasing.purchase.create`           | [+ 新增進貨單]、新增頁的選項(`lotteryPurchaseOptions`)、採購清單的 [建立進貨單]                                              |
| `purchasing.purchase.edit`             | 改草稿 / 被退回的單;作廢(申請人本人或有 `edit`)                                                                              |
| `purchasing.purchase.delete`           | 刪除                                                                                                                         |
| `purchasing.purchase.settle`           | 結算區塊的 [付款] [收到退款] [沖正](收付機制登記的「總部」那一邊)                                                            |
| `purchasing.transfer.view`             | 看調貨單列表、詳情;列表的本數 / 張數、點收進度、在途、結算(`lotteryTransferProgress`)                                        |
| `purchasing.transfer.create`           | [+ 新增調貨單]、新增頁的選本與張數格子(`lotteryTransferOptions` / `lotteryTransferBookTickets`)、採購清單的 [從其他分店調貨] |
| `purchasing.transfer.edit`             | 改草稿 / 被退回的單;作廢(申請人本人或有 `edit`)                                                                              |
| `purchasing.transfer.delete`           | 刪除                                                                                                                         |
| `purchasing.transfer.partial-tickets`  | 選張(零碎張數);沒有時新增頁不出現張數格子,送出也擋(`TRANSFER_PARTIAL_FORBIDDEN`)                                             |
| `purchasing.transfer.pay`              | 結算區塊收貨店的 [付款] [收到退款] [沖正](還要收貨分店在自己的可見範圍內)                                                    |
| `purchasing.transfer.receive`          | 結算區塊出貨店的 [收款] [退款] [沖正](還要出貨分店在自己的可見範圍內)                                                        |

點收不另要權限:點收關卡的任務在自己手上(店長從申請中心進來)才能刷(`lotteryPurchaseReceiving` / `receiveLotteryPurchaseBook` 只看讀不讀得到單據與任務)。

**申請中心詳情頁的點收區塊**:進貨單、調貨單各登記一筆審核擴充 `Section`(`app/project/workflow-extensions.ts`;底座 `docs/modules/workflows.md`「依模組登記的審核擴充」),通知連結進來的申請中心詳情頁在審核區塊上方畫和檢視頁**同一個**點收區塊:進貨單 `PurchaseApplyCenterSection` = 點收提示 `PurchaseReceiveHint` + `PurchaseReceivingSection`;調貨單 `TransferApplyCenterSection` = `TransferReceivingSection`(出貨之後才出現)+ `TransferSettlementSection`(結算區塊 + 核准前三個數字不相等的提示;核准前收貨店已付 = 出貨店已收 = 調貨金額,收貨店在這裡就能付款)。刷條碼、逐張點收、[完成這次點收] 自動列印、送錯分店彈窗都在區塊裡;點收結果換上 api 回的點收區塊(`lotteryPurchaseReceiving` / `lotteryTransferReceiving` 的快取,調貨另重查結算);收付寫入後 `SettlementPanel` 重查結算,提示跟著變。進貨單的結算不在申請中心畫(核准前只檢查點收)。

調貨單的點收同樣不另要權限:點收關卡(流程實例的最後一關)的任務在自己手上才能刷(`lotteryTransferReceiving` / `receiveLotteryTransferBook`;讀得到 = 一般讀取(可見範圍,或依欄位共用:出貨 / 收貨分店在自己的可見範圍內)、建立者、任務持有者)。

**總部替分店建的單,分店看得到、但不能改 —— 依欄位共用**(底座 `docs/modules/forms.md`「依欄位共用」):三張受管表單都設 `sharedByFieldKeys` —— 叫貨單、進貨單 `branch`,調貨單 `from_branch` / `to_branch`。總部建的單,看得到單上分店的人(分店的人、可見範圍含那家店的上層主管)在列表、單筆(含申請中心的詳情頁)、結算區塊與待結清款項都看得到(只能看:不能改 / 刪 / 作廢、結算按鈕不能按);別的分店照舊看不到;草稿不共用。

### 開通時建立的角色

| 角色     | 叫貨、採購單                                       |
| -------- | -------------------------------------------------- |
| 總部管理 | 全部(`purchasing.requisition.*`,含採購清單)        |
| 店長     | `view` / `create` / `edit` / `delete`,不含採購清單 |
| 店員     | 不給                                               |

| 角色     | 進貨單                               |
| -------- | ------------------------------------ |
| 總部管理 | 全部(`purchasing.purchase.*`,含結算) |
| 店長     | `view`(列表、詳情);點收是流程關卡    |
| 店員     | 不給                                 |

| 角色     | 調貨單                                                     |
| -------- | ---------------------------------------------------------- |
| 總部管理 | 全部(`purchasing.transfer.*`)                              |
| 店長     | 全部(店長在出貨店收款、在收貨店付款,兩邊都要;零碎張數也給) |
| 店員     | 不給                                                       |

正本:`apps/db-migrator/seeds/project/onboarding/role-grants/purchasing.ts`、`purchasing.purchase.ts`、`purchasing.transfer.ts`

### 表單

| 表單   | formKey       | 綁定模組                 | 受管表單                                                                                                      |
| ------ | ------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 叫貨單 | `requisition` | `purchasing.requisition` | `seeds/project/revisions/requisition.r3.seed.ts`(r1 = 初版、r2 = 作廢原因類別,保留不改)                       |
| 進貨單 | `purchase`    | `purchasing.purchase`    | `seeds/project/revisions/purchase.r4.seed.ts`(r1–r3 保留不改;r3 = 兌獎、r4 = 批購受託人在本人批購 = 否時必填) |
| 調貨單 | `transfer`    | `purchasing.transfer`    | `seeds/project/revisions/transfer.r2.seed.ts`(r1 保留不改)                                                    |

## 資料

| 表                          | 說明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `form_submissions`(底座)    | 叫貨單本身(表單引擎);欄位見下方「叫貨單」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `lottery_requisition_lines` | 叫貨明細副本:`orgId`(叫貨分店)、`requisitionId`、`serialNo`(快照)、`gameId`、`books`、`note`、`completedAt`、`voidedAt`、`referencedBy { type: purchase \| transfer, submissionId }`;唯一 `(requisitionId, gameId)`(未刪除的)                                                                                                                                                                                                                                                                                                                                                                           |
| `lottery_purchase_receipts` | 進貨點收:`orgId`(進貨分店)、`submissionId`、`rowId`、`bookId`、`receivedBy`、`receivedAt`、`batchId` + `batchedAt`(點收批次,[完成這次點收] 時寫;還沒完成或舊資料 = null);唯一 `(submissionId, rowId)`(未刪除的)                                                                                                                                                                                                                                                                                                                                                                                         |
| `lottery_transfer_receipts` | 調貨點收:`orgId`(收貨分店)、`fromOrgId`(出貨分店)、`submissionId`、`rowId`、`bookId`、`purchaseAmount`、`tickets[{ ticketId, unitCost, ticketNo }]`(這一次搬進來的張、調入前的單張成本;`ticketNo` 舊紀錄沒有)、`receivedBy`、`receivedAt`、`batchId` + `batchedAt`(點收批次,同進貨點收);**一次點收一筆**(整本的列一筆;選張的列逐張點收,一列可以有好幾筆),`purchaseAmount` = 這一次的張的批購金額(這一列各筆合計 = 已點收金額);索引 `(submissionId, rowId)`(不唯一,migration `20261027120000_schema_transfer-receipts-per-ticket` 拿掉舊的唯一索引);資料共用 `sharedByFields: fromOrgId`(出貨店也看得到) |

`lottery_requisition_lines` 是模組資料表(`moduleKey = purchasing.requisition`),資料共用宣告 `private`(總部看全部分店靠可見範圍「包含下層」)。

正本:`apps/api/src/project/database/lottery-requisitions/lottery-requisition-line.schema.ts`、`docs/project/data-model.md`

## 規則

### 叫貨單(規格 8.1)

**欄位**(受管表單 `requisition` r1;允許存草稿;單號 `R-0001`,不分期間):

| key             | 名稱       | 型別                                                                                                         |
| --------------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| `branch`        | 叫貨分店   | 組織引用,必填;預設 `ctx.user.orgId`                                                                          |
| `expected_date` | 期望到貨日 | 日期,選填                                                                                                    |
| `lines`         | 明細       | 明細表格,必填、最多 200 列:`game`(引用 `lottery_game`,固定條件 `status: on_sale`)、`books`(1–999)、`note`    |
| `total_books`   | 本數       | 計算欄 `sumOf(lines, books)`(列表的「本數」)                                                                 |
| `note`          | 備註       | 單行文字 200 字:對摘要槽「標題」(列表的關鍵字搜尋只比對標題),底座規定標題只能對單行文字,所以不是規格寫的多行 |

**列表欄位配置**初值:單號、叫貨分店、期望到貨日、本數 + 內建欄「狀態」「建立者」(`seeds/project/settings.ts`)。不列印。

**新增頁(替換)**:

- 叫貨分店:店長預設自己的分店(當前組織);當前組織是最上層組織(總部)時不預設,從可見分店選(`OrgTreeSelect scope="visible"`)。
- 列出**所有販售中的遊戲**(含沒有庫存的新遊戲):目前庫存(張:這家店未售、在庫存或檯面上)、在途(本)、近 7 / 30 天賣出張數(售出 + 盤點補登 − 撤銷,滾動天數)、叫幾本。
- 排序:上市 30 天內的新遊戲(上市日在未來也算)排最上並標【新】(上市日新到舊),沒填上市日不標;其他依近 30 天賣出多到少;同順位依遊戲代號。
- 新遊戲還沒賣過的銷售欄顯示「—」(api 回 null),不是 0;有賣照實際。
- 搜尋名稱或代號、面額篩選、「只看要叫的」(叫幾本 > 0)。
- **0 本的列不寫入**(組存值時略過)。**超過預計要給本數只提醒**:已給 + 在途 + 這次叫的 > 預計時,該列標「超過預計要給本數(N)」,照樣可以送出。
- 底部:共叫幾本、預估批購金額 = Σ(遊戲整本金額 × 預設批購金額率 × 本數),加總後四捨五入到元(採購清單同一算法,`estimatedPurchaseAmountOf`)。
- [存草稿](表單允許時)/ [送出] 走表單引擎(`useFormDraft`):送出成功進詳情頁。

**流程**(開通腳本建,不 seed):一關,審核者 = 角色「總部管理」;**B4 跳過組織 = 租戶**(總部是某家分店時改選那家店)。B4 比對的是**申請人**的所屬組織:總部人員(一律屬於最上層組織)送出的叫貨單、替分店送的也一樣,直接跳過審核完成。申請人也是審核者時 = **照常審核**(總部是分店時,不在那家店的總部管理自己送的叫貨單派給他自己審)。

#### 建議流程設定

| 關卡     | 審核者        | 跳過                                       | 退回 |
| -------- | ------------- | ------------------------------------------ | ---- |
| 總部審核 | 角色 總部管理 | 申請人屬於「租戶」(總部是分店時改選那家店) | 可以 |

正本:`apps/db-migrator/seeds/project/onboarding/form-workflows/requisition.ts`

**狀態**:引擎狀態 + 已完成再細分(衍生):**待購買**(已完成、副本沒被引用)/ **已進貨**(被有效進貨單引用)/ **已調貨**(被有效調貨單引用);已作廢照引擎狀態。

**掛接點**(`apps/api/src/project/lottery/requisition/requisition-lifecycle.ts`):

| 時機           | 做什麼                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `beforeSubmit` | 明細至少一列本數 > 0(`REQUISITION_NO_LINES`);遊戲都要在、而且販售中(`REQUISITION_GAME_DISCONTINUED`;表單的固定條件先擋一次) |
| `completed`    | 寫副本(本數 0 的列不寫;重送不重複寫)                                                                                        |
| `beforeVoid`   | 已被進貨單 / 調貨單引用 → 擋下(`REQUISITION_REFERENCED`):先作廢引用它的單,叫貨單回到待購買後才能作廢                        |
| `voided`       | 副本補 `voidedAt`(不刪除)                                                                                                   |

**草稿**不影響任何統計:沒有副本,不進採購清單、不算在途、不算遊戲引用(遊戲引用檢查只看草稿以外的叫貨單)。

**作廢原因**:受管表單設了 `voidReasonCategoryKey: "void-reason"`(`requisition.r3.seed.ts`;刮刮樂與排班共用的類別),作廢對話框是欄位管理「作廢原因」的下拉(輸入錯誤 / 重複建立 / 交易取消 / 其他),選「其他」說明必填;不在類別內的值 → `VALIDATION_FAILED`(`fields: ["reasonKey"]`)。選項依作廢者的範圍(全域 + 上層 + 自己),機制見底座 `docs/modules/forms.md`「作廢原因」。

**被引用的叫貨單不能作廢**:已被進貨單 / 調貨單引用的(已進貨 / 已調貨)作廢會被擋下,要先作廢引用它的那張單,叫貨單回到待購買後才能作廢。

### 採購清單(規格 8.1)

- 取副本中 `voidedAt` 為空且未被引用的列,依遊戲 × 分店加總本數、預估批購金額;下半部列出每一張待購買的叫貨單(單號、叫貨分店、本數、預估批購)。
- [匯出 Excel]:底座 B11 產生器(`lib/project/reports/excel.ts`),內容 = 畫面上的表(`purchase-list-sheet.ts`)。
- 每張叫貨單的 [建立進貨單](帶入)與 [從其他分店調貨](開調貨單並引用)由進貨單、調貨單的功能在 `PurchaseListTab/purchase-list-actions.ts` 的 `PENDING_REQUISITION_ACTIONS` 各自追加一列;還沒有時不顯示動作欄。

### 受管表單引用遊戲(可攜的 lookup 來源)

受管表單的明細引用 `lottery_game`,要能跟著 seed 交付:可攜宣告放在 `@repo/domain/project/lottery` 的 `LOTTERY_PORTABLE_LOOKUP_PROVIDERS`(只收 `status: on_sale`),兩邊讀同一份 ——

- 種子組裝:`seeds/project/registry.ts` 的 `portableLookupProviders`;固定入口 `seeds/registry.ts` 匯出 `seedLookupProviders`,seed / reset / update 預檢時明確傳入
- api 匯出 seed:`project/lookup-providers.ts` 的 `lottery_game` 宣告 `portable`,`SeedExportCatalogService` 放進可攜性目錄

### 停售遊戲

停售的遊戲不會出現在新增頁(只列販售中),送出時也擋(規格 5.1)。依值取回已存的單照樣讀得到已停售遊戲的名稱。

### 進貨單(規格 8.2、8.3)

**欄位**(受管表單 `purchase` r4;允許存草稿;單號 `P-0001`,不分期間;作廢原因 = 欄位管理「作廢原因」`void-reason`(刮刮樂與排班共用)):

| key                    | 名稱       | 型別                                                                                                                                                                                                                |
| ---------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `branch`               | 進貨分店   | 組織引用,必填;預設 `ctx.user.orgId`                                                                                                                                                                                 |
| `requisition`          | 叫貨單     | 單行文字(叫貨單**單號**,例 `R-0042`),選填;送出前以叫貨明細副本的單號找回叫貨單                                                                                                                                      |
| `dealer`               | 批購甲類   | 引用 `lottery_dealer`,固定條件 `type: a`、`status: active`,必填                                                                                                                                                     |
| `self_purchase`        | 本人批購   | 是否,預設是                                                                                                                                                                                                         |
| `trustee`              | 批購受託人 | 引用 `lottery_dealer_contact`(`status: active`、`roles: trustee`);本人批購 = 否時顯示且必填(r4 `rules.required`,隱藏時不檢查),送出前再檢查是這位甲類啟用中的受託人                                                  |
| `purchase_date`        | 批購日期   | 日期,必填;預設今天                                                                                                                                                                                                  |
| `account`              | 扣款帳戶   | 引用 `lottery_bank_account`(`status: active`),必填;**只篩使用中**:「使用組織包含進貨分店」(`usableBy` 依分店欄位)是連動條件,不可攜、不能放進受管表單,由送出前檢查(`PURCHASE_ACCOUNT_INVALID`)與新增頁的帳戶選項負責 |
| `lines`                | 明細       | `game`(引用 `lottery_game` 販售中;列內帶入張數、整本金額、批購金額率)、`book_no`(6–7 位)、`last_ticket_no`、`tickets`、`book_price`、`rate`(0–100)、`amount`(列內公式 整本金額 × 批購金額率 ÷ 100,取整數)           |
| `purchase_total`       | 批購合計   | 計算欄 `sumOf(lines, amount)`                                                                                                                                                                                       |
| `redemptions`          | 兌獎       | 明細:`redemption`(引用 `lottery_redemption`,固定條件 `status: in_store`;帶入 `prize_amount`)、`prize_amount`(中獎金額)。勾選這次拿去兌獎的兌獎紀錄,不能手填金額                                                     |
| `redemption_total`     | 兌獎金額   | 計算欄 `sumOf(redemptions, prize_amount)`                                                                                                                                                                           |
| `redemption_offset`    | 兌獎折抵   | 計算欄 `min(兌獎金額, 批購合計)`                                                                                                                                                                                    |
| `deducted_amount`      | 扣款金額   | 計算欄 = 批購合計 − 兌獎折抵,是這張單的**應付**                                                                                                                                                                     |
| `redemption_remainder` | 兌獎剩餘   | 計算欄 = 兌獎金額 − 兌獎折抵                                                                                                                                                                                        |
| `note`                 | 備註       | 單行文字 200 字(摘要槽「標題」)                                                                                                                                                                                     |

**列表欄位配置**初值:單號、進貨分店、甲類、批購日、扣款金額 + 內建欄「狀態」(`seeds/project/settings.ts`);列表頁另加點收進度與結算。

**流程**(開通腳本建):一關「點收」,人員條件「角色 店長 且 所屬組織屬於表單欄位『進貨分店』(本身)」;申請人也是審核者時 = **照常審核**(同時是總部管理與進貨分店店長的人自己建單,點收照樣由他刷條碼完成)。

#### 建議流程設定

| 關卡 | 審核者                                | 跳過 | 退回 |
| ---- | ------------------------------------- | ---- | ---- |
| 點收 | 角色 店長 且 所屬組織屬於「進貨分店」 | 無   | 可以 |

正本:`apps/db-migrator/seeds/project/onboarding/form-workflows/purchase.ts`

**掛接點**(`apps/api/src/project/lottery/purchase/purchase-lifecycle.ts`,規則在 `PurchaseRules`):

| 時機                     | 做什麼                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `beforeSubmit`           | 明細有列、本號格式、張數 / 整本金額和遊戲相符、最後張號 ≥ 標準張數(`PURCHASE_LINE_INVALID`);停售遊戲(`PURCHASE_GAME_DISCONTINUED`);本號和這張單 / 其他有效進貨單 / 既有的本重複(`PURCHASE_BOOK_DUPLICATE`);已點收的列被改或刪(rowId 比對點收時建的本,`PURCHASE_RECEIVED_ROW_CHANGED`);叫貨單要同一家分店、待購買或已被這張引用(`PURCHASE_REQUISITION_INVALID`);甲類營業中(`PURCHASE_DEALER_INVALID`);本人批購 = 否時受託人是這位甲類啟用中的受託人(`PURCHASE_TRUSTEE_INVALID`);扣款帳戶使用中、使用組織包含進貨分店、送出的人看得到(`PURCHASE_ACCOUNT_INVALID`) |
| `submitted`              | **第一次送出**(修訂 1)以 `SettlementService.recordAutomatic` 記「進貨支出」= 扣款金額(扣款帳戶、歸屬分店 = 進貨分店、備註寫批購日;**0 元也記一筆**);重新送出不自動調整。甲類批購日重算;叫貨單 → 已進貨(換了叫貨單的,舊的回到待購買);交易後對這張單的審核者送 `badge:purchasing.purchase`                                                                                                                                                                                                                                                                        |
| `beforeApprove`          | 還有沒點收的列 → `PURCHASE_UNRECEIVED_ROWS`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `completed`              | 不寫帳、不檢查是否結清(只送側欄信號)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `beforeReject`           | 已有點收 → `PURCHASE_HAS_RECEIPTS`;淨額 ≠ 0 → `SETTLEMENT_NOT_CLEARED`(`settlementClearedGuard`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `beforeDelete`           | 只限草稿(`PURCHASE_NOT_DRAFT`;送出過的單有收付與叫貨單引用,刪了不會釋放);已有點收 → `PURCHASE_HAS_RECEIPTS`                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `beforeVoid`             | 點收的本除了「進貨」以外有任何張數事件(售出、拆本、調出、移櫃……)或被鎖定 → `PURCHASE_BOOKS_IN_USE`;淨額 ≠ 0 → `SETTLEMENT_NOT_CLEARED`                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `rejected`               | 甲類日期重算;叫貨單回到待購買                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `voided`                 | 甲類日期重算;點收的本 → `revoked`,每張寫「進貨作廢」事件(狀態與位置不變,`reasonKey` / `reasonNote` 帶作廢原因);叫貨單回到待購買                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `returned` / `withdrawn` | 不擋(只送側欄信號)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**點收**(`PurchaseReceivingService`):店長刷這本**最後一張**的碼(背面編號 / 正面編號 / 正面條碼)。單據要在審核中、點收任務在他手上(`PURCHASE_NOT_RECEIVABLE`)。背面編號用遊戲 + 本號對明細,正面的碼只用本號對;最後張號不同 → `PURCHASE_LAST_TICKET_MISMATCH`(請退回更正);已點收 → `PURCHASE_ALREADY_RECEIVED`。對到的列在同一個交易裡 `createBook`(本、張、「進貨」事件;以點收人自己的範圍寫)+ 寫 `lottery_purchase_receipts`。

**送錯分店**:單上沒有這本時,查同租戶其他已建立、還沒點收完成的進貨單(進貨分店不同):有 → `PURCHASE_WRONG_STORE`,`extensions` 帶 `ownerBranchName`、`serialNo`、`gameName`、`unitPrice`、`bookNo`(畫面提示「這本屬於 B 店的進貨單 #P-xxx…」),不入庫;沒有 → `PURCHASE_BOOK_NOT_ON_PURCHASE`。[知道了] 不記錄;[通知總部更正] → `notifyLotteryPurchaseWrongStore`,通知那張單的建立者(`lottery.purchase-wrong-store`)。

**作廢與撤銷的本**:作廢前只擋「任何一張已售、已調出或已拆本」(規格 8.2 掛接點表;「已有點收就擋」是駁回前 / 刪除前的規則),所以全部點收、原封不動的進貨單(例:已完成後發現整張批錯)可以作廢 —— 這時點收建的本標成 `revoked`、每張寫「進貨作廢」事件;庫存概況(`stockOverview`)與庫存分頁的本清單都排除 `revoked` 的本。

**[完成這次點收]**(`completeLotteryPurchaseReceiving`):「這一次」由畫面記(上次按 [完成這次點收] 或打開這頁之後點收的本),送出這些列;這張單上、自己點收、還沒有批次的列標上同一個點收批次(`batchId`、`batchedAt`;以點收人自己的身分寫,送的列數超過這張單的列數 → `VALIDATION_FAILED`),已在別的批次的列不重收,沒有可收的列 → 不給批次(不印)。要點收任務在自己手上(`PURCHASE_NOT_RECEIVABLE`)。點收區塊回每一次點收(`batches`:依完成時間第 1、2… 次與它的列)。寫入成功後印這一次的進貨點收單兩聯(一個列印工作,見「列印」)。

**收付**:`registerSettlementDocument` 登記一邊「總部」(付款方、`purchasing.purchase.settle`、只能銀行),應付 = 扣款金額(`purchasePayableOf`),參與收付的狀態 `reviewing` / `returned` / `withdrawn` / `completed`;[付款] = 應付 − 已付淨額、[收到退款] = 已付淨額 − 應付,最少 0。

**兌獎**(規格 8.2「兌獎」;Figma PU-05 兌獎區):

- 新增頁的兌獎區(`PurchaseRedemptions`,`lotteryPurchaseRedemptions`)只列**進貨分店**「店內持有」的兌獎紀錄(第一欄是兌獎紀錄的單號 `RD-0218`,檢視頁的兌獎區同;舊資料「—」);勾選的合計 = 兌獎金額;合計五列(`PurchaseTotals`):批購合計、兌獎金額(勾選 N 筆)、兌獎折抵、扣款金額、兌獎剩餘(算法 `purchaseRedemptionTotalsOf`,和表單計算欄同一套)。跨分店選兌獎紀錄這一輪不做。
- `beforeSubmit`:勾選的兌獎紀錄要在進貨分店、「店內持有」(或已勾在這張單上)、金額和紀錄相同 → 否則 `PURCHASE_REDEMPTION_INVALID`。已送兌的不在 lookup 的固定條件裡,表單引擎先擋(`VALIDATION_FAILED`,`fields: redemptions`)。
- `submitted`(每次送出):勾選的改「已送兌」(`purchaseSubmissionId`、`sentAt`);這張單之前勾、這次沒勾的回到店內持有(`RedemptionPurchaseLink.markSent`,被別人搶先撤銷 → 交易回復)。**第一次送出**另在兌獎剩餘 > 0 時以 `SettlementService.recordAutomatic(…, { redemptionIncome: true })` 記銀行「兌獎入帳」= 兌獎剩餘(扣款帳戶、歸屬分店 = 進貨分店、`refType` 指回這張單、`settlementSide = null` → **不算進淨額、不算待結清**)。
- `withdrawn` / `returned` / `rejected` / `voided`:這張單勾的全部回到「店內持有」(`RedemptionPurchaseLink.release`)。
- 例(規格 8.2、第 9 章驗算 ⑤):批購 60,000、勾選 100,000 → 折抵 60,000、扣款 0(記 0 元進貨支出)、兌獎剩餘 40,000(記兌獎入帳 40,000),應付 0 = 已結清。
- **檢視頁**的兌獎區(`PurchaseRedemptionRecords`,`lotteryPurchaseRedemptionRecords(submissionId)`):這張單勾選的兌獎紀錄,點一列開兌獎紀錄詳情。讀取依據是**讀得到這張進貨單**(`PurchaseReceivingService.readable`:可見範圍、建立者或持有任務;總部不一定有 `store.view`),只讀存值裡勾的那幾筆(租戶邊界反查),回詳情欄位、不能撤銷(`revokeMode` 一律 null)。新增頁的兌獎區點一列(勾選框以外)也開同一個詳情。
- 送出時勾選的被搶先撤銷 / 勾走(送出前檢查之後才發生):`markSent` 回 `VALIDATION_FAILED` + `PURCHASE_REDEMPTION_INVALID`,交易回復。
- 兌獎紀錄在分店、進貨單是總部建的、掛接點以系統身分執行:`RedemptionPurchaseLink` 以租戶邊界讀寫(用途「反查」「例外寫入」),條件釘這張單。正本 `docs/modules/project/store.md`「兌獎」。

**草稿**不影響任何統計:不記帳、不算在途、不算遊戲引用、不算批購日、不改兌獎紀錄的狀態。

**在途**:向 `in-transit.ts` 登記 `lottery-purchases`:這家店(進貨分店)審核中 / 被退回 / 已撤回的進貨單還沒點收的本數。

**甲類批購日**:向 `DealerPurchaseDates.registerSource` 登記:有效進貨單(送出之後、沒有駁回 / 作廢)上最新的批購日期;本人批購另算一份。送出 / 駁回 / 作廢時重算,傳事後動作的 `actorId`(日期變了時經銷商的修改者 = 處理這張單的人;正本 `docs/modules/project/dealers.md`)。

**側欄計數** `purchasing.purchase`(`registerBadge`):點收關卡在我手上、還沒決定的任務數(`workflow_tasks`,`status: pending`)。送出 / 任務結束時由事後動作送 `badge:purchasing.purchase`;**改派 A → C** 不經掛接點(底座沒有改派的掛接點,已列入回收底座清單),由流程引擎對 A、C 送的 `badge:apply-center` 讓前端整份重抓側欄數字(底座 `badge:*`),計數本身照任務算,A −1、C +1。

### 調貨單(規格 8.4、第 9 章)

**欄位**(受管表單 `transfer` r2;允許存草稿;單號 `T-0001`,不分期間;作廢原因 = 欄位管理「作廢原因」`void-reason`(刮刮樂與排班共用)):

| key              | 名稱     | 型別                                                                                                                                                                                                                                                                                                                               |
| ---------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `from_branch`    | 出貨分店 | 組織引用,必填;預設 `ctx.user.orgId`                                                                                                                                                                                                                                                                                                |
| `to_branch`      | 收貨分店 | 組織引用,必填;不能和出貨分店相同(送出前檢查)                                                                                                                                                                                                                                                                                       |
| `requisition`    | 叫貨單   | 單行文字(叫貨單**單號**),選填;收貨分店、待購買的叫貨單                                                                                                                                                                                                                                                                             |
| `lines`          | 明細     | `game`(引用 `lottery_game`)、`book`(引用 `lottery_book`,固定條件 `status: normal`)、`mode`(`whole` 整本 / `partial` 選張)、`ticket_nos`(張號區段文字,例 `012-016,020`;整本 = 起訖)、`tickets`、`amount`(整本 = 整本金額;選張 = 面額 × 張數)、`rate`(0–100,預設這一本的成本率)、`purchase_amount`(列內公式 金額 × 批購金額率 ÷ 100) |
| `transfer_total` | 調貨金額 | 計算欄 `sumOf(lines, purchase_amount)`                                                                                                                                                                                                                                                                                             |
| `note`           | 備註     | 單行文字 200 字(摘要槽「標題」)                                                                                                                                                                                                                                                                                                    |

「在出貨店、未被鎖定」是連動 / 數字條件,不能跟著受管表單交付(`@repo/domain/seed` 的可攜性檢查),由替換新增 / 編輯頁的選本(`lotteryTransferOptions`)與送出前檢查負責。

**列表欄位配置**初值:單號、出貨分店、收貨分店、調貨金額 + 內建欄「狀態」(`seeds/project/settings.ts`);列表頁另加本數 / 張數、點收進度、結算;審核中且有列在途時狀態顯示「在途」。

**流程**(開通腳本建):兩關。第 1 關「出貨確認」(`ship`)角色 店長 且 所屬組織屬於「出貨分店」,跳過條件 `ctx.user.orgId == 出貨分店`;第 2 關「點收」(`receive`)角色 店長 且 所屬組織屬於「收貨分店」。兩關的「申請人也是審核者時」都是**照常審核**(出貨店店長不是站在出貨店送出、或申請人也是收貨店店長時,任務派給他自己)。**掛接點以流程實例的最後一關當點收關卡**(點收資格、核准前的全部檢查、側欄計數只認它);第一關核准不檢查點收與收付。**租戶改流程時,點收關卡一定要留在最後一關**:在它後面再加關卡,點收資格與核准前的檢查會跑到那一關,原本的點收關卡就能在沒點收、沒結清時核准。

#### 建議流程設定

| 關卡           | 審核者                                | 跳過                                  | 退回 |
| -------------- | ------------------------------------- | ------------------------------------- | ---- |
| 出貨確認       | 角色 店長 且 所屬組織屬於「出貨分店」 | 跳過條件 `ctx.user.orgId == 出貨分店` | 可以 |
| 點收(最後一關) | 角色 店長 且 所屬組織屬於「收貨分店」 | 無                                    | 可以 |

正本:`apps/db-migrator/seeds/project/onboarding/form-workflows/transfer.ts`

**掛接點**(`apps/api/src/project/lottery/transfer/transfer-lifecycle.ts`,規則在 `TransferRules`)。「這張單鎖定的張」= 還沒點收的列;出貨與否看張的位置(在途):

| 時機                       | 做什麼                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `beforeSubmit`             | 出貨 / 收貨分店都有、不同,出貨分店在送出的人的可見範圍(`TRANSFER_BRANCH_INVALID`);明細有列(`TRANSFER_NO_LINES`);選張要 `partial-tickets`(`TRANSFER_PARTIAL_FORBIDDEN`);每一列的本正常、遊戲相同、整本要原封不動(沒拆過、沒有張在別家店;整本的張數 = 這本跳號以外的張扣掉待標註 = 標準張數)、選張要拆過、張數與金額相符、批購金額率 0–100、同一張不重複(`TRANSFER_LINE_INVALID`);本和張都在出貨店、未售、沒被其他單鎖定、不在其他未結束的調貨單上(`TRANSFER_TICKETS_UNAVAILABLE`);已點收的列沒被改或刪(`TRANSFER_RECEIVED_ROW_CHANGED`);叫貨單是收貨分店待購買的(`TRANSFER_REQUISITION_INVALID`);退回 / 撤回後重送時,上一次送出已出貨的列(張都在途且鎖在這張單上,或已點收)內容沒改 → 合法,不再檢查「在出貨店、原封不動」;**選張的列只移除還沒點收的在途張**(張號只能少不能多或換、已點收的張都在、方式 / 遊戲 / 本 / 批購金額率不變、金額 = 原面額 × 剩下張數;還沒到齊的列才行)→ 合法(少張處理,使用者 10/26 定案做法 A);其他改法 → `TRANSFER_LINE_INVALID`(有點收的列 → `TRANSFER_RECEIVED_ROW_CHANGED`);有點收的列整列刪掉 → `TRANSFER_RECEIVED_ROW_CHANGED`。整本的列只能整列刪 |
| `submitted`                | 鎖定(`lockedBy` = 這張單,「調貨中」,不能賣;部分點收的列只鎖還沒點收的張,到齊的列不鎖);重新送出時不再在單上的張(整列刪掉、選張的列取消勾選的)逐張比對 —— 已在途的 → 待查(責任分店 = 出貨店)後解鎖、還沒出貨的 → 解鎖;叫貨單 → 已調貨(換了叫貨單的,舊的回到待購買);交易後送 `badge:purchasing.transfer`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `stepPassed`(含 `skipped`) | 還沒出貨的張 → 位置「在途」、寫「調出」事件(事件記這張出貨當時的調貨金額 `amount` = 那一列的批購金額 ÷ 張數,營運報表的調出 / 在途金額讀它);有出貨就送負責人提醒「調貨出貨通知」(`lottery.transfer-shipped`,事件的組織 = 收貨分店;連結到這張調貨單);側欄信號                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `beforeApprove`            | 點收關卡:還有沒點收的張(整本的列沒刷、選張的列沒到齊)→ `TRANSFER_UNRECEIVED_ROWS`(畫面列出是哪幾張,請退回由出貨店移除);收貨店已付淨額 = 出貨店已收淨額 = 調貨金額,不相等依序提示 `TRANSFER_RECEIVER_UNDERPAID` / `TRANSFER_SHIPPER_UNRECEIVED` / `TRANSFER_SHIPPER_OVERRECEIVED` / `TRANSFER_RECEIVER_OVERPAID`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `returned` / `withdrawn`   | 還沒出貨的解除鎖定;已在途的保持在途(仍鎖定);結算紀錄保留                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `beforeReject`             | 已有點收 → `TRANSFER_HAS_RECEIPTS`;兩邊淨額 ≠ 0 → `SETTLEMENT_NOT_CLEARED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `beforeDelete`             | 只限草稿(`TRANSFER_NOT_DRAFT`;送出過的單有鎖定 / 在途 / 收付,刪了不會釋放);已有點收 → `TRANSFER_HAS_RECEIPTS`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `beforeVoid`               | 點收搬進來的張,最後一筆事件不是這張單的「調入」、或已不是收貨店庫存裡未售沒鎖定的張(調入後已售、再調出或拆本)→ `TRANSFER_BOOKS_IN_USE`;兩邊淨額 ≠ 0 → `SETTLEMENT_NOT_CLEARED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `rejected`                 | 還鎖著的張:在途的寫反向的「調入」回出貨店庫存,全部解鎖;叫貨單回到待購買                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `voided`                   | 點收搬進收貨店的張全部回到出貨店:收貨店寫「調出」、出貨店寫「調入」(反向事件,帶作廢原因),單張成本改回調入前;換店的稽核記作廢的人(帳本的 `systemActorId`);叫貨單回到待購買                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `completed`                | 只送側欄信號                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**點收**(`TransferReceivingService`;使用者 10/26 定案):

- **整本的列**:刷這本的任何一張(背面編號 / 正面編號 / 正面條碼)= 整列點收。
- **選張的列逐張點收**,三種寫法同一種點收紀錄:刷一張(只點收刷到的那張;要是列上的張號)、格子上點選幾張([點收選取的 N 張])、[其餘全部到齊…](剩下的張;不限先刷過一張)。後兩種走 `receiveLotteryTransferTickets`(整本的列 → `TRANSFER_WHOLE_ROW_TICKETS`)。
- 單據要在審核中、點收關卡的任務在他手上(`TRANSFER_NOT_RECEIVABLE`);這列還沒出貨 → `TRANSFER_NOT_SHIPPED`;整本的列已點收、或選到的張已點收 → `TRANSFER_ALREADY_RECEIVED`(`extensions.ticketNos` = 已點收的張號;同一張同時刷兩次,後到的寫不到也是它)。
- 同一個交易:這一次的張 → 收貨店庫存、寫「調入」事件(單張成本 = 該列批購金額 ÷ 張數,不四捨五入)、解除鎖定、寫一筆 `lottery_transfer_receipts`(記調入前的單張成本與張號)。整本都搬過去時,本跟著搬到收貨店(帳本重算持有分店)。
- 一列「已點收」= 整本的列點收過、選張的列已點收張數 = 張數(`transfer-received.ts`);核准前檢查、在途本數、列表的點收進度、送出前 / 送出後的比對都用它。
- **已點收金額**(收貨店 [付款] 的先填值,`receivedTransferAmountOf`):到齊的列 = 批購金額;部分點收的列 = 面額 × 已點收張數 × 批購金額率(四捨五入到元,同列的批購金額算法),所以出貨店移除沒到的張、列縮成剩下的張以後,調貨金額剛好等於縮小前已點收的金額。每筆點收紀錄的 `purchaseAmount` = 點收後 − 點收前的已點收金額(報表調入 / 調出金額照它加總)。列縮小以後(少張處理),已點收張的單張成本在送出時改成「重算後這一列的批購金額 ÷ 張數」(`repriceReceived`,經帳本寫「成本調整」事件,時間 = 重送那一刻,批次),這一列調入的成本合計 = 調貨金額(使用者 10/27 定案)。

**少張處理**(做法 A):收貨店核准前還有張沒點收 → 擋下並列出哪幾張;收貨店退回 → 出貨店在編輯頁展開那一列的格子,已點收的張鎖住、還沒點收的可以取消勾選,送出前確認「054、055、056 這 3 張會變成待查」→ 重送(取消勾選的在途張變待查、責任分店 = 出貨店,調貨金額照剩下的張數重算)→ 再走出貨確認(沒有新出貨的張)→ 收貨店核准。

**[完成這次點收]**(`completeLotteryTransferReceiving`,同進貨單):這張單上、自己點收、還沒有批次的列標上同一個點收批次(`batchId`、`batchedAt`;以點收人自己的身分寫,送的列數超過這張單的列數 → `VALIDATION_FAILED`),已在別的批次的列不重收,沒有可收的列 → 不給批次(不印)。要點收任務在自己手上(`TRANSFER_NOT_RECEIVABLE`)。點收區塊回每一次點收(`batches`)與每一列的 `batchId`。寫入成功後印這一次的調貨點收單兩聯(見「列印」)。

**送錯分店**(同進貨單):單上沒有這本時,查同租戶其他未結束、送往別家分店的調貨單:有 → `TRANSFER_WRONG_STORE`(`extensions` 帶那張單的收貨分店、單號、遊戲、面額、本號),不入庫,畫面提示交給送貨人;沒有 → `TRANSFER_BOOK_NOT_ON_TRANSFER`。[知道了] 不記錄;[通知總部更正] → `notifyLotteryTransferWrongStore`,通知那張調貨單的建立者(`lottery.transfer-wrong-store`,`dedupeKey` = 那張單 / 那一列 / 刷到的這張單,連到調貨單詳情頁)。

**收付**(`registerSettlementDocument`):兩邊 —— 收貨店(`receiver`,付款方,`pay`,銀行或現金;現金來源小金庫或開著班的收銀點抽屜;從小金庫付不能超過小金庫應有,見 `accounts.md`「收付機制」)、出貨店(`shipper`,收款方,`receive`,一律銀行)。調貨金額 = 批購金額合計;收貨店 [付款] = **已點收**的批購金額 − 已付淨額、[收到退款] = 已付淨額 − 已點收的批購金額;出貨店 [收款] = 收貨店已付 − 出貨店已收(只有出貨店已收 < 調貨金額時)、[退款] = 出貨店已收 − 調貨金額;≤ 0 停用。兩邊店都看得到這張單的收付(依欄位共用),但每一邊只有那一邊的分店在自己可見範圍內才能記(`sideBranchPaths` = 出貨 / 收貨分店;寫入不放大)。

**超過預計要給本數只警告**(規格 7.6):`lotteryTransferOptions` 給收貨分店時一起回這些遊戲的預計要給本數、已給、在途;新增頁在「已給 + 在途 + 這張單整本調過去的本數 > 預計」時列出超過的遊戲(`AllocationWarnings`),照樣可以送出。零碎張數不湊成一本,不算進去。

**收貨分店選不到時**:收貨分店照組織引用只列讀者可見範圍內的組織(規格 8.4「收貨店不發起調貨單」,調貨主要由總部開;開單的店長本來就屬於多家店)。新增頁的收貨分店欄下方說明「調貨由總部開單,或請管理員把你加入收貨分店」;送出時收貨分店讀不到(`SOURCE_UNAVAILABLE`)也改顯示這句。

**草稿**不影響任何統計:不鎖定、不算在途、不參與收付。

**在途**:向 `in-transit.ts` 登記 `lottery-transfers`:送到這家店(收貨分店)、未結束的調貨單還沒點收的列數(一列算一本)。

**側欄計數** `purchasing.transfer`(`registerBadge`):點收關卡(流程實例的最後一關)在我手上、還沒決定的任務數;還在第一關出貨確認的不算。第一關通過派給收貨店店長時由事後動作送 `badge:purchasing.transfer`;改派同進貨單(流程引擎送的 `badge:apply-center`)。

**報表**:調貨損益(調貨金額 − 原成本)由張數事件與單張成本算得出(調出前的單張成本在 `lottery_transfer_receipts.tickets`),報表歸輸出報表的功能。

### 列印(58mm 單據,規格第 12 章)

四張單據都用底座 B8 的列印流程(`docs/modules/printers.md`):瀏覽器把單據排版、轉成 384 點黑白 PNG,送 `createPrintJob`,由分店的列印代理程式印出。沒有 `api.printing.print` 的租戶(沒有收據機)不印、不出現 [列印];分店沒有可用的印表機時 [列印] 變灰並說明原因,自動列印不送。

| 單據(Figma)                     | 什麼時候印                                                                                                                                   | 聯                                         | 內容                                                                                                                                                                                                                                                 | 簽名欄             | 印表機的分店 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------ |
| 進貨點收單(RC-08 `102:23526`)   | [完成這次點收] 寫入成功後自動印;檢視頁標頭 [列印] / [補印] 印一次點收(點收過兩次以上時先選「點收批次」,預設最近一次)                         | 第 1 聯 · 店鋪留存、第 2 聯 · 送貨人留存   | 單號、進貨分店、甲類、第 N 次點收的本(遊戲、本數、點收進度、本號區段)、尚未到的本;補印和原單一致(照那一次的本重排版)。沒有點收批次的舊資料:[列印] 印到目前為止已點收的全部本                                                                         | 點收人、送貨人     | 進貨分店     |
| 調貨出貨單(RC-06 `102:23446`)   | 第一關通過後(含跳過)自動印:不論在調貨單檢視頁、申請中心詳情頁或批次核准通過第一關,或送出時(新增頁、引擎編輯頁)第一關被跳過;檢視頁標頭 [列印] | 第 1 聯 · 出貨店留存、第 2 聯 · 送貨人留存 | 單號、出貨店 → 收貨店、每一列(遊戲 / 本、張數、金額、號碼區段與張數)、調貨金額;自動印只列這次才出貨的列(出貨時間在這個審核實例開始之後;退回後重送時先前已在途的列不再印,沒有新出貨的列不印;使用者 10/21 定案)                                        | 出貨人、送貨人     | 出貨分店     |
| 調貨點收單(RC-10 待畫)          | 收貨店 [完成這次點收] 寫入成功後自動印;檢視頁標頭 [列印] / [補印] 印一次點收(同進貨點收單)                                                   | 第 1 聯 · 收貨店留存、第 2 聯 · 送貨人留存 | 單號、出貨店 → 收貨店、第 N 次點收的列(遊戲、本數、點收進度;號碼照點收紀錄實際搬進來的張(`receivedTicketNos`):整本到齊寫本號區段、選張寫「本號 #張號區段(N 張)」)、尚未到的本;補印和原單一致。沒有點收批次的舊資料:[列印] 印到目前為止已點收的全部列 | 點收人、送貨人     | 收貨分店     |
| 調貨付款收據(RC-07 `102:23493`) | 收貨店 [付款] 選現金、寫入成功後自動印(檢視頁的結算區塊與待結清款項分頁都會);檢視頁標頭 [列印] 印最近一筆                                    | 第 1 聯 · 收貨店留存、第 2 聯 · 送貨人留存 | 單號、付款店(分店 · 小金庫,或從抽屜付時的收銀點名稱)、收款人(付款視窗的經手 / 收款人)、現金金額;時間 = 付款時間                                                                                                                                      | 付款人、送貨人簽收 | 收貨分店     |

- **版面**:單欄、「標籤:值」、表格最多三欄、號碼以區段表示(連號 `~`)、底部 QR code(這張單據在後台的詳情頁連結;進貨點收單、調貨出貨單、調貨點收單、調貨付款收據的路由都由 api `lotteryReceiptLinks` 依模組樹組出(`purchaseView` / `transferView`),不依印單的人的權限 —— 只從申請中心進來、沒有進貨單 / 調貨單模組的店長印的單據 QR 一樣完整;[完成這次點收] 的回傳一起帶 `receiptLinks`(同一次請求依模組樹組好,自動列印不另查);路由是 null(模組停用、沒有 route)→ 照印、不印 QR;標頭 [列印] / [補印] 用 `useReceiptLinks`,讀到之前也能按(不印 QR),見 `docs/modules/project/store.md`「列印」)、上方印最上層組織名稱(`me.currentOrg.tenantName`);時間依租戶時區。系統不記錄送貨人是誰、不標貨運單號。
- **聯**(單據的份叫「聯」;使用者 10/26 定案):四張都印兩聯,**一次列印 = 一個列印工作**:兩聯的版面接成一張圖(`PendingReceipt`),聯與聯之間放切紙位置(`Receipt58Cut`),代理程式在那裡切紙(底座「列印工作」的中段切紙,`docs/modules/printers.md`),所以一次 [完成這次點收] 算「已印 1 次」。每聯在單據名稱下方印聯別(「第 1 聯 · 店鋪留存」;`receipt-kinds.ts` 的 `copies`)。
- **已印次數與補印**:列印工作的 `refType` 每種單據各一個(`lottery-purchase-receiving`,`refId` = 點收批次,沒有批次的舊資料 = 進貨單 id;`lottery-transfer-shipment`,`refId` = 調貨單 id;`lottery-transfer-receiving`,`refId` = 點收批次,舊資料 = 調貨單 id;`lottery-transfer-payment`,`refId` = 那一筆現金流水 id),所以一次點收、一筆付款各是一張單據,各算各的次數(以「次」計:原單第 1 次,第一次補印第 2 次)。補印走底座的補印對話框:先選「補印哪一聯」(兩聯都補(預設)/ 第 1 聯 / 第 2 聯,底座 `reprintVariants`)再選原因;補印的每一聯上方印「【補印】第 N 次 · 時間 · 原因 · 補印人」(原因選「其他」時印說明)與聯別。
- **第一次列印也能選聯**(使用者 10/26 定案):還沒印過時按 [列印],先選「列印哪一聯」(兩聯都印(預設)/ 第 1 聯 / 第 2 聯;底座 `printVariants`);一聯的單據 [列印] 直接送。照「一次 = 一個工作」:只印第 1 聯也是第 1 次(不是補印),之後再印第 2 聯是補印(「【補印】第 2 次」)。
- **列印紀錄的單據名稱**(`documentName`,列印紀錄分頁與列印失敗通知):寫印了哪幾聯,補印另標「補印」—— 「進貨點收單 P-0001(兩聯)」「進貨點收單 P-0001(送貨人留存)補印」(`receiptDocumentNameOf`);只有一聯的單據維持原本的名稱(補印看「次數」欄)。不另加欄位。
- **單據太長**:多聯接成一張後超過高度 / 大小上限(`PRINT_IMAGE_MAX_HEIGHT_DOTS` / `PRINT_IMAGE_MAX_BYTES`,`isPrintImageTooLarge`)時,自動列印不送,跳一則提示「單據太長,這次沒有印出,請按 [列印] 分聯印」(那張單據已印過時寫 [補印])。
- **已印次數印完才更新**:交易後自動列印送出時工作還在等待中,那張單據的已印次數是 0;`useReceiptPrinter` 等這張工作的結果(`PrintResultWatch`,共用 `usePrintJobResult`),有結果就重查已印次數,標頭的 [列印] 跟著變 [補印]「已印 1 次」;做完就卸載的地方(調貨出貨單的審核擴充)靠底座列印按鈕收到那張工作的 `print-result`(同一張單據)就重查。
- **印表機**:單據所屬分店的預設印表機(`printablePrinters` 的 `defaultPrinterId`)→ 第一台可用的;單據可以給自己的預設,排在分店預設前面:調貨付款收據從收銀點抽屜付時用那個收銀點的印表機(店面的單據同理)。
- **自動列印只在寫入成功之後**:寫入失敗(送出、審核決定、付款被擋)不印;列印本身失敗(查印表機、轉圖、建立工作)只記 log,不打斷操作 —— 工作建立後的失敗(缺紙、代理程式離線)由底座的「列印失敗」通知告訴要求人。
- **在哪裡觸發**:進貨點收單、調貨點收單、調貨付款收據在做動作的畫面上([完成這次點收]、付款視窗寫入成功後);調貨出貨單登記成調貨單的審核擴充(`app/project/workflow-extensions.ts` 的 `Effect`,`docs/modules/workflows.md`「依模組登記的審核擴充」):審核決定 = 在第一關核准、送出 = 第一關被跳過,再讀點收區塊,只印出貨時間(`shippedAt`)在這個審核實例開始之後的在途列。

正本:`apps/admin/src/lib/project/lottery/receipts/`(每張單據一支版面函式 + `receipt-kinds.ts` 的單據種類)、`apps/admin/src/components/project/lottery/ReceiptPrint/`(`useReceiptPrinter` 的 `printReceiptAfterCommit(kind, payload)`、`ReceiptPrintButton`、點收單的批次選單 `ReceivingBatchPrint`、`ReceiptDocument`、`PrintResultWatch`)

## api 介面

### GraphQL

| 端點                                                                       | 權限                                                 | 說明                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lotteryRequisitionCandidates(orgId)`                                      | `purchasing.requisition.create`                      | 新增頁的遊戲清單(已排序):`gameId`、代號、名稱、面額、整本金額、預設批購金額率、上市日、`isNew`、`stockTickets`、`inTransitBooks`、`sold7` / `sold30`(新遊戲沒賣過 = null)、`plannedBooks`(沒設定 = null)、`givenBooks`。分店不在可見範圍 → `NOT_FOUND`                                                                                                                                                                                                                         |
| `lotteryPurchaseList`                                                      | `purchasing.requisition.purchase-list`               | `orgIds`(出現的分店)、`rows`(遊戲 × 分店本數、合計、預估批購金額)、`requisitions`(待購買的叫貨單,完成時間新到舊)                                                                                                                                                                                                                                                                                                                                                               |
| `lotteryRequisitionStates(requisitionIds)`                                 | `purchasing.requisition.view`                        | 已完成且未作廢的叫貨單 → `pending` / `purchased` / `transferred`;其他的不回                                                                                                                                                                                                                                                                                                                                                                                                    |
| `lotteryPurchaseOptions(orgId, submissionId?)`                             | `purchasing.purchase.create`                         | 新增頁的選項:營業中的甲類、甲類啟用中的受託人、扣款帳戶(使用中、使用組織包含這家店)、這家店待購買的叫貨單(含每個遊戲叫幾本;給 `submissionId` = 編輯中的那張進貨單時另含它已引用的叫貨單,退回修改時照原樣帶入;操作者讀不到那張單就當沒給)、販售中的遊戲、每個遊戲的預計要給本數 / 已給 / 在途(`allocations`)。分店不在可見範圍 → `NOT_FOUND`                                                                                                                                    |
| `lotteryPurchaseProgress(purchaseIds)`                                     | `purchasing.purchase.view`                           | 列表的點收進度(`receivedCount` / `totalCount`)與結算(`settlementKind`:`to_pay` / `to_refund` / null、`settlementAmount`、`inSettlement`)                                                                                                                                                                                                                                                                                                                                       |
| `lotteryDealerPurchases(dealerId)`                                         | `purchasing.purchase.view`                           | 甲類詳情「批購紀錄」:有效進貨單(單號、進貨分店、批購日、本人 / 受託人、本數、批購合計、狀態),批購日新到舊                                                                                                                                                                                                                                                                                                                                                                      |
| `lotteryPurchaseReceiving(submissionId)`                                   | 讀得到單據(一般讀取含依欄位共用、建立者、或持有任務) | 點收區塊:依遊戲分組、`requestedBooks`(叫貨單帶入)、每本點收了沒、`canReceive`                                                                                                                                                                                                                                                                                                                                                                                                  |
| `lotteryPurchaseRedemptionRecords(submissionId)`                           | 讀得到單據(一般讀取含依欄位共用、建立者、或持有任務) | 這張單勾選的兌獎紀錄(兌獎紀錄詳情欄位;`revokeMode` 一律 null)                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `receiveLotteryPurchaseBook(input: { submissionId, code, gameId? })`       | 同上 + 點收任務在自己手上                            | 點收一本;回點收的 `rowId` 與新的點收區塊。正面的碼(沒有遊戲代號)對到單上好幾款遊戲同本號、沒給 `gameId` → `PURCHASE_SCAN_AMBIGUOUS_GAME`(`extensions.gameIds`),選了遊戲再送一次照所選的遊戲配對                                                                                                                                                                                                                                                                                |
| `completeLotteryPurchaseReceiving(input: { submissionId, rowIds })`        | 同上 + 點收任務在自己手上                            | [完成這次點收]:這一次的列標上點收批次;回 `batch`(沒有可收的列 = null)、新的點收區塊與單據 QR 的路由 `receiptLinks`(依模組樹,同 `lotteryReceiptLinks`)                                                                                                                                                                                                                                                                                                                          |
| `notifyLotteryPurchaseWrongStore(input: { submissionId, code })`           | 同上                                                 | [通知總部更正]                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `lotteryTransferOptions(fromOrgId, toOrgId?, submissionId?)`               | `purchasing.transfer.create`                         | 新增頁:出貨店能調的本(有未售、沒鎖定、不在途的張;`isWhole` = 原封不動在出貨店(從沒拆過 `firstOpenedAt` 空、整本在出貨店庫存、沒鎖;拆過又全部收回也只能選張,使用者 10/27 定案 D)、`availableCount` = 可調張數扣掉待標註的跳號(未拆整本 = 標準張數,使用者 10/27 定案甲)、成本率)、收貨店待購買的叫貨單(給 `submissionId` = 編輯中的那張調貨單時另含它已引用的;讀不到那張單就當沒給)、收貨店這些遊戲的預計要給本數 / 已給 / 在途(`allocations`)。出貨店不在可見範圍 → `NOT_FOUND` |
| `lotteryTransferBookTickets(fromOrgId, bookId)`                            | `purchasing.transfer.create`                         | 張數格子:每一張 `available` / `sold` / `locked` / `skipped` / `elsewhere`                                                                                                                                                                                                                                                                                                                                                                                                      |
| `lotteryTransferProgress(transferIds)`                                     | `purchasing.transfer.view`                           | 列表:整本幾本、選張幾張、點收進度、`inTransit`、結算(`to_pay` / `to_refund` / `to_receive`);兩邊店都讀得到                                                                                                                                                                                                                                                                                                                                                                     |
| `lotteryTransferReceiving(submissionId)`                                   | 讀得到單據(一般讀取含依欄位共用、建立者、任務持有者) | 出貨確認清單 / 點收區塊:出貨 / 收貨分店名稱、調貨金額、每一列(方式、張號、批購金額、`shipped`、`shippedAt` = 最近一次調出的時間、`received` = 到齊、`receivedTickets` = 已點收幾張、`batchId` = 最近一次的點收批次、`receivedTicketNos` = 點收紀錄實際搬進來的張號)、`batches`(每一次點收;`rows[{ rowId, ticketNos }]` = 這一次每一列點收的張)、`canReceive`                                                                                                                   |
| `receiveLotteryTransferBook(input: { submissionId, code, gameId? })`       | 同上 + 點收關卡的任務在自己手上                      | 刷一張:整本的列整列、選張的列只點收那一張;回 `rowId`、這一次的 `ticketNos` 與新的點收區塊。正面的碼對到單上好幾款遊戲同本號:同進貨單(`TRANSFER_SCAN_AMBIGUOUS_GAME`)                                                                                                                                                                                                                                                                                                           |
| `receiveLotteryTransferTickets(input: { submissionId, rowId, ticketNos })` | 同上 + 點收關卡的任務在自己手上                      | 選張的列在格子上點收(點選格子 / 其餘全部到齊);回同上                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `completeLotteryTransferReceiving(input: { submissionId, rowIds })`        | 同上 + 點收關卡的任務在自己手上                      | [完成這次點收]:這一次的列標上點收批次;回 `batch`(沒有可收的列 = null)、新的點收區塊與單據 QR 的路由 `receiptLinks`(依模組樹,同 `lotteryReceiptLinks`)                                                                                                                                                                                                                                                                                                                          |
| `notifyLotteryTransferWrongStore(input: { submissionId, code })`           | 同上(讀得到這張調貨單)                               | 送錯分店的 [通知總部更正]                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

叫貨單本身的新增 / 存草稿 / 送出 / 審核 / 作廢走表單引擎與審核流程的端點。GraphQL 文件:`packages/graphql/src/documents/project/lottery/requisition.graphql`、`purchase.graphql`、`transfer.graphql`。

### 給其他功能的介面

- **引用介面**(`apps/api/src/project/lottery/requisition/requisition-reference.ts`,`LotteryRequisitionModule` 匯出的 `RequisitionReference`;進貨單、調貨單在自己的掛接點、同一個交易呼叫):
  - `markRequisitionReferenced(session, { tenantId, requisitionId, type: "purchase" | "transfer", submissionId })`:叫貨單 → 已進貨 / 已調貨。一張叫貨單只能對應一張;已被**別張**引用 → `CONFLICT`(`REQUISITION_REFERENCED`);同一張重送不重複寫;還沒完成、已作廢、找不到、別的租戶的 → `VALIDATION_FAILED`(`REQUISITION_NOT_PENDING`)
  - `unmarkRequisitionReferenced(session, { tenantId, requisitionId })`:引用的單駁回 / 作廢 → 回到待購買
  - `tenantId` 由呼叫端傳引用單據的 `submission.tenantId`;讀寫用該租戶的租戶邊界上下文(調貨單的系統身分只看得到出貨店,叫貨單在收貨店),條件再釘 `tenantId`(登記在 `project/database/tenant-boundary-callers.ts`,用途「例外寫入」)
- **在途來源**(`in-transit.ts`):`registerInTransitSource(name, ({ tenantId, orgId }) => Map<gameId, 本數>)`,`inTransitBooksOf` 加總。叫貨單(待購買的副本)由本模組登記;進貨單、調貨單各自登記「已建立還沒點收完成」的本數(草稿不算)。
- **遊戲引用檢查**:向檔案管理登記 `lottery-requisitions`(`game-usage.ts`):草稿以外的叫貨單引用過的遊戲 = 有庫存(鎖定、不能刪)。
- **帳本的系統鎖與換店**(調貨單用,`TicketLedgerService`):`lockTicketsInTenant` / `unlockTicketsInTenant`(事後動作的系統身分只看得到單據的組織,以租戶邊界改自己的鎖);`LedgerContext.systemActorId`(沒有操作者的系統寫入代表觸發它的人,才能換店,稽核記他;作廢調貨單時是作廢的人)。正本 `docs/modules/project/inventory.md`。
- **收付登記的擴充**(調貨單用,`registerSettlementDocument`):`payable` 可以是非同步;`SettlementPayable.received`(付款方先填值的基準,進 `SettlementState.received`);`sideBranchPaths`(兩邊店的單據:每一邊要那一邊的分店在讀者可見範圍內才能記;兩邊店看得到靠依欄位共用)。正本 `docs/modules/project/accounts.md`。

### 錯誤碼

| code / reason                                                                                                                                                                                                                                                  | 什麼時候                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `FORBIDDEN` + `REQUISITION_NO_LINES`                                                                                                                                                                                                                           | 送出時明細沒有本數 > 0 的列                                 |
| `FORBIDDEN` + `REQUISITION_GAME_DISCONTINUED`                                                                                                                                                                                                                  | 送出時明細有停售 / 不存在的遊戲                             |
| `FORBIDDEN` + `REQUISITION_REFERENCED`                                                                                                                                                                                                                         | 作廢已被引用的叫貨單                                        |
| `CONFLICT` + `REQUISITION_REFERENCED`                                                                                                                                                                                                                          | 引用介面:已被別張進貨單 / 調貨單引用                        |
| `VALIDATION_FAILED` + `REQUISITION_NOT_PENDING`                                                                                                                                                                                                                | 引用介面:不是待購買                                         |
| `FORBIDDEN` + `PURCHASE_*`(見「進貨單」掛接點表)                                                                                                                                                                                                               | 進貨單送出 / 核准 / 駁回 / 刪除 / 作廢被擋                  |
| `FORBIDDEN` + `SETTLEMENT_NOT_CLEARED`                                                                                                                                                                                                                         | 進貨單駁回 / 作廢前淨額 ≠ 0                                 |
| `FORBIDDEN` + `PURCHASE_REDEMPTION_INVALID`                                                                                                                                                                                                                    | 進貨單送出:勾選的兌獎紀錄不是進貨分店店內持有的、或金額不同 |
| `FORBIDDEN` + `PURCHASE_NOT_RECEIVABLE`                                                                                                                                                                                                                        | 點收:不在審核中或任務不在自己手上                           |
| `VALIDATION_FAILED` + `PURCHASE_SCAN_INVALID` / `PURCHASE_SCAN_AMBIGUOUS_GAME` / `PURCHASE_ALREADY_RECEIVED` / `PURCHASE_LAST_TICKET_MISMATCH` / `PURCHASE_WRONG_STORE` / `PURCHASE_BOOK_NOT_ON_PURCHASE`                                                      | 點收刷條碼                                                  |
| `FORBIDDEN` + `TRANSFER_*`(見「調貨單」掛接點表)                                                                                                                                                                                                               | 調貨單送出 / 核准 / 駁回 / 刪除 / 作廢被擋                  |
| `FORBIDDEN` + `TRANSFER_NOT_RECEIVABLE`                                                                                                                                                                                                                        | 調貨點收:不在審核中或點收關卡的任務不在自己手上             |
| `VALIDATION_FAILED` + `TRANSFER_SCAN_INVALID` / `TRANSFER_SCAN_AMBIGUOUS_GAME` / `TRANSFER_ALREADY_RECEIVED` / `TRANSFER_NOT_SHIPPED` / `TRANSFER_WRONG_STORE` / `TRANSFER_BOOK_NOT_ON_TRANSFER` / `TRANSFER_WHOLE_ROW_TICKETS` / `TRANSFER_WHOLE_ROW_TICKETS` | 調貨點收刷條碼                                              |

前端文案:掛接點擋下的在 `admin.lifecycle.<reason>`(專案字典)。

## admin 頁面

- 列表頁 `RequisitionPage`:分頁頁殼。叫貨單分頁 `RequisitionsTab`:狀態篩選(含「草稿」,網址 `?requisitions=`)、欄位讀列表欄位配置(`useRequisitionColumns`,狀態欄把已完成細分 待購買 / 已進貨 / 已調貨);點一筆進詳情頁;手機改卡片、篩選收進抽屜(RW-01)。
- 採購清單分頁 `PurchaseListTab`(資料 `usePurchaseList`;分店名稱與分店選擇器同一份組織樹)。
- 採購清單在手機上照樣是表格(遊戲 × 分店的交叉表,欄數隨分店變),表格自己橫向捲動,不改卡片。
- 新增頁 `RequisitionCreatePage` / 編輯頁 `RequisitionEditPage` 共用畫面 `RequisitionForm`:電腦是表格、平板 / 手機是卡片(`CandidateTable` / `CandidateCards`);純函式在 `requisition-form.ts`(`requisitionFormStateOf` = 存值 → 畫面)。編輯頁(草稿、被退回 / 撤回)帶入原內容:每個遊戲的本數與 rowId 照舊,明細備註、單頭備註原樣存回;已不在販售中的遊戲列不出來、原樣保留並提示。
- 三種單據的替換編輯頁共用 `shared/useDocumentEdit.tsx`:讀那一筆,能不能編輯照 `abilities.canEdit` / `canSaveDraft`,存草稿 / 送出走 `useFormSubmission`(帶 `expectedEditVersion`);不是草稿 / 退回 / 撤回的狀態交回表單引擎的預設編輯頁(`FormEditPage`)。
- 進貨單列表 `PurchasePage`:欄位讀列表欄位配置(與叫貨單列表共用 `shared/useFormListColumns.tsx`)+ 點收進度、結算(`lotteryPurchaseProgress`);狀態篩選(網址 `?purchases=`);手機改卡片。
- **已知缺口**:進貨單列表的「進貨分店」「期間」篩選(Figma PU-04)還沒做,叫貨單列表同:底座表單列表的查詢還不支援組織欄 / 日期區間條件,之後開底座票補上再接。
- 進貨單新增頁 `PurchaseCreatePage` / 編輯頁 `PurchaseEditPage` 共用畫面 `PurchaseForm`:單頭 `PurchaseHeaderFields`、明細用依遊戲分組的本清單 `BookGroupList`(新增 / 編輯模式)、刷條碼列 `BookScanBar`(一直顯示「正面條碼的遊戲」;正面的碼沒有遊戲代號時用它);純函式在 `purchase-form.ts`(`purchaseFormStateOf` = 存值 → 畫面)。編輯頁(草稿、被退回 / 撤回)帶入原內容(rowId、批購金額率、勾選的兌獎紀錄照舊;叫貨單 / 兌獎紀錄的選項帶 `submissionId`,含這張單已引用的):已點收的列(`lotteryPurchaseReceiving`)鎖住、標「已點收」,組標題進度照 `BookGroupList` 的規則,明細上方提示;有已點收的本時進貨分店也鎖住。鎖住的列張數 / 整本金額照存的(不照遊戲現值重算);讀不到內容的列(本號格式不對等)提示並原樣存回;選項讀到之前不能存草稿 / 送出(叫貨單要在選項裡找得到才寫入)。點收在編輯頁不能操作(點收要單據在審核中)。採購清單的 [建立進貨單](`CreatePurchaseAction`,追加到 `PENDING_REQUISITION_ACTIONS`)帶 `?requisition=<單號>&branch=<分店>`。超過預計要給本數只警告(規格 7.6):`lotteryPurchaseOptions` 回每個販售中遊戲的預計 / 已給 / 在途,「已給 + 在途 + 這張單這個遊戲刷了幾本 > 預計」時列出(`AllocationWarnings`,與調貨單共用),照樣可以送出。
- 進貨單檢視頁 `PurchaseViewPage`:引擎的 `FormSubmissionDetail` + 點收區塊 + `SettlementPanel` + `ApprovalSection`;送錯分店彈窗 `WrongStoreDialog`;標頭 [列印] / [補印] 進貨點收單(`PurchaseReceiptPrint` → 共用的 `ReceivingBatchPrint`:點收過兩次以上時多一個「點收批次」選單)。
- 依遊戲分組的本清單 `components/project/lottery/BookGroupList/`(進貨單、調貨單的新增、編輯、出貨確認清單、點收、檢視共用):模式 `create`(可改率、可移除)/ `edit`(`isLocked` 的列唯讀並標狀態,其他同新增)/ `receive`(唯讀、每本顯示點收了沒)/ `view`(唯讀、沒有刷條碼列);狀態(已點收 / 未點收 / 在途)的顏色固定在元件,文字由使用處給;組標題的進度四種模式同一條規則(有叫貨單 →「叫貨 N」;一律「已刷 M」= 單上本數;有點收資訊時 →「已點收 X / M」;例「叫貨 5,已刷 4,已點收 2 / 4」),文字由 `useBookProgressLabel` 給;進貨單點收的「叫貨 N」取 `lotteryPurchaseReceiving` 的 `requestedBooks`,調貨單沒有逐遊戲的叫貨本數,不顯示;電腦表格、平板 / 手機卡片,所有模式同一個斷點。
- 刷條碼列 `components/project/lottery/BookScanBar/`(輸入欄 + `useScanner` + 手動 Enter、需要時才給的「正面條碼的遊戲」選單、提示固定在這一列正下方):新增 / 編輯頁一直顯示遊戲選單;點收平常不顯示。
- 點收區塊 `components/project/lottery/ReceiveBooksPanel/` = `BookGroupList`(點收 / 檢視模式)+ `BookScanBar` + [完成這次點收];進貨單、調貨單共用,資料與寫入由呼叫端給;欄名可由使用處覆寫 `columnLabels`(調貨單用「張號」「金額」與張號區段)。正面的碼對到好幾款遊戲同本號(api 回 `*_SCAN_AMBIGUOUS_GAME`)時才出現遊戲選單,選了就照所選的遊戲再確認一次,點收成功後收起;比對邏輯在 `@repo/domain/project/lottery` 的 `matchBookScan`(api 點收與調貨新增頁的找本共用)。
- 甲類詳情「批購紀錄」分頁 `DealerPurchasesTab`(追加到 `dealer-detail-tabs.ts`;綁了 `purchasing.purchase` 才看得到)。
- 進貨單 / 調貨單的自訂列表與檢視頁有 [刪除](`shared/SubmissionDeleteButton`):**只限草稿**,而且照引擎的 `abilities.canDelete`(建立者本人等引擎規則)出現;api 的 `beforeDelete` 也擋非草稿,確認與刪除沿用底座的 `DeleteSubmissionDialog` + `deleteFormSubmission`。
- 調貨單列表 `TransferPage`:欄位讀列表欄位配置 + 本數 / 張數、點收進度、結算(`lotteryTransferProgress`);審核中且有列在途的狀態顯示「在途」;狀態篩選(網址 `?transfers=`);手機改卡片。
- 調貨單新增頁 `TransferCreatePage` / 編輯頁 `TransferEditPage` 共用畫面 `TransferForm`:單頭(出貨 / 收貨分店 `OrgTreeSelect scope="visible"`、收貨店待購買的叫貨單、備註)、左邊明細(`BookGroupList` 依遊戲分組,一列一本或一本的選張,方式寫在本號下面;批購金額率逐本改;`useTransferLineList`)與刷條碼列 `BookScanBar`(一直顯示「正面條碼的遊戲」;正面的碼對到出貨店好幾款遊戲同本號、沒選遊戲 → 提示)、右邊 `TransferBookPanel`(選本;原封不動的本 [整本加入],拆過的本用 `TicketGrid` 選張後 [加入選取],沒有 `partial-tickets` 不出現格子);刷條碼:原封不動的本直接整本加入、拆過的本選起刷到的那張;純函式在 `transfer-form.ts`(`transferFormStateOf` = 存值 → 畫面)。選本 + 張數格子(`TransferBookPanel`)的形狀和本清單不同,保留自己的元件。編輯頁(草稿、被退回 / 撤回)帶入原內容(rowId、方式、張號、批購金額率照舊;本的事實取 `lotteryTransferReceiving`):已點收、已出貨(在途)的列鎖住並標示(不能改批購金額率、不能再併選張;api 的 `isSameShipment` 也比對金額 / 批購金額率 / 批購金額,改了 → `TRANSFER_LINE_INVALID`),組標題進度照 `BookGroupList` 的規則,出貨 / 收貨分店也鎖住;已點收(含部分點收)的列不能刪,在途的列可以刪(`isRemovable`;路上遺失 → 送出後變待查);已出貨、還沒到齊的選張列可以展開格子取消勾選沒到的張(`useShippedLines`;已點收的張鎖住,列顯示「部分點收 9 / 12」),送出前確認會變成待查的張;沒出貨的列同新增頁。讀不到本 / 遊戲的列提示並原樣存回。採購清單的 [從其他分店調貨](`CreateTransferAction`,追加到 `PENDING_REQUISITION_ACTIONS`)帶 `?requisition=<單號>&to=<收貨分店>`。
- 調貨單檢視頁 `TransferViewPage`:標頭(關卡標籤、出貨店 → 收貨店、叫貨單、調貨金額、建立者)+ 還沒出貨時的出貨確認清單(`BookGroupList` 檢視模式)/ 出貨後的點收區塊(共用 `ReceiveBooksPanel`;都依遊戲分組)+ `SettlementPanel` + 核准前三個數字不相等的提示 + `ApprovalSection`。點收(`useTransferReceiving`):選張的列展開格子(`BookGroupList` 每列的 `panel`;`TransferRowTickets`),刷到那一列的張時自動展開、捲到並閃一下;列狀態「未點收 0 / 10」「部分點收 9 / 12」「已點收」(`BookRowStatus` `partial` + 使用處給的文字);點收過一部分還有張沒到時提示哪幾張(`transfer-unreceived.ts`);送錯分店彈窗 `TransferWrongStoreDialog`(只有 [知道了])。標頭的 [列印] 三顆(調貨出貨單、調貨點收單、調貨付款收據,`TransferPrintButtons`,資料在 `useTransferReceipts`;調貨點收單點過兩次以上時多一個「點收批次」選單)。[完成這次點收] 寫入成功後自動印調貨點收單。第一關通過後的自動列印是 `transfer/TransferShipmentEffect.tsx`(登記在 `app/project/workflow-extensions.ts`)。

## 測試

- api:`apps/api/src/project/lottery/requisition/requisition.test.ts`(B4 跳過 / 審核、副本、草稿不算、遊戲清單排序與銷售欄、採購清單、權限、引用介面、作廢、遊戲引用檢查)
- 開通:`apps/db-migrator/seeds/project/onboarding/onboarding-api.test.ts`「叫貨單的流程」(真 api:總部人員送出直接完成、店長送出派給總部管理)、`seeds/project/purchasing.test.ts`
- domain:`packages/domain/src/project/lottery/requisition.test.ts`
- admin:`pages/project/lottery/purchasing/**/*.test.ts(x)`
- 進貨單 api:`apps/api/src/project/lottery/purchase/purchase.test.ts`(掛接點表每一列、本號重複、送錯分店與通知、進貨支出與 5 情境、批購日、側欄計數、settle、遊戲引用、在途、批購紀錄)
- 進貨單兌獎 api:`apps/api/src/project/lottery/purchase/purchase-redemption.test.ts`(新增頁的兌獎區、規格 8.2 例 100,000 / 60,000、撤回 / 重新送出 / 退回、送出前檢查)
- 進貨單 seed:`seeds/project/purchasing.purchase.test.ts`;domain:`packages/domain/src/project/lottery/purchase.test.ts`
- 調貨單 api:`apps/api/src/project/lottery/transfer/transfer.test.ts`(掛接點表每一列、送出前的本 / 張檢查、鎖定不能賣、第一關跳過也調出與通知、點收與單張成本、選張的列逐張點收(刷一張 / 選格子 / 其餘全部到齊)、少張處理(調 12 張只到 9 張 → 退回 → 出貨店移除 3 張 → 重送 → 核准;兩店庫存、結算、報表調入 / 調出)、送錯分店、調貨後對調跳號(做法 D)、規格第 9 章 5 步驟例與分次付款例、核准前三個數字、兩邊權限、駁回 / 作廢回到出貨店、側欄計數四種情況、列表進度)
- 調貨單 seed:`seeds/project/purchasing.transfer.test.ts`;domain:`packages/domain/src/project/lottery/transfer.test.ts`;admin:`pages/project/lottery/purchasing/transfer/**/*.test.ts(x)`
- 列印(58mm 單據):版面 `lib/project/lottery/receipts/receipts.test.ts`(各單據的聯別與簽名欄快照、補印選聯、列印紀錄名稱、付款收據只印收貨店的現金、`refType` / `refId`)、`transfer-receiving-receipt.test.ts`(調貨點收單);admin `PurchaseViewPagePrint.test.tsx`(一次 = 一個工作含兩聯與切紙位置、印好後按鈕變 [補印]、沒有列印權限、分店沒有印表機時停用並說明、點收兩次 → 補印第一次只補第 2 聯「【補印】第 2 次」、沒有批次的舊資料兩聯都補)、`TransferViewPagePrint.test.tsx`(核准第一關 → 一個工作兩聯、[完成這次點收] 印調貨點收單、付現自動印付款收據 / 轉帳不印、[列印] 付款收據)、`TransferCreatePagePrint.test.tsx`(新增頁 / 引擎編輯頁送出時第一關被跳過 → 印、沒跳過不印);已印次數不寫死(假伺服器 `printButtonWorld` 照送出、印出的工作計);api `purchase.test.ts` / `transfer.test.ts`([完成這次點收] 的點收批次)、`transfer.test.ts`(收付紀錄帶 `cashPlace`)

## 使用者說明(help.md)

`apps/admin/src/md/module-help/project/additions/purchasing.requisition.help.md`

`apps/admin/src/md/module-help/project/additions/purchasing.purchase.help.md`

`apps/admin/src/md/module-help/project/additions/purchasing.transfer.help.md`
