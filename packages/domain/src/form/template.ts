import { roundToPrecision } from "./decimal";
import { optionLabelOf } from "./semantic";
import { DEFAULT_TENANT_TIMEZONE, formatTemporal } from "./temporal";
import type { FieldDef, LookupSourceDescriptor } from "./types";

/**
 * 顯示模板(頁籤 / 標題模板 `forms.tabLabelTemplate`、lookup 來源的 `labelTemplate`)的共用零件:
 * 佔位符 `{{名稱}}` 的解析與套用、欄位值 → 模板文字的格式化、lookup 模板佔位符對到 provider 的哪個欄位。
 * 前端(頁籤即時算)與後端(`formLookup` 組 label)用同一套,結果一致。
 */

/** `{{名稱}}`(名稱前後可有空白,比對後再去掉;名稱內不含大括號)。 */
const PLACEHOLDER_PATTERN = /\{\{([^{}]*)\}\}/g;

/** 欄位值佔位符的前綴:`{{value.<欄位key>}}`。 */
export const VALUE_PLACEHOLDER_PREFIX = "value.";

/** 模板裡出現的佔位符名稱(依出現順序,不去重)。 */
export function templatePlaceholdersOf(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER_PATTERN)].map((match) =>
    (match[1] ?? "").trim(),
  );
}

/** 套模板:每個佔位符換成 `resolve(名稱)`,沒值(null / undefined)換空字串;結果去頭尾空白。 */
export function renderTemplate(
  template: string,
  resolve: (name: string) => string | null | undefined,
): string {
  return template
    .replaceAll(PLACEHOLDER_PATTERN, (_match, name: string) => {
      return resolve(name.trim()) ?? "";
    })
    .trim();
}

/** `value.<key>` → key;不是欄位值佔位符 → null。 */
export function valuePlaceholderKeyOf(name: string): string | null {
  return name.startsWith(VALUE_PLACEHOLDER_PREFIX) &&
    name.length > VALUE_PLACEHOLDER_PREFIX.length
    ? name.slice(VALUE_PLACEHOLDER_PREFIX.length)
    : null;
}

/** 欄位值 → 模板文字的選項。 */
export interface TemplateTextOptions {
  /** 日期 / 日期時間的顯示時區(沒給 = 預設租戶時區)。 */
  timezone?: string | null;
  /** 是 / 否欄的文字(沒給 = 「是」/「否」)。 */
  yes?: string;
  no?: string;
}

