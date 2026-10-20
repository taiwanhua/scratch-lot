# 欄位管理:本專案的系統類別

底座「欄位管理」(`docs/modules/field-manager.md`)在本專案多種下的系統類別與全域選項。種子在 `apps/db-migrator/seeds/project/field-categories.ts`(形狀與認養規則同底座 `seeds/base/field-categories.ts`、`fields.ts`);類別 key 與程式要認得的選項代碼在 `@repo/domain/project/lottery-fields`、`@repo/domain/project/schedule-fields`。內容來源:專案規格第 13 章。

- 選項 value 一律英文 kebab-case;「其他」一律 `other`,選它時說明必填,全系統一致(`@repo/domain/project/reason-note` 的 `requiresReasonNote`)。
- 選項依表中順序 1 起算(`order`);租戶可以再自己加選項。
- 崗位的三個全域選項有初始顏色:店內櫃台 = blue、店外攤位 = green、補貨 = orange(專案 seed `projectFieldOptionColors`,見下方「選項顏色」);其餘選項沒有初始顏色。示範租戶另加的崗位(櫃台 A、櫃台 B、彩券機旁)放示範資料,不是系統選項。
- 不放欄位管理(程式依值做事):銀行交易類型、現金流水類型、張的狀態 / 位置、經銷商類型與狀態、關係人身分、職責、行事曆類型。

## 類別與預設選項

| 類別 key                           | 名稱           | 選項(value)                                                                                                                                                                 | 用在                         |
| ---------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `lottery-sale-reversal-reason`     | 撤銷售出原因   | 客人退貨 `customer-return`、刷錯刮刮樂 `wrong-ticket`、盤點錯誤 `stocktake-error`、其他                                                                                     | 撤銷售出申請                 |
| `lottery-redemption-revoke-reason` | 撤銷兌獎原因   | 登記錯誤 `entry-error`、金額錯誤 `wrong-amount`、其他                                                                                                                       | 撤銷兌獎(已結帳或別人登記)   |
| `lottery-manual-sale-reason`       | 手動標記原因   | 刷不到條碼 `scan-failed`(預設)、系統異常補登 `system-backfill`、其他                                                                                                        | 手動標記售出                 |
| `lottery-cash-correction-reason`   | 現金更正原因   | 員工賠補 `staff-compensation`、客人補付 `customer-top-up`、尋回 `recovered`、退還客人 `customer-refund`、遺失 `lost`、假鈔 `counterfeit`、存款短少 `deposit-shortage`、其他 | 現金更正單                   |
| `lottery-void-reason`              | 作廢原因       | 輸入錯誤 `input-error`、重複建立 `duplicate`、交易取消 `transaction-cancelled`、其他                                                                                        | 所有單據作廢                 |
| `lottery-checkout-diff-reason`     | 結帳差額原因   | 找錯錢 `wrong-change`、兌獎誤付 `redemption-overpaid`、審核中的單據 `pending-documents`、其他                                                                               | 結帳精靈、日結               |
| `lottery-skip-stocktake-reason`    | 跳過盤點原因   | 人力不足 `short-staffed`、系統異常 `system-error`、其他                                                                                                                     | 結帳精靈、日結               |
| `lottery-withdraw-reason`          | 出庫原因       | 開班零用金 `opening-float`、補零錢 `change-refill`、其他                                                                                                                    | 出庫                         |
| `lottery-lost-reason`              | 遺失原因       | 調貨途中遺失 `lost-in-transfer`、店內遺失 `lost-in-store`、原因不明 `unknown`、其他                                                                                         | 確認遺失                     |
| `lottery-recover-reason`           | 尋回原因       | 盤點找到 `found-in-stocktake`、調貨送錯 `transfer-misdelivered`、其他                                                                                                       | 尋回                         |
| `lottery-scrap-reason`             | 報廢原因       | 破損 `damaged`、污損 `soiled`、其他                                                                                                                                         | 報廢                         |
| `schedule-position`                | 崗位           | 店內櫃台 `in-store-counter`、店外攤位 `outdoor-stall`、補貨 `restock`                                                                                                       | 人力需求、收銀點、支援需求單 |
| `schedule-task`                    | 執行任務       | 店內事務與帳目負責 `store-and-accounts-lead`、店內事務 `store-duties`                                                                                                       | 人力需求的每筆執行任務       |
| `schedule-change-reason`           | 排班異動原因   | 臨時請假 `emergency-leave`、換班 `shift-swap`、病假 `sick-leave`、其他                                                                                                      | 發布後排班異動               |
| `schedule-makeup-punch-reason`     | 補打卡原因     | 忘記打卡 `forgot-punch`、裝置故障 `device-failure`、其他                                                                                                                    | 補打卡申請                   |
| `schedule-day-off-override-reason` | 代改畫休原因   | 員工臨時告知 `staff-late-notice`、登記錯誤 `entry-error`、店務調整 `store-adjustment`、其他                                                                                 | 畫休截止後店長代改畫休       |
| `schedule-entry-reassign-reason`   | 改對應排班原因 | 開班時選錯排班 `wrong-entry-at-open`、臨時代班補排班後改對應 `cover-shift-reassign`、換班 `shift-swap`、其他                                                                | 打卡或收銀班次改對應排班     |
| `lottery-skip-correction-reason`   | 更正跳號原因   | 標註錯誤 `mark-error`、張號看錯 `misread-number`、其他                                                                                                                      | 更正已標註的跳號             |
| `schedule-special-day-category`    | 特殊日類別     | 國定假日 `national-holiday`、颱風假 `typhoon-day`、活動日 `event-day`、其他                                                                                                 | 行事曆                       |

