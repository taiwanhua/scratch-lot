# 專案通知類型(刮刮樂、排班與出勤)

本專案登記的通知類型。登記處是 `apps/api/src/project/notifications.ts`(`PROJECT_NOTIFICATIONS`,經底座 `NotificationRegistryModule.forRoot` 組裝);類型宣告的欄位、通知設定頁與 `notify()` 的用法照底座 [notification-settings.md](../notification-settings.md),這裡只寫本專案的類型。內容來源:專案規格 3.4。

- **負責人提醒**的收件人 = 類型宣告的組織範圍 且 符合人員條件;租戶可在通知設定頁改人員條件(組織範圍不能改)。**當事人通知**的收件人由觸發的功能在 `notify()` 指定。
- 管道:十二種都是站內 + email,收件人可在個人偏好逐一關掉。
- 下表「提醒時間」欄是規格 3.5 的預設值。已宣告可調時間的:畫休開放、畫休即將截止(排程在班表管理,`docs/modules/project/schedule.md`「畫休開放 / 即將截止通知」);其他類型由各自的提醒功能宣告。通知設定頁列出底座的負責人提醒、本專案的五種負責人提醒,以及宣告了可調時間的當事人通知(畫休開放、畫休即將截止,收件人唯讀「由事件決定」);其他當事人通知(進貨 / 調貨送錯分店、排班發布、排班異動、畫休被代改)不列,只在收件人的個人偏好有開關,開通也不設定它們的收件人。
- 連結(`links`):`lottery-purchase` → `/purchasing/purchase/view-page/{refId}`(進貨送錯分店的通知點進去是那張進貨單);`lottery-transfer` → `/purchasing/transfer/view-page/{refId}`(調貨送錯分店的通知點進去是那張調貨單);其他類型沒有連結。

## 類型

| key                            | 名稱         | 類別       | 組織範圍                                                | 預設人員條件 / 收件人                   | 觸發(功能)                                           | 提醒時間(規格 3.5 預設值)  |
| ------------------------------ | ------------ | ---------- | ------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------- | -------------------------- |
| `lottery.daily-close-overdue`  | 日結逾期     | 負責人提醒 | 事件的組織本身(該分店)                                  | 持有 `store.bank-deposit`(代表店長,註1) | B14:有已送出交班結帳的班還沒被日結涵蓋計算(店面管理) | 逾期後每天 09:00           |
| `lottery.transfer-shipped`     | 調貨出貨通知 | 負責人提醒 | 事件的組織本身(收貨店)                                  | 持有 `store.bank-deposit`(註1)          | 調貨單第一關通過,含跳過(調貨單)                      | —(發生時)                  |
| `lottery.license-expiring`     | 證照到期     | 負責人提醒 | 事件的組織含上層(乙類:對應分店;甲類或沒有對應分店:租戶) | 持有 `store.bank-deposit`(註1)          | B14:到期日(經銷商管理)                               | 到期日前 30、7、0 天 09:00 |
| `lottery.store-rent-due`       | 牌租繳費提醒 | 負責人提醒 | 事件的組織含上層(乙類對應分店;沒有對應分店:租戶)        | 持有 `store.bank-deposit`(註1)          | B14:每期繳費日(經銷商管理)                           | 繳費日前 3、0 天 09:00     |
| `lottery.period-close-overdue` | 關帳逾期     | 負責人提醒 | 租戶本身                                                | 持有 `accounts.close-period`            | B14:上個月還沒關帳(帳戶管理)                         | 每月第 3 天 09:00          |
| `lottery.purchase-wrong-store` | 進貨送錯分店 | 當事人通知 | —                                                       | 這張進貨單的建立者                      | 刷到的分店按 [通知總部更正](進貨單)                  | —(發生時)                  |
| `lottery.transfer-wrong-store` | 調貨送錯分店 | 當事人通知 | —                                                       | 這張調貨單的建立者                      | 刷到的收貨分店按 [通知總部更正](調貨單)              | —(發生時)                  |
| `schedule.day-off-open`        | 畫休開放     | 當事人通知 | —                                                       | 可以排這家店的排班人員                  | B14:排班規則「畫休開放期間」的開放日(班表管理)       | 開放日前 0 天 09:00(當天)  |
| `schedule.day-off-closing`     | 畫休即將截止 | 當事人通知 | —                                                       | 可以排這家店的排班人員                  | B14:排班規則「畫休開放期間」的截止日(班表管理)       | 截止日前 1 天 09:00        |
| `schedule.published`           | 排班發布     | 當事人通知 | —                                                       | 被排到的人                              | 發布(排班作業)                                       | —(發生時)                  |
| `schedule.changed`             | 排班異動     | 當事人通知 | —                                                       | 異動牽涉的人                            | 發布後的異動(排班作業)                               | —(發生時)                  |
| `schedule.day-off-overridden`  | 畫休被代改   | 當事人通知 | —                                                       | 被代改的員工本人(代改自己不送)          | 代改畫休儲存(一次送出一則)/ 代改刪除畫休(排班作業)   | —(發生時)                  |

