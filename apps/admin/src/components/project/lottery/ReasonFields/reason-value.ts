import { requiresReasonNote } from "@repo/domain/project/reason-note";

/** 原因欄的值(下拉 + 說明)。 */
export interface ReasonValue {
  reasonKey: string;
  reasonNote: string;
}

export const EMPTY_REASON: ReasonValue = { reasonKey: "", reasonNote: "" };

/** 送出前的檢查(api 會再檢查一次):原因必填;選「其他」說明必填。回缺的欄位。 */
export const missingReasonFields = (
  value: ReasonValue,
): ("reasonKey" | "reasonNote")[] => {
  if (value.reasonKey === "") {
    return ["reasonKey"];
  }
  return requiresReasonNote(value.reasonKey) && value.reasonNote.trim() === ""
    ? ["reasonNote"]
    : [];
};

/** 送 api 的原因(說明空白 = null)。 */
export const reasonInputOf = (
  value: ReasonValue,
): { reasonKey: string; reasonNote: string | null } => ({
  reasonKey: value.reasonKey,
  reasonNote: value.reasonNote.trim() === "" ? null : value.reasonNote.trim(),
});
