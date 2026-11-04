# 刮刮樂設定(技術)

## 用途

分店層級的刮刮樂設定(張數店規格第 4 節、5.5、5.6):最上層組織給預設,區域、分店可以自訂;生效值沿組織樹往上找(分店 → 區域 → 最上層組織 → 程式預設)。做法照抄排班設定的「規則」分頁(`schedule_settings`、`RulesTab` / `RuleRow`),生效值解析是兩邊共用的 `@repo/domain/project/org-setting-chain`。

另管**分店實際的盤點制度**(`lottery_store_count_modes`):設定是「要哪一種」,分店那一筆是「現在是哪一種」(多一個轉換中)。改盤點制度時同一個交易重算下層分店。之後的銷售、盤點、全店重刷、補點編號、調貨、關帳一律經 `StoreCountModeService` 讀。

正本:`apps/db-migrator/seeds/project/lottery-settings.ts`、`packages/domain/src/project/lottery-settings/`

## 模組 key 與畫面

| key                | 名稱       | sidebarType | 路由                | 說明                                          |
| ------------------ | ---------- | ----------- | ------------------- | --------------------------------------------- |
| `lottery-settings` | 刮刮樂設定 | link        | `/lottery-settings` | 一頁一條設定一列(Figma CS-50a～h,`829:20485`) |

- 側欄 `order: 75`(檔案管理 70 之後、班表管理 80 之前),圖示 `tune`。沒有隱藏頁。
- 頁面 `?org=<組織 id>` 記住看的組織(關帳彈窗連進來帶入那家店)。

## 權限表

| 權限                            | 綁在                                     | 做什麼                                       |
| ------------------------------- | ---------------------------------------- | -------------------------------------------- |
| `lottery-settings.view`         | 頁面、查詢、盤點制度變更紀錄             | 看設定頁;寫入端點也守它(細分由 service 判斷) |
| `lottery-settings.edit-default` | 最上層組織的 [自訂] / [還原]             | 改各分店沿用的預設                           |
| `lottery-settings.edit-org`     | 區域、分店的 [自訂] / [還原]、[取消轉換] | 改最上層組織以外的組織                       |

- 分法同排班規則(`schedule.settings.edit-default-rules` / `edit-org-rules`):api 依組織是不是最上層組織決定要哪一條,算好 `canEdit` 給前端;沒有 → `FORBIDDEN` + reason `MISSING_PERMISSION`。
- 開通配方(`seeds/project/onboarding/role-grants/lottery-settings.ts`):總部管理全部(`lottery-settings.*`)、店長只給 `view`、店員不給。

正本:`packages/domain/src/project/lottery-settings/keys.ts`

## 資料

### `lottery_settings`

整張照抄 `schedule_settings`:`{ orgId, key, enabled, value, level, order }`,一列 = 某組織對某條設定的自訂。唯一 `(orgId, key)`(只算未刪除的);[還原] = 軟刪除;`sharing: inheritDown`(下層看得到上層鏈建的)。`value` 一律 `{ option }`;`enabled` 固定 true、`level` null、`order` 0。

| key                  | 名稱               | 選項                                                                            | 程式預設   |
| -------------------- | ------------------ | ------------------------------------------------------------------------------- | ---------- |
| `count_mode`         | 盤點制度           | `numbered` 編號盤點 / `count` 張數盤點                                          | `numbered` |
| `renumber_required`  | 張數店補點編號     | `remind` 只提醒 / `required` 必須(擋關帳)                                       | `remind`   |
| `renumber_reminder`  | 補點編號提醒       | `none` / `weekly` / `biweekly` / `monthly`                                      | `monthly`  |
| `transfer_grid_pick` | 調貨單可點格子選張 | `on` / `off`(只對編號店有效;`lotteryTransferOptions.gridPick`,見 purchasing.md) | `on`       |

### `lottery_store_count_modes`

分店實際的盤點制度,一店一筆(`orgId` 唯一、`version`、`moduleKey: store`,比照 `lottery_vault_locks`),**沒有筆或 `mode` 空 = 編號店**。

