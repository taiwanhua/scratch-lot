/**
 * 出勤紀錄(`schedule.attendance`)前端的常數(權限表正本 `docs/modules/project/schedule.md`「出勤紀錄與補打卡」)。
 * 表單代號、欄位 key 與 api / seed 同一份(`@repo/domain/project/schedule-settings`)。
 */
export {
  MAKEUP_PUNCH_FIELD_KEYS,
  MAKEUP_PUNCH_FORM_KEY,
  MAKEUP_PUNCH_MODULE_KEY,
  MAKEUP_PUNCH_NO_ENTRY,
} from "@repo/domain/project/schedule-settings";

/** 出勤紀錄的權限 key(seed 正本 `apps/db-migrator/seeds/project/schedule.ts`)。 */
export const ATTENDANCE_PERMISSIONS = {
  view: "schedule.attendance.view",
  create: "schedule.attendance.create",
  viewAll: "schedule.attendance.view-all",
  export: "schedule.attendance.export",
  reassign: "schedule.attendance.reassign-punches",
} as const;

/**
 * 補打卡新增頁的帶入值放網址(REACT-14):`?date=YYYY-MM-DD&org=<分店>&type=in|out&entry=<排班 id>`
 * (我的班表的 [申請補卡]、出勤紀錄某一列的 [補打卡])。
 */
export const MAKEUP_PREFILL_KEYS = {
  date: "date",
  org: "org",
  type: "type",
  entry: "entry",
} as const;

/** 出勤紀錄頁的網址狀態 key。 */
export const ATTENDANCE_URL_KEYS = {
  /** 依人員(月)的月份 `YYYY-MM` */
  month: "month",
  /** 依人員(月)看的人 */
  person: "person",
  /** 依分店(日)的分店 */
  org: "org",
  /** 依分店(日)的日期 `YYYY-MM-DD` */
  date: "date",
  /** 只看未對應排班的打卡 */
  unmatched: "unmatched",
} as const;
