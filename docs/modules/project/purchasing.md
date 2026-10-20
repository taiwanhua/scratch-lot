# 叫貨與進貨(技術)

## 用途

分店向總部叫貨、總部彙總後採購,進貨與調貨把刮刮樂送到分店(專案規格第 8 章共通、8.1–8.4)。一個群組三個表單模組:**叫貨、採購單**(叫貨單 + 採購清單)、**進貨單**、**調貨單**。三張單據都是底座表單 + 流程,掛接點依底座 B1(`docs/concepts/workflow-engine.md`「掛接點」)。

本檔分小節:群組與叫貨、採購單由第一張票寫;進貨單、調貨單各自追加自己的小節與 api / 頁面。

正本:`apps/db-migrator/seeds/project/purchasing.ts`、`packages/domain/src/project/lottery/requisition.ts`

## 模組 key 與畫面

| key                                  | 名稱         | sidebarType  | 路由                                              | 說明                                                                                            |
| ------------------------------------ | ------------ | ------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `purchasing`                         | 叫貨與進貨   | group        | `/purchasing`                                     | 群組;側欄 `order: 30`,圖示 `receipt`                                                            |
| `purchasing.requisition`             | 叫貨、採購單 | link(列表頁) | `/purchasing/requisition`                         | 表單模組(綁定 叫貨單 `requisition`);分頁 叫貨單 \| 採購清單(Figma PU-01 92:1017、PU-03 92:1340) |
| `purchasing.requisition.view-page`   | 詳情         | hidden       | `/purchasing/requisition/view-page/<id>`          | 表單引擎的詳情頁(檢視、審核、撤回、作廢)                                                        |
| `purchasing.requisition.create-page` | 新增         | hidden       | `/purchasing/requisition/create-page/requisition` | **替換**:列出所有販售中遊戲的叫貨頁(PU-02 電腦 69:15、平板 127:26386、手機 127:26700)           |
| `purchasing.requisition.edit-page`   | 編輯         | hidden       | `/purchasing/requisition/edit-page/<id>`          | 表單引擎的編輯頁(草稿、被退回的單;明細是引擎的明細表格)                                         |

- 頁內分頁用底座 `PageTabs`(`?tab=requisitions | purchase-list`;沒有 `purchase-list` 看不到採購清單分頁,只剩一個分頁時不顯示分頁籤)。右上按鈕跟著分頁換:[+ 新增叫貨單] / [匯出 Excel]。
- 進貨單 `purchasing.purchase`、調貨單 `purchasing.transfer` 由各自的票宣告,掛在本群組底下。

正本:`apps/admin/src/app/project/module-pages.ts`、`apps/admin/src/pages/project/lottery/purchasing/`

## 權限表

| 權限 key                               | 它是哪一頁的什麼                                                 |
| -------------------------------------- | ---------------------------------------------------------------- |
| `purchasing.requisition.view`          | 看叫貨單列表、詳情;列表的衍生狀態(`lotteryRequisitionStates`)    |
| `purchasing.requisition.create`        | [+ 新增叫貨單]、新增頁的遊戲清單(`lotteryRequisitionCandidates`) |
| `purchasing.requisition.edit`          | 改草稿 / 被退回的單;作廢(申請人本人或有 `edit`)                  |
| `purchasing.requisition.delete`        | 刪草稿                                                           |
| `purchasing.requisition.purchase-list` | 「採購清單」分頁、[匯出 Excel](`lotteryPurchaseList`)            |

### 開通時建立的角色

| 角色     | 叫貨、採購單                                       |
| -------- | -------------------------------------------------- |
| 總部管理 | 全部(`purchasing.requisition.*`,含採購清單)        |
| 店長     | `view` / `create` / `edit` / `delete`,不含採購清單 |
| 店員     | 不給                                               |

正本:`apps/db-migrator/seeds/project/onboarding/role-grants/purchasing.ts`

### 表單

| 表單   | formKey       | 綁定模組                 | 受管表單                                                             |
| ------ | ------------- | ------------------------ | -------------------------------------------------------------------- |
| 叫貨單 | `requisition` | `purchasing.requisition` | `seeds/project/revisions/requisition.r2.seed.ts`(r1 = 初版,保留不改) |

## 資料

| 表                          | 說明                                                                                                                                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `form_submissions`(底座)    | 叫貨單本身(表單引擎);欄位見下方「叫貨單」                                                                                                                                                                                     |
| `lottery_requisition_lines` | 叫貨明細副本:`orgId`(叫貨分店)、`requisitionId`、`serialNo`(快照)、`gameId`、`books`、`note`、`completedAt`、`voidedAt`、`referencedBy { type: purchase \| transfer, submissionId }`;唯一 `(requisitionId, gameId)`(未刪除的) |

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

**流程**(開通腳本建,不 seed):一關,審核者 = 角色「總部管理」;**B4 跳過組織 = 租戶**(總部是某家分店時改選那家店)。B4 比對的是**申請人**的所屬組織:總部人員(一律屬於最上層組織)送出的叫貨單、替分店送的也一樣,直接跳過審核完成。

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

**作廢原因**:受管表單設了 `voidReasonCategoryKey: "lottery-void-reason"`(`requisition.r2.seed.ts`),作廢對話框是欄位管理「作廢原因」的下拉(輸入錯誤 / 重複建立 / 交易取消 / 其他),選「其他」說明必填;不在類別內的值 → `VALIDATION_FAILED`(`fields: ["reasonKey"]`)。選項依作廢者的範圍(全域 + 上層 + 自己),機制見底座 `docs/modules/forms.md`「作廢原因」。

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

## api 介面