| 欄位                                        | 意思                                                                                                                                                                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`                                      | `numbered` / `count` / `converting`                                                                                                                                                                                                                       |
| `since`                                     | 進入現在制度的時間                                                                                                                                                                                                                                        |
| `lastRenumberAt`、`lastRenumberStocktakeId` | 上次補點編號核准(`applyRenumberApproval` 寫)                                                                                                                                                                                                              |
| `history[]`                                 | `{ from, to, at, by, cause, stocktakeId }`,`cause` = `setting` / `renumber_approved` / `convert_cancelled`;只加不改                                                                                                                                       |
| `movePauses[]`                              | 進行中的全店重刷(`gameId`)或補點編號(`gameId: null`);全店重刷寫(`addRescanPause` / `removeRescanPause`,1 小時沒動作 `releaseExpiredRescans` 自動取消);補點編號跟著它的盤點中登記寫(`writeSessions`;登記的 `renumberPauseId`),登記有效才算(`livePausesOf`) |
| `stocktakeSessions[]`                       | 盤點中登記 `{ sessionId, type, cashPointIds, by, startedAt, lastActiveAt, draft, endedAt, endedBy }`(T4 寫;規則見 `store.md`「張數盤點與盤點中登記」)                                                                                                     |
| `version`                                   | 改制度、開始 / 結束重刷、移櫃、登記 / 解除盤點中都 `$inc`(讓彼此一定有先後)                                                                                                                                                                               |

正本:`apps/api/src/project/database/lottery-settings/*.schema.ts`

## 規則

### 生效值

每條設定各自沿組織鏈找第一個有自訂的組織,找不到用程式預設(`resolveLotterySettings`)。本層自訂時另回上層的生效值(畫面的「上層:…」)。來源:`own` 本店自訂(最上層組織寫「本層自訂」)、`inherited` 沿用(看不到上層時不露出名稱,寫「沿用上層設定」)、`default` 程式預設。

### 改盤點制度(9.1、9.2)

在任何一層 [自訂] / [還原] `count_mode` 都一樣:先算出子樹裡**生效設定會變**的分店(自己有自訂的不跟著改),每家各自依 `countModeOf` 決定實際制度:

- 改張數 → `count`,當下生效
- 改編號 → 本來就是編號照舊;還有未對號張 → `converting`(轉換中),沒有 → 直接 `numbered`

有任何一家被擋,**整筆不存**(`VALIDATION_FAILED` + reason `COUNT_MODE_CHANGE_BLOCKED`,`extensions.check` 附明細):

- `pending_skip`:從編號改成張數,而這家店檯面上還有待標註的本(條件沿用庫存分頁「有待標註」篩選;7.5 的原因)
- `busy`:這家店有效的盤點中登記(最後一次操作 1 小時內)、全店重刷或補點編號還沒結束;兩個方向都擋

沒被擋就在同一個交易寫:設定那一列、各分店那一筆(已有的一次批次更新 `$set mode/since` + `$push history` + `$inc version`,還沒有的一次批次新增)、稽核。查詢次數固定、不逐店:組織樹 1、整個租戶的 `count_mode` 自訂 1、分店那一筆 1、未對號張數 1 次 aggregate、檯面待標註的本 1 + 收銀點 1 次 aggregate。子樹裡的分店不一定在操作者的可見範圍,這些讀寫以租戶邊界做(`PROJECT_TENANT_BOUNDARY_CONTEXT_CALLERS`,用途「反查」「系統重算」)。

**目前的來源**:`stocktakeSessions` 由盤點中登記寫(T4;`StoreCountModeService.sessionRecordOf` / `writeSessions`,店長結束的不算進行中);`movePauses` 由全店重刷(見 `store.md`「全店重刷、提醒與移櫃暫停」)寫入;補點編號的 `gameId: null` 跟著補點的盤點中登記寫,登記失效、送出後不算(審核中的補點不擋 [取消轉換],張數店規格 9.3 第 5 點)。檢查本身已讀這兩個欄位(`StoreCountModeService.busyOf` → `storeBusyOf`),之後的票只要寫進同一筆就生效。

### [取消轉換](9.2)

只有轉換中的分店:等於幫這家店自訂 `count_mode = count`(之後上層預設再改也不跟著動,要 [還原] 才恢復沿用),實際制度 `converting → count`,歷程 `cause: convert_cancelled`。有進行中的工作時一樣擋。

### 給其他模組的介面(`StoreCountModeService`,`LotterySettingsModule` 匯出)

| 方法                                                                                                   | 回                                                                                                                  |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `modeOf(operator, orgId)` / `modesOf`                                                                  | 分店實際的盤點制度(沒有筆 = `numbered`)                                                                             |
| `settingOf(operator, orgId, key)`                                                                      | 分店某一條設定的生效選項                                                                                            |
| `movePauseOf(operator, orgId, now)`                                                                    | 進行中的全店重刷 / 補點編號(移櫃暫停;補點編號只算登記還有效的)                                                      |
| `guardMove` / `addRescanPause` / `removeRescanPause` / `touchForRescanPlace` / `releaseExpiredRescans` | 移櫃前的檢查與先後、開始 / 結束重刷、重刷「開始刷這個位置」、1 小時沒動作的重刷自動取消(都在交易內、`$inc version`) |
| `guardMove(operator, store, gameIds, session)`                                                         | 移櫃交易內:擋到的暫停(`MovePauseBlock`);沒擋 → 分店那一筆 `version` +1(8.5 先後)                                    |
| `recordOf` / `busyOf` / `historyOf`                                                                    | 分店那一筆、進行中的工作、歷程                                                                                      |
| `planCountModeChange` / `applyCountModeChange`                                                         | 改盤點制度的計畫與寫入                                                                                              |
| `applyRenumberApproval(writer, orgId, approval, session)`                                              | 補點編號核准:上次補點、轉換中 → 編號、歷程 `renumber_approved`(沒改制度時 from = to)、稽核                          |
| `storesOf(operator, tenantId, orgIds, keys)` / `renumberReminderOf` / `countStoreIdsOf`                | 多家分店的設定生效值與那一筆(關帳第四項、補點編號提醒;一次讀)、看板 / 日結的補點編號提醒、張數店清單                |

## api 介面

| 名稱                                      | 類型     | 守門                  | 說明                                                                                                                       |
| ----------------------------------------- | -------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `lotterySettings(input?)`                 | query    | `view`                | `input.orgId` 缺席或 null = 當前組織;回整份設定、`canEdit`、`isStore`、分店的 `storeCountMode`                             |
| `lotteryCountModeChangeCheck(input)`      | query    | `view`                | 改盤點制度前的檢查:`option` 給值 = 本層自訂成它,缺席或 null = [還原];回會跟著改的分店、待標註的本、進行中的分店、`canSave` |
| `lotteryStoreCountModeHistory(input)`     | query    | `view`                | 分店的盤點制度歷程(新到舊)                                                                                                 |
| `customizeLotterySetting(input)`          | mutation | `view` + service 細分 | `{ orgId?, key, option }`;本層寫一列                                                                                       |
| `restoreLotterySetting(input)`            | mutation | 同上                  | `{ orgId?, key }`;刪掉本層的自訂                                                                                           |
| `cancelLotteryCountModeConversion(input)` | mutation | 同上                  | `{ orgId }`;只有轉換中的分店                                                                                               |

mutation 一律回 `{ settings }`(整份設定)。

正本:`apps/api/src/project/lottery/settings/`、`packages/graphql/src/documents/project/lottery/lottery-settings.graphql`

## admin 頁面

`pages/project/lottery/settings/`:`LotterySettingsPage`(分店選擇器 + 一條設定一列)、`SettingRow`(名稱 | 值 | 來源 | [變更紀錄] | [自訂] / [還原] / [取消轉換];手機名稱一行、下方灰字「值 · 來源」)、`SettingDialog`(選項各附說明;盤點制度選了不同的值就呼叫檢查,寫出後果、列出會跟著改的分店與被擋的原因,被擋時 [儲存] 停用;張數店補點編號從必須改成只提醒時寫出關帳的影響)、`CancelConversionDialog`、`CountModeHistoryDialog`。畫面文字一律寫「系統預設帶入」,不寫「猜」。

## 錯誤碼

| code                | reason                         | 何時                                                              |
| ------------------- | ------------------------------ | ----------------------------------------------------------------- |
| `FORBIDDEN`         | `MISSING_PERMISSION`           | 沒有這個組織要的 `edit-default` / `edit-org`                      |
| `NOT_FOUND`         | —                              | 組織不在可見範圍                                                  |
| `VALIDATION_FAILED` | —                              | 不認得的 key(`fields: ["key"]`)、不是那條設定的選項(`["option"]`) |
| `VALIDATION_FAILED` | `COUNT_MODE_CHANGE_BLOCKED`    | 改盤點制度被擋(`extensions.check` 附明細)                         |
| `VALIDATION_FAILED` | `NOT_CONVERTING` / `NOT_STORE` | [取消轉換] 的分店不是轉換中 / 不是分店                            |
| `VALIDATION_FAILED` | `CONCURRENT_EDIT`              | 同時第一次自訂同一條                                              |

## 稽核

- `lottery-setting.customize` / `lottery-setting.restore`,`targetType: lottery_setting`,`before` / `after` 放 key 與值
- `lottery-store-count-mode.change`,`targetType: lottery_store_count_mode`,`targetId` = 分店,`before: { mode }`、`after: { mode, cause }`(每家跟著改的分店一筆,一次寫)

## 測試

- `packages/domain/src/project/lottery-settings/lottery-settings.test.ts`:定義、生效值(SET1)、改盤點制度的跟著改與擋下(SW1、9.1)、進行中的工作與 1 小時失效
- `packages/domain/src/project/org-setting-chain/org-setting-chain.test.ts`:共用的鏈解析
- `apps/api/src/project/lottery/settings/lottery-settings.test.ts`(TEST-07):SET1 繼承、[自訂] / [還原]、店長只能看、權限分法、稽核;SET2 上層改預設的檢查與同一個交易重算(指令數不隨分店數成長);SET3 預設開、關掉後分店讀到關;SW1;SW3 [取消轉換] 與之後不跟預設、[變更紀錄];9.1 待標註、盤點中登記(含 1 小時失效)、重刷、補點擋下
- `apps/admin/src/pages/project/lottery/settings/LotterySettingsPage/LotterySettingsPage.test.tsx`(TEST-08):CS-50a～h 的權限驅動渲染與對話框
- `apps/db-migrator/seeds/project/lottery-settings.test.ts`:模組宣告、權限、開通配方

## 使用者說明(help.md)

`apps/admin/src/md/module-help/project/additions/lottery-settings.help.md`:兩種制度怎麼選、切換後果、補點週期。

## 平台視角備註

無(租戶內的設定;根組織站著時頁面只顯示「請先切換到要管理的機構」)。
