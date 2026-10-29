# 欄位管理:本專案的系統類別

底座「欄位管理」(`docs/modules/field-manager.md`)在本專案多種下的系統類別與全域選項。種子在 `apps/db-migrator/seeds/project/field-categories.ts`(形狀與認養規則同底座 `seeds/base/field-categories.ts`、`fields.ts`);類別 key 與程式要認得的選項代碼在 `@repo/domain/project/lottery-fields`、`@repo/domain/project/schedule-fields`。內容來源:專案規格第 13 章。

- 選項 value 一律英文 kebab-case;「其他」一律 `other`,選它時說明必填,全系統一致(`@repo/domain/project/reason-note` 的 `requiresReasonNote`)。
- 選項依表中順序 1 起算(`order`);租戶可以再自己加選項。
- 崗位類別**不內建選項**:各機構開通時自己建(開通資料的 `positions`;示範機構的店內櫃台A、店外櫃台B 放示範資料,不是系統選項)。全域選項目前都沒有初始顏色(要給的話在 seed 的選項宣告加 `color`,規則見底座「規則」的「選項顏色」)。
- 不放欄位管理(程式依值做事):銀行交易類型、現金流水類型、張的狀態 / 位置、經銷商類型與狀態、關係人身分、職責、行事曆類型。

## 類別與預設選項

| 類別 key                           | 名稱           | 選項(value)                                                                                                                                                                 | 用在                         |
| ---------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `lottery-sale-reversal-reason`     | 撤銷售出原因   | 客人退貨 `customer-return`、刷錯刮刮樂 `wrong-ticket`、盤點錯誤 `stocktake-error`、其他                                                                                     | 撤銷售出申請                 |
| `lottery-redemption-revoke-reason` | 撤銷兌獎原因   | 登記錯誤 `entry-error`、金額錯誤 `wrong-amount`、其他                                                                                                                       | 撤銷兌獎(已結帳或別人登記)   |
| `lottery-manual-sale-reason`       | 手動標記原因   | 刷不到條碼 `scan-failed`(預設)、系統異常補登 `system-backfill`、其他                                                                                                        | 手動標記售出                 |
| `lottery-cash-correction-reason`   | 現金更正原因   | 員工賠補 `staff-compensation`、客人補付 `customer-top-up`、尋回 `recovered`、退還客人 `customer-refund`、遺失 `lost`、假鈔 `counterfeit`、存款短少 `deposit-shortage`、其他 | 現金更正單                   |
| `void-reason`                      | 作廢原因       | 輸入錯誤 `input-error`、重複建立 `duplicate`、交易取消 `transaction-cancelled`、其他                                                                                        | 所有單據作廢                 |
| `lottery-checkout-diff-reason`     | 結帳差額原因   | 找錯錢 `wrong-change`、兌獎誤付 `redemption-overpaid`、審核中的單據 `pending-documents`、其他                                                                               | 結帳精靈、日結               |
| `lottery-skip-stocktake-reason`    | 跳過盤點原因   | 人力不足 `short-staffed`、系統異常 `system-error`、其他                                                                                                                     | 結帳精靈、日結               |
| `lottery-withdraw-reason`          | 出庫原因       | 開班零用金 `opening-float`、補零錢 `change-refill`、其他                                                                                                                    | 出庫                         |
| `lottery-lost-reason`              | 遺失原因       | 調貨途中遺失 `lost-in-transfer`、店內遺失 `lost-in-store`、原因不明 `unknown`、其他                                                                                         | 確認遺失                     |
| `lottery-recover-reason`           | 尋回原因       | 盤點找到 `found-in-stocktake`、調貨送錯 `transfer-misdelivered`、其他                                                                                                       | 尋回                         |
| `lottery-scrap-reason`             | 報廢原因       | 破損 `damaged`、污損 `soiled`、其他                                                                                                                                         | 報廢                         |
| `schedule-position`                | 崗位           | 不內建(各機構開通時自建)                                                                                                                                                    | 人力需求、收銀點、支援需求單 |
| `schedule-task`                    | 執行任務       | 店內事務與帳目負責 `store-and-accounts-lead`、店內事務 `store-duties`                                                                                                       | 人力需求的每筆執行任務       |
| `schedule-change-reason`           | 排班異動原因   | 臨時請假 `emergency-leave`、換班 `shift-swap`、病假 `sick-leave`、其他                                                                                                      | 發布後排班異動               |
| `schedule-makeup-punch-reason`     | 補打卡原因     | 忘記打卡 `forgot-punch`、裝置故障 `device-failure`、其他                                                                                                                    | 補打卡申請                   |
| `schedule-day-off-override-reason` | 代改畫休原因   | 員工臨時告知 `staff-late-notice`、登記錯誤 `entry-error`、店務調整 `store-adjustment`、其他                                                                                 | 畫休截止後店長代改畫休       |
| `schedule-entry-reassign-reason`   | 改對應排班原因 | 開班時選錯排班 `wrong-entry-at-open`、臨時代班補排班後改對應 `cover-shift-reassign`、換班 `shift-swap`、其他                                                                | 打卡或收銀班次改對應排班     |
| `lottery-skip-correction-reason`   | 更正跳號原因   | 標註錯誤 `mark-error`、張號看錯 `misread-number`、其他                                                                                                                      | 更正已標註的跳號             |
| `schedule-special-day-category`    | 特殊日類別     | 國定假日 `national-holiday`、颱風假 `typhoon-day`、活動日 `event-day`、其他                                                                                                 | 行事曆                       |

「其他」的 value 都是 `other`。「預設」= 畫面上預先選好的選項,由使用它的功能以 `@repo/domain/project/lottery-fields` 的常數帶入(欄位管理沒有「預設選項」欄位)。

## 測試

`apps/db-migrator/seeds/project/field-categories.test.ts`:宣告逐列比對上表;value 格式與 `other`;正式 registry seed 落庫、重跑不增加且 id 不動。
