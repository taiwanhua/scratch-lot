import { toInstant, toIso } from "@repo/domain/form";
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

/**
 * 改了補打卡時間的**日期**(租戶時區)或分店 → 對應排班清空,重新選(規格 14.8 情境表);
 * 同一天只改時刻不清(下拉列的是那天的排班,沒變)。
 */
export const withPunchAtOrOrg = (
  state: MakeupPunchState,
  next: Partial<Pick<MakeupPunchState, "punchAt" | "orgId">>,
  timezone: string,
): MakeupPunchState => {
  const changed =
    (next.punchAt !== undefined &&
      dayKeyOf(next.punchAt, timezone) !== dayKeyOf(state.punchAt, timezone)) ||
    (next.orgId !== undefined && next.orgId !== state.orgId);
  return changed
    ? { ...state, ...next, entry: "", entryLabel: "" }
    : { ...state, ...next };
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
