import { isValidFieldKey } from "./keys";
import {
  renderTemplate,
  templatePlaceholdersOf,
  valuePlaceholderKeyOf,
} from "./template";
import { isTemporalFormat } from "./temporal";

/**
 * 列表欄位配置(`modules.settings.list`)的共用零件:
 * - 內建欄開關:表單模組的列表除了配置的欄(摘要槽 / 表單欄位 / 組合欄)外,還有三個內建欄「表單 / 狀態 / 建立者」,
 *   各一個顯示開關
 * - 摘要槽 key(`LIST_SLOT_KEYS`)與組合欄模板的佔位符解析 / 套用(api 存檔驗證、前端列表組字串、
 *   定義檢查器的引用警告用同一套)
 *
 * 落庫形狀:`modules.settings.list = { columns: [...], builtin: { form, status, createdBy } }`;
 * `builtin` 沒存過(或某個鍵不是 boolean)= 該欄顯示(預設全開)。
 */

/** 內建欄(依列表上的順序)。 */
export const LIST_BUILTIN_COLUMNS = ["form", "status", "createdBy"] as const;

export type ListBuiltinColumn = (typeof LIST_BUILTIN_COLUMNS)[number];

/** 各內建欄顯不顯示。 */
export type ListBuiltinColumns = Record<ListBuiltinColumn, boolean>;

export const DEFAULT_LIST_BUILTIN_COLUMNS: Readonly<ListBuiltinColumns> = {
  form: true,
  status: true,
  createdBy: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `modules.settings.list.builtin` 的存值 → 三個開關(缺的 / 不是 boolean 的鍵 = 顯示)。 */
export function listBuiltinColumnsOf(raw: unknown): ListBuiltinColumns {
  const stored = isRecord(raw) ? raw : {};
  const result = { ...DEFAULT_LIST_BUILTIN_COLUMNS };
  for (const column of LIST_BUILTIN_COLUMNS) {
    const value = stored[column];
    if (typeof value === "boolean") {
      result[column] = value;
    }
  }
  return result;
}

/**
 * 「摘要槽」欄可選的值,也是組合欄可用的槽佔位符:三個摘要槽(`form_submissions.summary`)
 * 加**單號**(`serialNo`,`form_submissions.serialNo`;表單設了單號格式才有值)。
 */
export const LIST_SLOT_KEYS = ["title", "date", "amount", "serialNo"] as const;

export type ListSlotKey = (typeof LIST_SLOT_KEYS)[number];

export function isListSlotKey(key: string): key is ListSlotKey {
  return (LIST_SLOT_KEYS as readonly string[]).includes(key);
}

/** 組合欄的欄名長度上限(去頭尾空白後;1 字起)。 */
export const LIST_TEMPLATE_LABEL_MAX_LENGTH = 50;

/** 組合欄模板的長度上限(去頭尾空白後)。 */
export const LIST_TEMPLATE_MAX_LENGTH = 200;

/**
 * 組合欄佔位符裡,名稱與格式字串的分隔:`{{value.start_at|HH:mm}}`。只有組合欄認這個寫法;
 * 頁籤模板與 lookup `labelTemplate` 沒有格式,寫了就是不認得的佔位符。
 */
export const LIST_TEMPLATE_FORMAT_SEPARATOR = "|";

/**
 * 「插入欄位」下拉給日期 / 日期時間佔位符的格式快捷(使用者也可以自己打其他格式字串)。
 */
export const LIST_TEMPLATE_FORMAT_PRESETS = [
  "HH:mm",
  "YYYY/MM/DD",
  "YYYY-MM-DD HH:mm",
] as const;

/** 可以加格式的槽:「日期」槽(依版本是日期或日期時間)。 */
export const LIST_TEMPLATE_FORMATTABLE_SLOTS: readonly ListSlotKey[] = ["date"];

/**
 * 組合欄模板裡的一個佔位符:槽 `{{title}}` / `{{date}}` / `{{amount}}` / `{{serialNo}}`、
 * 表單欄位 `{{value.<欄位key>}}`;日期 / 日期時間可加格式字串 `{{value.<key>|<格式>}}`、`{{date|<格式>}}`
 * (token 對齊 dayjs,見 `temporal.ts` 的 `TEMPORAL_FORMAT_TOKENS`;`format` 沒寫為 null)。
 * 其他寫法(含欄位 key 格式不對、格式字串不合法、日期以外的槽加格式)為 `invalid`。
 * 欄位是不是日期 / 日期時間要看表單定義:api 存檔時驗,前端遇到改版後不是日期的欄位就不套格式。
 */
export type ListTemplatePlaceholder =
  | { kind: "slot"; slot: ListSlotKey; format: string | null }
  | { kind: "field"; key: string; format: string | null }
  | { kind: "invalid"; name: string };

/** 一個佔位符名稱(`{{` 與 `}}` 之間、去掉頭尾空白)→ 它引用什麼。 */
export function listTemplatePlaceholderOf(
  name: string,
): ListTemplatePlaceholder {
  const separator = name.indexOf(LIST_TEMPLATE_FORMAT_SEPARATOR);
  const ref = (separator === -1 ? name : name.slice(0, separator)).trim();
  const format =
    separator === -1
      ? null
      : name.slice(separator + LIST_TEMPLATE_FORMAT_SEPARATOR.length).trim();
  if (format !== null && !isTemporalFormat(format)) {
    return { kind: "invalid", name };
  }
  const valueKey = valuePlaceholderKeyOf(ref);
  if (valueKey !== null) {
    return isValidFieldKey(valueKey)
      ? { kind: "field", key: valueKey, format }
      : { kind: "invalid", name };
  }
  if (!isListSlotKey(ref)) {
    return { kind: "invalid", name };
  }
  return format === null || LIST_TEMPLATE_FORMATTABLE_SLOTS.includes(ref)
    ? { kind: "slot", slot: ref, format }
    : { kind: "invalid", name };
}

/** 模板裡的佔位符(依出現順序,不去重)。 */
export function listTemplatePlaceholdersOf(
  template: string,
): ListTemplatePlaceholder[] {
  return templatePlaceholdersOf(template).map((name) =>
    listTemplatePlaceholderOf(name),
  );
}

/** 模板引用的表單欄位 key(去重,依第一次出現的順序)。 */
export function listTemplateFieldKeysOf(template: string): string[] {
  const keys = listTemplatePlaceholdersOf(template).flatMap((placeholder) =>
    placeholder.kind === "field" ? [placeholder.key] : [],
  );
  return [...new Set(keys)];
}

/** 組合欄可用的佔位符(`invalid` 以外)。 */
export type ListTemplateReference = Exclude<
  ListTemplatePlaceholder,
  { kind: "invalid" }
>;

/**
 * 套組合欄模板:每個佔位符換成 `resolve(佔位符)` 的文字(沒值 = 空字串;`invalid` 一律空字串),
 * 結果去頭尾空白。值的格式化(日期與它的格式字串、選項名稱、讀不到的欄位)由呼叫端的 `resolve` 決定 ——
 * 前端列表與同一列表的表單欄位欄用同一套顯示規則。
 */
export function renderListTemplate(
  template: string,
  resolve: (placeholder: ListTemplateReference) => string | null | undefined,
): string {
  return renderTemplate(template, (name) => {
    const placeholder = listTemplatePlaceholderOf(name);
    return placeholder.kind === "invalid" ? null : resolve(placeholder);
  });
}