/** 當作空值的字串:空字串、讀不到的受保護欄位(api 讀取投影的 `"[redacted]"`)。 */
const EMPTY_TEXTS: ReadonlySet<unknown> = new Set(["", "[redacted]"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalarText(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function labelText(label: unknown): string {
  if (Array.isArray(label)) {
    return label
      .map((item) => scalarText(item))
      .filter((item) => item !== "")
      .join("、");
  }
  return scalarText(label);
}

/**
 * 一格存值在模板裡的文字:選項 / 引用印 label、日期 / 日期時間走 `formatTemporal`(給的時區)、
 * 數字照 `precision` 取位、是 / 否印文字、上傳印檔名;空值、讀不到(`"[redacted]"`)、明細列 → 空字串。
 */
export function templateTextOf(
  field: FieldDef,
  stored: unknown,
  options: TemplateTextOptions = {},
): string {
  if (stored === null || stored === undefined || EMPTY_TEXTS.has(stored)) {
    return "";
  }
  switch (field.type) {
    case "select":
    case "multiSelect":
    case "reference": {
      const label = labelText(optionLabelOf(field, stored));
      if (label !== "") {
        return label;
      }
      return Array.isArray(stored)
        ? stored.map((item) => scalarText(item)).join("、")
        : scalarText(stored);
    }
    case "date":
    case "datetime": {
      return formatTemporal(stored, {
        type: field.type,
        timezone: options.timezone ?? DEFAULT_TENANT_TIMEZONE,
      });
    }
    case "number": {
      return field.precision === undefined
        ? scalarText(stored)
        : (roundToPrecision(stored, field.precision) ?? scalarText(stored));
    }
    case "boolean": {
      if (typeof stored !== "boolean") {
        return "";
      }
      return stored ? (options.yes ?? "是") : (options.no ?? "否");
    }
    case "upload": {
      return isRecord(stored) ? scalarText(stored.name) : "";
    }
    case "text":
    case "multiline": {
      return scalarText(stored);
    }
    default: {
      return "";
    }
  }
}

/** `form_submission` 來源的摘要槽(模板用 `{{title}}` / `{{date}}` / `{{amount}}`)。 */
export const LOOKUP_SUMMARY_SLOTS = ["title", "date", "amount"] as const;

/** 「其他表單提交」來源的 provider key(與 `validate-fields.ts` 的同名常數同值)。 */
const SUBMISSION_PROVIDER = "form_submission";

/**
 * lookup 模板的佔位符 → 對到 provider 的哪個欄位;不合這個 provider 的寫法 → null。
 *
 * - `form_submission`:摘要槽 `{{title}}` / `{{date}}` / `{{amount}}` 對到同名槽;`{{value.<key>}}` 對到那個欄位
 * - 其他 provider(`user` / `org`):`{{欄位名}}` 直接對到那個欄位(不收 `value.` 寫法)
 *
 * 只看寫法,欄位存不存在由檢查器(`validateLookupSource`)對照登錄表判斷。
 */
export function lookupTemplateFieldOf(
  provider: string,
  name: string,
): string | null {
  const valueKey = valuePlaceholderKeyOf(name);
  if (provider === SUBMISSION_PROVIDER) {
    if (valueKey !== null) {
      return (LOOKUP_SUMMARY_SLOTS as readonly string[]).includes(valueKey)
        ? null
        : valueKey;
    }
    return (LOOKUP_SUMMARY_SLOTS as readonly string[]).includes(name)
      ? name
      : null;
  }
  return valueKey === null && name !== "" ? name : null;
}

/** 有沒有設顯示模板(空字串 / 只有空白 = 沒設)。 */
export function hasLabelTemplate(
  source: Pick<LookupSourceDescriptor, "labelTemplate">,
): source is { labelTemplate: string } {
  return (
    typeof source.labelTemplate === "string" &&
    source.labelTemplate.trim() !== ""
  );
}

/** 組顯示名要讀的來源欄位:`labelField`(退路)+ 模板用到的欄位(去重)。 */
export function lookupLabelFieldsOf(
  source: Pick<
    LookupSourceDescriptor,
    "provider" | "labelField" | "labelTemplate"
  >,
): string[] {
  const fields = [source.labelField];
  if (hasLabelTemplate(source)) {
    for (const name of templatePlaceholdersOf(source.labelTemplate)) {
      const field = lookupTemplateFieldOf(source.provider, name);
      if (field !== null) {
        fields.push(field);
      }
    }
  }
  return [...new Set(fields)];
}

/**
 * lookup 一筆的顯示名:有模板就套(每個佔位符取 `fieldText(來源欄位)`);沒模板、套出來是空的,
 * 或**模板引用的欄位有任何一個讀不到**(`fieldText` 回 `undefined` = provider 因權限省略了那一欄)→ 整串用 `labelField`,
 * 不拼接、不留符號(例 `{{name}}({{email}})` 對讀不到 Email 的人顯示「王小明」,不是「王小明()」)。
 * `fieldText` 由呼叫端給:讀得到回顯示文字(沒值回 null → 換空字串),讀不到回 undefined。
 */
export function renderLookupLabel(
  source: Pick<
    LookupSourceDescriptor,
    "provider" | "labelField" | "labelTemplate"
  >,
  fieldText: (field: string) => string | null | undefined,
): string | null {
  if (hasLabelTemplate(source)) {
    const unreadable: string[] = [];
    const label = renderTemplate(source.labelTemplate, (name) => {
      const field = lookupTemplateFieldOf(source.provider, name);
      if (field === null) {
        return null;
      }
      const text = fieldText(field);
      if (text === undefined) {
        unreadable.push(field);
      }
      return text;
    });
    if (unreadable.length === 0 && label !== "") {
      return label;
    }
  }
  return fieldText(source.labelField) ?? null;
}