### GraphQL

| 端點                                       | 權限                                   | 說明                                                                                                                                                                                                                                                   |
| ------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lotteryRequisitionCandidates(orgId)`      | `purchasing.requisition.create`        | 新增頁的遊戲清單(已排序):`gameId`、代號、名稱、面額、整本金額、預設批購金額率、上市日、`isNew`、`stockTickets`、`inTransitBooks`、`sold7` / `sold30`(新遊戲沒賣過 = null)、`plannedBooks`(沒設定 = null)、`givenBooks`。分店不在可見範圍 → `NOT_FOUND` |
| `lotteryPurchaseList`                      | `purchasing.requisition.purchase-list` | `orgIds`(出現的分店)、`rows`(遊戲 × 分店本數、合計、預估批購金額)、`requisitions`(待購買的叫貨單,完成時間新到舊)                                                                                                                                       |
| `lotteryRequisitionStates(requisitionIds)` | `purchasing.requisition.view`          | 已完成且未作廢的叫貨單 → `pending` / `purchased` / `transferred`;其他的不回                                                                                                                                                                            |

叫貨單本身的新增 / 存草稿 / 送出 / 審核 / 作廢走表單引擎與審核流程的端點。GraphQL 文件:`packages/graphql/src/documents/project/lottery/requisition.graphql`。

### 給其他功能的介面

- **引用介面**(`apps/api/src/project/lottery/requisition/requisition-reference.ts`,`LotteryRequisitionModule` 匯出的 `RequisitionReference`;進貨單、調貨單在自己的掛接點、同一個交易呼叫):
  - `markRequisitionReferenced(session, { tenantId, requisitionId, type: "purchase" | "transfer", submissionId })`:叫貨單 → 已進貨 / 已調貨。一張叫貨單只能對應一張;已被**別張**引用 → `CONFLICT`(`REQUISITION_REFERENCED`);同一張重送不重複寫;還沒完成、已作廢、找不到、別的租戶的 → `VALIDATION_FAILED`(`REQUISITION_NOT_PENDING`)
  - `unmarkRequisitionReferenced(session, { tenantId, requisitionId })`:引用的單駁回 / 作廢 → 回到待購買
  - `tenantId` 由呼叫端傳引用單據的 `submission.tenantId`;讀寫用該租戶的租戶邊界上下文(調貨單的系統身分只看得到出貨店,叫貨單在收貨店),條件再釘 `tenantId`(登記在 `project/database/tenant-boundary-callers.ts`,用途「例外寫入」)
- **在途來源**(`in-transit.ts`):`registerInTransitSource(name, ({ tenantId, orgId }) => Map<gameId, 本數>)`,`inTransitBooksOf` 加總。叫貨單(待購買的副本)由本模組登記;進貨單、調貨單各自登記「已建立還沒點收完成」的本數(草稿不算)。
- **遊戲引用檢查**:向檔案管理登記 `lottery-requisitions`(`game-usage.ts`):草稿以外的叫貨單引用過的遊戲 = 有庫存(鎖定、不能刪)。

### 錯誤碼

| code / reason                                   | 什麼時候                             |
| ----------------------------------------------- | ------------------------------------ |
| `FORBIDDEN` + `REQUISITION_NO_LINES`            | 送出時明細沒有本數 > 0 的列          |
| `FORBIDDEN` + `REQUISITION_GAME_DISCONTINUED`   | 送出時明細有停售 / 不存在的遊戲      |
| `FORBIDDEN` + `REQUISITION_REFERENCED`          | 作廢已被引用的叫貨單                 |
| `CONFLICT` + `REQUISITION_REFERENCED`           | 引用介面:已被別張進貨單 / 調貨單引用 |
| `VALIDATION_FAILED` + `REQUISITION_NOT_PENDING` | 引用介面:不是待購買                  |

前端文案:掛接點擋下的在 `admin.lifecycle.<reason>`(專案字典)。

## admin 頁面

- 列表頁 `RequisitionPage`:分頁頁殼。叫貨單分頁 `RequisitionsTab`:狀態篩選(含「草稿」,網址 `?requisitions=`)、欄位讀列表欄位配置(`useRequisitionColumns`,狀態欄把已完成細分 待購買 / 已進貨 / 已調貨);點一筆進詳情頁;手機改卡片、篩選收進抽屜(RW-01)。
- 採購清單分頁 `PurchaseListTab`(資料 `usePurchaseList`;分店名稱與分店選擇器同一份組織樹)。
- 採購清單在手機上照樣是表格(遊戲 × 分店的交叉表,欄數隨分店變),表格自己橫向捲動,不改卡片。
- 新增頁 `RequisitionCreatePage`:電腦是表格、平板 / 手機是卡片(`CandidateTable` / `CandidateCards`);純函式在 `requisition-form.ts`。
- 編輯頁(草稿、被退回)沿用表單引擎的預設編輯頁。

## 測試

- api:`apps/api/src/project/lottery/requisition/requisition.test.ts`(B4 跳過 / 審核、副本、草稿不算、遊戲清單排序與銷售欄、採購清單、權限、引用介面、作廢、遊戲引用檢查)
- 開通:`apps/db-migrator/seeds/project/onboarding/onboarding-api.test.ts`「叫貨單的流程」(真 api:總部人員送出直接完成、店長送出派給總部管理)、`seeds/project/purchasing.test.ts`
- domain:`packages/domain/src/project/lottery/requisition.test.ts`
- admin:`pages/project/lottery/purchasing/**/*.test.ts(x)`

## 使用者說明(help.md)

`apps/admin/src/md/module-help/project/additions/purchasing.requisition.help.md`
