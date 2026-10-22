import {
  MAX_HELPER_TASKS,
  MAX_LEADER_TASKS,
  TEMPLATE_SHORT_NAME_MAX,
} from "@repo/domain/project/schedule-settings";

import {
  type FieldErrorTexts,
  fieldErrorTextsOf,
  formErrorSummary,
} from "@/lib/base/field-errors";

import { type ScheduleReason, scheduleErrorOf } from "./schedule-error";

/** `admin.schedule` 的翻譯函式(帶變數)。 */
type Translate = (key: string, values?: Record<string, string>) => string;

/**
 * 排班各對話框每一欄的格式要求(REACT-18;規則正本 api `apps/api/src/project/schedule/` 各 service 的
 * 欄位檢查):送出前檢查沒過、或 api 只回欄位沒有原因時寫在欄位下的那一句。同名欄位在各對話框的規則相同。
 * key 寫成字面值,死鍵掃描看得到。
 */
const FORMAT_TEXTS: Record<string, [string, Record<string, string>?]> = {
  name: ["fieldErrors.required"],
  shortName: [
    "fieldErrors.shortName",
    { max: String(TEMPLATE_SHORT_NAME_MAX) },
  ],
  startTime: ["fieldErrors.time"],
  endTime: ["fieldErrors.endTime"],
  positionKey: ["fieldErrors.required"],
  tasks: [
    "fieldErrors.tasks",
    { leaders: String(MAX_LEADER_TASKS), helpers: String(MAX_HELPER_TASKS) },
  ],
  date: ["fieldErrors.date"],
  category: ["fieldErrors.required"],
  userId: ["fieldErrors.required"],
  entryId: ["fieldErrors.required"],
  orgId: ["fieldErrors.required"],
  kind: ["fieldErrors.required"],
  reason: ["fieldErrors.reasonKey"],
  reasonKey: ["fieldErrors.reasonKey"],
  reasonNote: ["fieldErrors.reasonNote"],
  slots: ["fieldErrors.slots"],
  time: ["fieldErrors.time"],
  startAt: ["fieldErrors.dateTime"],
  endAt: ["fieldErrors.endAt"],
  assignments: ["fieldErrors.assignments"],
  breakMinutes: ["fieldErrors.nonNegativeInteger"],
  order: ["fieldErrors.nonNegativeInteger"],
  weekTemplateId: ["fieldErrors.required"],
  templateName: ["fieldErrors.required"],
  templateShortName: [
    "fieldErrors.shortName",
    { max: String(TEMPLATE_SHORT_NAME_MAX) },
  ],
  days: ["fieldErrors.choose"],
};

/** 原因的文案 key(字面值:死鍵掃描看得到)。 */
const REASON_TEXT_KEYS: Record<ScheduleReason, string> = {
  CALENDAR_DAY_DUPLICATE: "errors.reasons.CALENDAR_DAY_DUPLICATE",
  DAY_OFF_DUPLICATE: "errors.reasons.DAY_OFF_DUPLICATE",
  TIME_RANGES_OVERLAP: "errors.reasons.TIME_RANGES_OVERLAP",
  NO_PRIMARY_STORE: "errors.reasons.NO_PRIMARY_STORE",
  DEMAND_HAS_ASSIGNMENTS: "errors.reasons.DEMAND_HAS_ASSIGNMENTS",
  NOT_CANDIDATE: "errors.reasons.NOT_CANDIDATE",
  STORE_CLOSED: "errors.reasons.STORE_CLOSED",
  ENTRY_OVERLAP: "errors.reasons.ENTRY_OVERLAP",
  DAY_OFF_CONFLICT: "errors.reasons.DAY_OFF_CONFLICT",
  PUNCH_UNAVAILABLE: "errors.reasons.PUNCH_UNAVAILABLE",
  TASK_NOT_ON_DAY: "errors.reasons.TASK_NOT_ON_DAY",
  CANNOT_LEAD: "errors.reasons.CANNOT_LEAD",
  TASK_TAKEN: "errors.reasons.TASK_TAKEN",
  DEMAND_REPEATED: "errors.reasons.DEMAND_REPEATED",
  TASK_ROLE_LOCKED: "errors.reasons.TASK_ROLE_LOCKED",
  ALREADY_JOINED: "errors.reasons.ALREADY_JOINED",
  ORG_REPEATED: "errors.reasons.ORG_REPEATED",
  PRIMARY_ORG_REQUIRED: "errors.reasons.PRIMARY_ORG_REQUIRED",
  OPTION_DISABLED: "errors.reasons.OPTION_DISABLED",
  RULE_NOT_TOGGLEABLE: "errors.reasons.RULE_NOT_TOGGLEABLE",
  PUNCH_NOT_ALLOWED: "errors.reasons.PUNCH_NOT_ALLOWED",
  CONCURRENT_EDIT: "errors.reasons.CONCURRENT_EDIT",
};

export const scheduleFormatText = (t: Translate, field: string): string => {
  const [key, values] = FORMAT_TEXTS[field] ?? ["fieldErrors.check"];
  return t(key, values);
};

/** 送出前檢查沒過的欄位 → 各欄的格式要求。 */
export const scheduleFormatErrorsOf = <Field extends string>(
  invalid: readonly Field[],
  t: Translate,
): FieldErrorTexts<Field> =>
  fieldErrorTextsOf(invalid, invalid, (field) => scheduleFormatText(t, field));

/**
 * api 錯誤 → 欄位下的原因與提示:`VALIDATION_FAILED` 帶了原因(重疊、店休、已被填、不能擔任負責人…)
 * 就把原因寫在指到的欄位下(`errors.reasons.<reason>`),沒有原因寫該欄的格式要求;有欄位錯誤時提示只放通用句。
 * api 的欄位名和對話框不同時(人力需求的 `startAt` → 開始時間)給 `toFormField`。
 */
export const scheduleErrorTextsOf = <Field extends string>(
  error: unknown,
  formFields: readonly Field[],
  t: Translate,
  toFormField: (field: string) => string | undefined = (field) => field,
): { texts: FieldErrorTexts<Field>; summary: string } => {
  const parsed = scheduleErrorOf(error);
  const fields = (parsed.fields ?? []).flatMap((field) => {
    const mapped = toFormField(field);
    return mapped === undefined ? [] : [mapped];
  });
  const texts = fieldErrorTextsOf(fields, formFields, (field) =>
    parsed.reason === undefined
      ? scheduleFormatText(t, field)
      : t(REASON_TEXT_KEYS[parsed.reason]),
  );
  return {
    texts,
    summary: formErrorSummary(
      texts,
      t("errors.VALIDATION_FAILED"),
      parsed.reason === undefined
        ? t(`errors.${parsed.code}`)
        : t(REASON_TEXT_KEYS[parsed.reason]),
    ),
  };
};
