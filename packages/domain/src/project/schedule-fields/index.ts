/**
 * `@repo/domain/project/schedule-fields`:排班與出勤用到的欄位管理類別 key(專案規格第 13 章)。
 * 類別與預設選項由 `apps/db-migrator/seeds/project/field-categories.ts` 種下。
 * 排班是獨立模組:本主題不得 import 任何刮刮樂主題。
 */

/** 排班的欄位管理類別 key(值固定,各功能票照用)。 */
export const SCHEDULE_FIELD_CATEGORY_KEYS = {
  /** 崗位(人力需求、人力需求範本、收銀點、支援需求單;可帶顏色) */
  position: "schedule-position",
  /** 執行任務(人力需求的每筆執行任務) */
  task: "schedule-task",
  /** 排班異動原因(發布後排班異動) */
  changeReason: "schedule-change-reason",
  /** 補打卡原因(補打卡申請) */
  makeupPunchReason: "schedule-makeup-punch-reason",
  /** 代改畫休原因(畫休截止後店長代改畫休) */
  dayOffOverrideReason: "schedule-day-off-override-reason",
  /** 改對應排班原因(打卡或收銀班次改對應排班) */
  entryReassignReason: "schedule-entry-reassign-reason",
  /** 特殊日類別(行事曆) */
  specialDayCategory: "schedule-special-day-category",
} as const;
