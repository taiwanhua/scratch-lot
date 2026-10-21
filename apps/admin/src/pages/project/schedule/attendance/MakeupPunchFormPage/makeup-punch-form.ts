import { REASON_OTHER_VALUE } from "@repo/domain/project/reason-note";
import {
  MAKEUP_PUNCH_FIELD_KEYS as KEYS,
  MAKEUP_PUNCH_NO_ENTRY,
  makeupPunchValuesOf,
} from "@repo/domain/project/schedule-settings";

import {
  localDayInstantOf,
  localDayTextOf,
} from "@/lib/base/form-engine/local-day";

/**
 * 補打卡新增 / 編輯頁的狀態與存值(規格 14.8;欄位 key 同受管表單 `makeup_punch`)。
 * 純函式:畫面狀態 ↔ 表單存值、送出前檢查。
 */

export type PunchType = "in" | "out";

export interface MakeupPunchState {
  /** `YYYY-MM-DD`;空字串 = 沒選 */
  date: string;
  orgId: string;
  /** 排班 id、`none`(沒有排班)、空字串(沒選) */
  entry: string;
  /** 送出當下的顯示文字(下拉選到的那一項) */
  entryLabel: string;
  type: PunchType;
  /** `HH:mm` */
  time: string;
  reasonKey: string;
  reasonLabel: string;
  note: string;
}

export type MakeupPunchField =
  "date" | "orgId" | "entry" | "time" | "reasonKey" | "note";

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/u;

export const EMPTY_MAKEUP_PUNCH: MakeupPunchState = {
  date: "",
  orgId: "",
  entry: "",
  entryLabel: "",
  type: "in",
  time: "",
  reasonKey: "",
  reasonLabel: "",
  note: "",
};

/** 改了日期或分店 → 對應排班清空,重新選(規格 14.8 情境表)。 */
export const withDateOrOrg = (
  state: MakeupPunchState,
  next: Partial<Pick<MakeupPunchState, "date" | "orgId">>,
): MakeupPunchState => {
  const changed =
    (next.date !== undefined && next.date !== state.date) ||
    (next.orgId !== undefined && next.orgId !== state.orgId);
  return changed
    ? { ...state, ...next, entry: "", entryLabel: "" }
    : { ...state, ...next };
};

/** 送出前檢查:沒選對應排班要擋「請選擇對應排班」;其他必填與格式。 */
export const invalidFieldsOf = (
  state: MakeupPunchState,
): MakeupPunchField[] => [
  ...(state.date === "" ? (["date"] as const) : []),
  ...(state.orgId === "" ? (["orgId"] as const) : []),
  ...(state.entry === "" ? (["entry"] as const) : []),
  ...(HH_MM.test(state.time) ? [] : (["time"] as const)),
  ...(state.reasonKey === "" ? (["reasonKey"] as const) : []),
  ...(state.reasonKey === REASON_OTHER_VALUE && state.note.trim() === ""
    ? (["note"] as const)
    : []),
];

/** 畫面狀態 → 表單存值(日期 = 那一天在租戶時區 00:00 的時點)。 */
export const makeupPunchStoredValues = (
  state: MakeupPunchState,
  timezone: string,
): Record<string, unknown> => ({
  [KEYS.date]: localDayInstantOf(state.date, timezone),
  [KEYS.branch]: state.orgId,
  [KEYS.entry]: state.entry,
  [KEYS.entryLabel]: state.entryLabel,
  [KEYS.punchType]: state.type,
  [KEYS.time]: state.time,
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
  timezone: string,
): MakeupPunchState => {
  const parsed = makeupPunchValuesOf(values);
  let entry = "";
  if (parsed.entryId === null) {
    entry = MAKEUP_PUNCH_NO_ENTRY;
  } else if (parsed.entryId !== undefined) {
    entry = parsed.entryId;
  }
  return {
    date: localDayTextOf(values[KEYS.date], timezone) ?? "",
    orgId: parsed.branchId ?? "",
    entry,
    entryLabel: textOf(values[KEYS.entryLabel]),
    type: parsed.punchType ?? "in",
    time: parsed.time ?? "",
    reasonKey: parsed.reasonKey ?? "",
    reasonLabel: labelOf(values[KEYS.reason]),
    note: parsed.note ?? "",
  };
};
