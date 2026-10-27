# api 的專案來源

本目錄是本專案(scratch-lot)在 api 的程式;固定登記入口(`api-modules.ts`、`notifications.ts`、`database/registrations.ts`、`lookup-providers.ts`、`form-lifecycles.ts`、`realtime-boards.ts`、`user-preferences.ts`)由底座的組裝入口讀進來,新功能只追加自己的登記。專案與底座的分工見 `docs/project/README.md`、`docs/project-initialization.md`。

## 目錄約定

| 內容                   | 位置                                                         | 備註                                                                                                                |
| ---------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 刮刮樂的功能           | `project/lottery/<功能>/`(例 `lottery/store/`)               | 一個功能一個資料夾(resolver、service、測試放一起)                                                                   |
| 排班與出勤的功能       | `project/schedule/<功能>/`                                   | **不得 import 任何刮刮樂路徑**(依賴方向:刮刮樂 → 排班;`project-lint.test.ts` 守)                                    |
| 專案資料的 schema      | `project/database/`                                          | 表名前綴:刮刮樂 `lottery_`、排班 `schedule_`;登記在 `database/registrations.ts`,地圖在 `docs/project/data-model.md` |
| 通知類型               | `project/notifications.ts`                                   | 類型清單與範本參數見 `docs/modules/project/lottery-notifications.md`                                                |
| GraphQL documents      | `packages/graphql/src/documents/project/{lottery,schedule}/` | operation 名稱全域唯一                                                                                              |
| 前後端共用的專案純邏輯 | `packages/domain/src/project/<主題>/`                        | 刮刮樂的主題用 `lottery-` 開頭、排班的用 `schedule-` 開頭,兩邊共用的(例 `reason-note`)不帶前綴                      |

- **根組織**:專案 resolver 類別一律標 `@RequireTenant()`(`tenant-scope/`):站在根組織(不屬於任何機構)→ `FORBIDDEN` + reason `TENANT_ONLY`(沿用底座通知設定等的原因碼),要看某個機構的資料先切進那個機構(ADR-0014、Spec #143 定案 8)。根組織也會讀的端點(欄位選項、選項顏色)不標;admin 端由 `app/project/module-pages.ts` 的 `gateTenant` 先顯示提示。
- lookup 來源 key 同樣加前綴(`lottery_…`、`schedule_…`,格式照 `PROJECT_LOOKUP_KEY_PATTERN`)。
- 排班要顯示刮刮樂的資料(例:排班表上的收銀點名稱)時,由排班開登記介面、刮刮樂登記進去;排班這邊不知道刮刮樂存在。
