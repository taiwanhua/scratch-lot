import {
  localDateDiff,
  parseLocalDate,
  toInstant,
  toIso,
} from "@repo/domain/form";
import { REASON_OTHER_VALUE } from "@repo/domain/project/reason-note";
import {
  MAKEUP_PUNCH_FIELD_KEYS as KEYS,
  MAKEUP_PUNCH_NO_ENTRY,
  makeupPunchValuesOf,
} from "@repo/domain/project/schedule-settings";

import { dayKeyOf } from "@/lib/project/schedule-day-offs";

/**
 * 補打卡新增 / 編輯頁的狀態與存值(規格 14.8;欄位 key 同受管表單 `makeup_punch`)。
 * 純函式:畫面狀態 ↔ 表單存值、送出前檢查。
 */

export type PunchType = "in" | "out";

export interface MakeupPunchState {
  /** 補打卡時間(ISO 時點;日期時間欄);空字串 = 沒選 */
  punchAt: string;
  orgId: string;
  /** 排班 id、`none`(沒有排班)、空字串(沒選) */
  entry: string;
  /** 送出當下的顯示文字(下拉選到的那一項) */
  entryLabel: string;
  type: PunchType;
  reasonKey: string;
  reasonLabel: string;
  note: string;
}

export type MakeupPunchField =
  "punchAt" | "orgId" | "entry" | "reasonKey" | "note";

export const EMPTY_MAKEUP_PUNCH: MakeupPunchState = {
  punchAt: "",
  orgId: "",
  entry: "",
  entryLabel: "",
  type: "in",
  reasonKey: "",
  reasonLabel: "",
  note: "",
};

/** 兩個日期鍵相差不超過一天(「對應排班」下拉的範圍:補打卡那天前後各一天,同 api `aroundDayRangeOf`)。 */
const withinOneDay = (left: string, right: string): boolean => {
  const a = parseLocalDate(left);
  const b = parseLocalDate(right);
  return a !== null && b !== null && Math.abs(localDateDiff(a, b)) <= 1;
};

/**
 * 改了補打卡時間或分店之後,對應排班要不要清空(規格 14.8 情境表):
 *
 * - 改分店 → 清空,重新選
 * - 改補打卡時間:選的班還在新的「前後各一天」範圍內就保留,不在才清空(同一天只改時刻也是這個道理);
 *   「沒有排班(臨時代班)」永遠在下拉裡,保留
 * - `entryDate` = 選的那一班的日期(時點;從目前的下拉選項來)。不知道(下拉還沒載到)時保守判斷:
 *   同一天保留、換了一天清空
 */
export const withPunchAtOrOrg = (
  state: MakeupPunchState,
  next: Partial<Pick<MakeupPunchState, "punchAt" | "orgId">>,
  timezone: string,
  entryDate: string | null = null,
): MakeupPunchState => {
  const cleared = { ...state, ...next, entry: "", entryLabel: "" };
  if (next.orgId !== undefined && next.orgId !== state.orgId) {
    return cleared;
  }
  if (
    next.punchAt === undefined ||
    state.entry === "" ||
    state.entry === MAKEUP_PUNCH_NO_ENTRY
  ) {
    return { ...state, ...next };
  }
  const nextDay = dayKeyOf(next.punchAt, timezone);
  const keep =
    entryDate === null
      ? nextDay === dayKeyOf(state.punchAt, timezone)
      : withinOneDay(dayKeyOf(entryDate, timezone), nextDay);
  return keep ? { ...state, ...next } : cleared;
};

/** 送出前檢查:沒選對應排班要擋「請選擇對應排班」;其他必填。 */
export const invalidFieldsOf = (
  state: MakeupPunchState,
): MakeupPunchField[] => [
  ...(toInstant(state.punchAt) === null ? (["punchAt"] as const) : []),
  ...(state.orgId === "" ? (["orgId"] as const) : []),
  ...(state.entry === "" ? (["entry"] as const) : []),
  ...(state.reasonKey === "" ? (["reasonKey"] as const) : []),
  ...(state.reasonKey === REASON_OTHER_VALUE && state.note.trim() === ""
    ? (["note"] as const)
    : []),
];

/** 畫面狀態 → 表單存值(補打卡時間 = 時點)。 */
export const makeupPunchStoredValues = (
  state: MakeupPunchState,
): Record<string, unknown> => ({
  [KEYS.punchAt]: state.punchAt === "" ? null : state.punchAt,
  [KEYS.branch]: state.orgId,
  [KEYS.entry]: state.entry,
  [KEYS.entryLabel]: state.entryLabel,
  [KEYS.punchType]: state.type,
  [KEYS.reason]: { value: state.reasonKey, label: state.reasonLabel },
  [KEYS.note]: state.note.trim() === "" ? null : state.note.trim(),
});

const labelOf = (value: unknown): string =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { label?: unknown }).label === "string"
    ? (value as { label: string }).label
    : "";

const textOf = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** 既有的提交(退回 / 撤回後再編輯)→ 畫面狀態。 */
export const makeupPunchStateOf = (
  values: Readonly<Record<string, unknown>>,
): MakeupPunchState => {
  const parsed = makeupPunchValuesOf(values);
  let entry = "";
  if (parsed.entryId === null) {
    entry = MAKEUP_PUNCH_NO_ENTRY;
  } else if (parsed.entryId !== undefined) {
    entry = parsed.entryId;
  }
  return {
    punchAt: parsed.punchAt === null ? "" : toIso(parsed.punchAt.getTime()),
    orgId: parsed.branchId ?? "",
    entry,
    entryLabel: textOf(values[KEYS.entryLabel]),
    type: parsed.punchType ?? "in",
    reasonKey: parsed.reasonKey ?? "",
    reasonLabel: labelOf(values[KEYS.reason]),
    note: parsed.note ?? "",
  };
};
