/**
 * `@repo/domain/project/schedule-settings` 的出口檔(bunchee 由 `exports` 名反推本檔)。
 * 排班是獨立模組:本主題不得 import 任何刮刮樂主題。
 *
 * - `rules.ts`:排班規則與自動排班條件的定義、值的驗證(規格 14.2;正本 `docs/modules/project/schedule.md`)
 * - `settings.ts`:職責、僱用類型、行事曆類型、畫休種類等程式固定值與筆數上限(規格 13、14.1、14.4)
 * - `time.ts`:`YYYY-MM-DD`、`YYYY-MM` 的判斷;`HH:mm` 的判斷轉出 `@repo/domain/form`
 * - `attendance.ts`:出勤紀錄的遲到 / 早退 / 工時與補打卡申請的表單代號、欄位 key(規格 14.7、14.8)
 * - `day-off.ts`:時段不可排的幾段有沒有蓋滿整天(規格 14.6;admin 與 api 共用)
 * - `roster.ts`:排班表的預設休息、自動填執行任務、負責人時間涵蓋、統計欄(規格 14.5)
 */
export * from "./attendance";
export * from "./day-off";
export * from "./roster";
export * from "./rules";
export * from "./settings";
export * from "./time";
