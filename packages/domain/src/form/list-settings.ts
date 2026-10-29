import { isValidFieldKey } from "./keys";
import {
  renderTemplate,
  templatePlaceholdersOf,
  valuePlaceholderKeyOf,
} from "./template";

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
 * 組合欄模板裡的一個佔位符:槽 `{{title}}` / `{{date}}` / `{{amount}}` / `{{serialNo}}`、
 * 表單欄位 `{{value.<欄位key>}}`;其他寫法(含欄位 key 格式不對)為 `invalid`。
 */
export type ListTemplatePlaceholder =
  | { kind: "slot"; slot: ListSlotKey }
  | { kind: "field"; key: string }
  | { kind: "invalid"; name: string };

/** 一個佔位符名稱(`{{` 與 `}}` 之間、去掉頭尾空白)→ 它引用什麼。 */
export function listTemplatePlaceholderOf(
  name: string,
): ListTemplatePlaceholder {
  const valueKey = valuePlaceholderKeyOf(name);
  if (valueKey !== null) {
    return isValidFieldKey(valueKey)
      ? { kind: "field", key: valueKey }
      : { kind: "invalid", name };
  }
  return isListSlotKey(name)
    ? { kind: "slot", slot: name }
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
 * 結果去頭尾空白。值的格式化(日期、選項名稱、讀不到的欄位)由呼叫端的 `resolve` 決定 ——
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