註1:規格寫「角色 店長」。店長是開通時替每個租戶建立的一般角色(規格 3.3),類型宣告寫不了各租戶的角色 id,所以預設用店長才有的 `store.bank-deposit`(店員沒有;總部管理以 `*` 也有)。租戶要改成「角色 店長」時在通知設定頁調整。

## 範本參數

呼叫 `notify()` 時給的 `params`(值一律字串,沒有就 `null`;日期、金額由呼叫端先格式化)。

| key                            | 參數                                                                                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lottery.daily-close-overdue`  | `orgName`(分店名)、`since`(最早一張還沒被涵蓋的交班結帳送出日)                                                                                                                                                                                         |
| `lottery.transfer-shipped`     | `subject`(調貨單的顯示名稱)、`fromOrgName`(出貨店)                                                                                                                                                                                                     |
| `lottery.license-expiring`     | `dealerType`(甲類 / 乙類)、`dealerName`、`expiresOn`(到期日)、`daysLeft`(剩幾天,`0` = 當天)                                                                                                                                                            |
| `lottery.store-rent-due`       | `dealerName`、`dueOn`(繳費日)、`amount`(選填)                                                                                                                                                                                                          |
| `lottery.period-close-overdue` | `period`(月份,例 `2026-09`)                                                                                                                                                                                                                            |
| `lottery.purchase-wrong-store` | `subject`(進貨單的顯示名稱)、`orgName`(刷到的分店)                                                                                                                                                                                                     |
| `lottery.transfer-wrong-store` | `subject`(調貨單的顯示名稱)、`orgName`(刷到的分店)                                                                                                                                                                                                     |
| `schedule.day-off-open`        | `orgName`、`month`(畫休的月份 `YYYY-MM`)、`opensOn`(開放日)、`closesOn`(截止日)                                                                                                                                                                        |
| `schedule.day-off-closing`     | `orgName`、`month`、`opensOn`、`closesOn`                                                                                                                                                                                                              |
| `schedule.published`           | `orgName`、`month`                                                                                                                                                                                                                                     |
| `schedule.changed`             | `orgName`、`date`(異動的日期)、`reason`(選填,排班異動原因)                                                                                                                                                                                             |
| `schedule.day-off-overridden`  | `action`(`add` 登記 / `delete` 刪除)、`orgName`(總覽選的那家店)、`date`(畫休那天)、`kind`(`full-day` / `time-range`)、`slots`(時段 `HH:mm–HH:mm` 以 `,` 串起,整天畫休為空)、`byName`(代改人)、`reason`(選填,代改畫休原因的顯示名稱;有說明時接在括號裡) |

## 測試

`apps/api/src/project/notifications.test.ts`:十二種逐列比對上表的 key、名稱、類別、組織範圍與預設人員條件;與底座合成合法;通知設定頁列出的負責人提醒;範本兩種語系都有、缺參數也不空白;畫休被代改的登記 / 刪除兩種說法。觸發端的測試見 `docs/modules/project/schedule.md`「測試」。