「其他」的 value 都是 `other`。「預設」= 畫面上預先選好的選項,由使用它的功能以 `@repo/domain/project/lottery-fields` 的常數帶入(欄位管理沒有「預設選項」欄位)。

## 選項顏色

S2 專案客製(規格 18.5):每個選項可以設一個標籤色票代號,欄位管理頁多一欄「顏色」。色票的值與登記見 [branding.md](../../project/branding.md)「標籤色票」;升格後是底座 `fields.color`,這裡的表、替換頁與說明都拆掉。

### 規則

- **只能從色票選**:十個代號(`@repo/domain/project/tag-palette` 的 `TAG_PALETTE_KEYS`),不在清單(含色碼、大小寫不同)→ `VALIDATION_FAILED`(`extensions.fields = ["paletteKey"]`)。
- **誰能設 = 誰能停用該選項**(底座 `canToggleFieldEnabled`)+ `system.field-manager.edit`:自訂選項限加它的那一層;全域種子限根組織(顏色對全平台生效)。每個選項只有一個擁有者,所以最多一筆顏色。
- 存在 `project_field_option_colors`:`orgId` = 設定顏色的組織、`tenantId` 由它推導(根組織 = null)、唯一 `(tenantId, fieldId)`;第一次設定建一筆,之後更新同一筆。
- `paletteKey` 為 null = 不設定(清除顏色只把它設成 null,不刪資料)。
- 全域選項的初始顏色由專案 seed 種下(`apps/db-migrator/seeds/project/field-categories.ts` 的 `projectFieldOptionColors`:`orgId` = 根組織、`tenantId` = null、`key` = 選項的 key、`isSystem: true`)。`paletteKey` 是初始 seed 值:只在那個選項還沒有顏色時寫入,平台管理員之後改過(含清成不設定)重跑 seed 不覆蓋;seed 之前就設過的那一筆以 `fieldId` 認養,顏色保留。
- 審計:`field.set-color`(`targetType = field`、`targetId` = 選項 id,before / after 記 `paletteKey`)。

### api 介面

```graphql
fieldOptionColors(categoryKey: String!): FieldOptionColorsPayload!          # 只要登入(顯示選項的頁面都要用)
setFieldOptionColor(input: SetFieldOptionColorInput!): FieldOptionColorPayload! # system.field-manager.edit
```

- `fieldOptionColors`:該類別合併清單(可見範圍同底座 `fields`)裡**有顏色**的選項 `{ fieldId, value, paletteKey }`;類別 key 不存在 → `NOT_FOUND`。
- `SetFieldOptionColorInput { fieldId: ID!, paletteKey: String }`:`paletteKey` 缺席 / null = 清除。
- 錯誤碼:`VALIDATION_FAILED`(代號不在色票、`fieldId` 格式不對)、`NOT_FOUND`(看不到的選項)、`FORBIDDEN` + `reason`:`SEED_GLOBAL_SWITCH`(租戶設全域選項)/ `NOT_OWNER`(別的組織加的選項)。

正本:`apps/api/src/project/field-option-colors/`、`apps/api/src/project/database/field-option-colors/`

### admin 頁面與元件

- 客製替換:`apps/admin/src/app/project/page-replacements.ts` 把 `system.field-manager` 換成 `pages/project/system/FieldManagerWithColorPage/`(以 `components/base/FieldManager/` 組成,經 `extraOptionColumns` 在「顯示名稱」後加「顏色」欄;Figma BS-13 289:87534)。拿掉那一筆就回到底座原頁。
- 格子:改得動 → 色票標籤本身可點(沒有顏色時是「不設定」按鈕),開「選擇顏色」面板(兩列各 5 個 + 「不設定」);改不動 → 只顯示標籤,沒有顏色顯示「不設定」文字。
- 共用元件:`components/project/TagPaletteChip/`(一個代號的標籤)、`components/project/TagPaletteSelect/`(標籤 + 色票面板)。
- 其他頁面顯示選項顏色一律經 `hooks/project/useFieldOptionColors.ts`(不直接呼叫 query):有選項 id 用 `byFieldId`;只有 `value` 時用 `byValue`(同 value 兩筆顏色不同時不給)。
- 說明:`apps/admin/src/md/module-help/project/replacements/system.field-manager.help.md`。
- 測試:api `field-option-colors.test.ts`;admin `FieldManagerWithColorPage.test.tsx`、`app/project/page-replacements.test.ts`、`app/project/FieldManagerReplacementRemoved.test.tsx`、`TagPaletteSelect.test.tsx`、`lib/project/tag-palettes.test.ts`(20 組對比 ≥ 4.5)、`lib/project/field-option-colors.test.ts`。

## 測試

`apps/db-migrator/seeds/project/field-categories.test.ts`:宣告逐列比對上表;value 格式與 `other`;正式 registry seed 落庫、重跑不增加且 id 不動。
