import { GraphQLError } from "graphql";

/**
 * 排班的業務錯誤(GQL-04):只用通用碼 `FORBIDDEN` / `NOT_FOUND` / `VALIDATION_FAILED`,不新增 code。
 * message 給開發者看(英文);使用者文案由前端依 code(與 `reason`)對應。
 */

/** 查的資料在操作者看得到的範圍內不存在(列表與單筆同一個答案)。 */
export function notFoundError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

/**
 * `VALIDATION_FAILED` 的細分原因(`extensions.reason`;模組文件「錯誤碼」):衝突、重複、狀態不合這類
 * 「格式對但不能存」的情形帶原因,前端寫在欄位下(REACT-18)。沒有原因 = 格式錯或必填(前端寫那一欄的格式要求)。
 */
export const SCHEDULE_REASONS = {
  /** 這家店這一天已經有行事曆 */
  calendarDayDuplicate: "CALENDAR_DAY_DUPLICATE",
  /** 這一天已經有整天的畫休 */
  dayOffDuplicate: "DAY_OFF_DUPLICATE",
  /** 畫休的時段互相重疊(含同一天已有的時段) */
  timeRangesOverlap: "TIME_RANGES_OVERLAP",
  /** 這個人沒有主要分店(排班檔案沒設主要分店) */
  noPrimaryStore: "NO_PRIMARY_STORE",
  /** 已經有人填進的人力需求不能改到別天 */
  demandHasAssignments: "DEMAND_HAS_ASSIGNMENTS",
  /** 這個人不在這家店的排班名單 */
  notCandidate: "NOT_CANDIDATE",
  /** 排班的日子有店休 */
  storeClosed: "STORE_CLOSED",
  /** 和這個人的另一筆排班時間重疊 */
  entryOverlap: "ENTRY_OVERLAP",
  /** 和這個人的畫休重疊 */
  dayOffConflict: "DAY_OFF_CONFLICT",
  /** 選的打卡紀錄不存在或已經對應到別的排班 */
  punchUnavailable: "PUNCH_UNAVAILABLE",
  /** 選的任務不是這一天的人力需求 */
  taskNotOnDay: "TASK_NOT_ON_DAY",
  /** 這個人不能擔任負責人 */
  cannotLead: "CANNOT_LEAD",
  /** 任務已經由別筆排班填了 */
  taskTaken: "TASK_TAKEN",
  /** 同一筆人力需求在一筆排班裡選了兩個任務 */
  demandRepeated: "DEMAND_REPEATED",
  /** 已存在的任務不能改角色 */
  taskRoleLocked: "TASK_ROLE_LOCKED",
  /** 已經加入排班名單 */
  alreadyJoined: "ALREADY_JOINED",
  /** 同一家分店列了兩次 */
  orgRepeated: "ORG_REPEATED",
  /** 主要分店要剛好一家 */
  primaryOrgRequired: "PRIMARY_ORG_REQUIRED",
  /** 選的選項已停用或不存在(欄位管理) */
  optionDisabled: "OPTION_DISABLED",
  /** 這條規則不能關閉 */
  ruleNotToggleable: "RULE_NOT_TOGGLEABLE",
  /** 這筆排班現在不能打這種卡 */
  punchNotAllowed: "PUNCH_NOT_ALLOWED",
  /** 選的資料(排班、範本、週範本)不存在或看不到(已被刪除、不在可見範圍) */
  referenceNotFound: "REFERENCE_NOT_FOUND",
  /** 別人同時改了同一筆(重新整理後再試) */
  concurrentEdit: "CONCURRENT_EDIT",
} as const;

export type ScheduleReason =
  (typeof SCHEDULE_REASONS)[keyof typeof SCHEDULE_REASONS];

/** 輸入不合法;`extensions.fields` 讓前端把錯誤標回表單欄位,`reason` 選填(衝突類才有)。 */
export function validationError(
  message: string,
  fields: string[],
  reason?: ScheduleReason,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: {
      code: "VALIDATION_FAILED",
      fields,
      ...(reason === undefined ? {} : { reason }),
    },
  });
}

/**
 * `FORBIDDEN` 的細分原因(`extensions.reason`):
 * - `NOT_OWNER`:看得到、但不是這一層建立的(範本 / 週範本 / 行事曆只有建立它的那一層能改)
 * - `MISSING_PERMISSION`:這個組織要的權限沒有(規則:最上層組織要 `edit-default-rules`、其他要 `edit-org-rules`)
 * - `OUTSIDE_DAY_OFF_WINDOW`:本人在畫休開放期間外登記 / 刪除(要調整請代改)
 */
export type ScheduleForbiddenReason =
  "NOT_OWNER" | "MISSING_PERMISSION" | "OUTSIDE_DAY_OFF_WINDOW";

export function forbiddenError(
  message: string,
  reason: ScheduleForbiddenReason,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "FORBIDDEN", reason },
  });
}

/**
 * 畫休違反限制(規格 14.6「違反限制 → 不存,提示原因」):`VALIDATION_FAILED`(欄位 `date`),
 * `extensions.violations` 列出擋下的違反(`key`、`level`、`message`、`dates`、`actual`、`limit`、`from`、`to`)。
 */
export function dayOffRuleError(violations: readonly object[]): GraphQLError {
  return new GraphQLError("day off violates schedule rules", {
    extensions: { code: "VALIDATION_FAILED", fields: ["date"], violations },
  });
}

/** MongoDB 唯一索引衝突(兩個請求同時寫同一個唯一鍵)。 */
const DUPLICATE_KEY_ERROR = 11_000;

export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY_ERROR
  );
}

/**
 * 寫入撞到唯一索引時,回與事前檢查同一個 `VALIDATION_FAILED`(欄位 `fields`)。
 * 只包在交易外層(交易內不吞錯誤,TX-04):撞到時整個交易已回復,這裡只換成使用者看得懂的錯誤。
 */
export async function savingUnique<T>(
  write: () => Promise<T>,
  message: string,
  fields: string[],
  reason?: ScheduleReason,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }
    throw validationError(message, fields, reason);
  }
}
