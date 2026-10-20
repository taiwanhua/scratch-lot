/**
 * `@repo/domain/project/schedule-settings` 的出口檔(bunchee 由 `exports` 名反推本檔)。
 * 排班是獨立模組:本主題不得 import 任何刮刮樂主題。
 *
 * - `rules.ts`:排班規則與自動排班條件的定義、值的驗證(規格 14.2;正本 `docs/modules/project/schedule.md`)
 * - `settings.ts`:職責、僱用類型、行事曆類型等程式固定值與筆數上限(規格 13、14.1、14.4)
 * - `time.ts`:`HH:mm`、`YYYY-MM-DD`、`YYYY-MM` 的判斷
 */
export * from "./rules";
export * from "./settings";
export * from "./time";
