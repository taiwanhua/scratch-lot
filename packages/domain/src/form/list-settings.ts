/**
 * 列表欄位配置(`modules.settings.list`)的內建欄開關:
 * 表單模組的列表除了配置的欄(摘要槽 / 表單欄位)外,還有三個內建欄「表單 / 狀態 / 建立者」,各一個顯示開關。
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
