import type { ReactNode } from "react";

/**
 * `DataTable` 的選用列勾選(預設關閉;給了這個 prop 才出現勾選欄與上方的「已選 N 筆」列)。
 * 以列 key(`getRowKey`)記選取,選取由呼叫端持有:換頁、重查之後已勾的照樣保留。
 * 勾選屬於「大量資料」,不放網址(呼叫端用一般 state 持有)。
 */
export interface DataTableRowSelection<Row> {
  /** 已勾的列 key(受控);可以包含不在目前 `rows` 裡的列(例:別頁勾的) */
  selectedKeys: readonly string[];
  /** 勾 / 取消勾 / 全選本頁 / 清除時回報整份新的選取 */
  onSelectedKeysChange: (keys: string[]) => void;
  /** 最多能勾幾列;到上限時其他未勾的列停用(全選本頁也只勾到上限) */
  maxCount?: number;
  /** 這列能不能勾(例:只有待處理的能勾);不給 = 都能勾 */
  isRowSelectable?: (row: Row) => boolean;
  /** 「已選 N 筆」列右側的動作(例:[核准(N)]) */
  actions?: ReactNode;
  /** 「已選 N 筆」後面的說明文字 */
  hint?: ReactNode;
  /** 文案;`@repo/ui` 語言無關,預設中文,由呼叫端換成翻譯 */
  labels?: Partial<DataTableRowSelectionLabels<Row>>;
}

export interface DataTableRowSelectionLabels<Row> {
  /** 預設「已選 N 筆」 */
  selectedCount: (count: number) => ReactNode;
  /** 預設「清除」 */
  clear: string;
  /** 表頭勾選框的無障礙名稱;預設「全選本頁」 */
  selectPage: string;
  /** 列勾選框的無障礙名稱;預設「勾選這一列」 */
  selectRow: (row: Row) => string;
}

/** 勾選欄的欄位 key(不會和呼叫端的欄位撞名)。 */
export const SELECTION_COLUMN_KEY = "__row_selection__";

export const SELECTION_COLUMN_WIDTH = 56;

export const defaultSelectionLabels: DataTableRowSelectionLabels<unknown> = {
  selectedCount: (count) => `已選 ${String(count)} 筆`,
  clear: "清除",
  selectPage: "全選本頁",
  selectRow: () => "勾選這一列",
};

/**
 * 表頭勾選框按下去之後的選取:本頁可勾的列全勾了,或已到上限(再也補不進去)→ 取消本頁;
 * 否則把本頁還沒勾的可勾列依序補上,補到 `maxCount` 為止。別頁勾的不動。
 */
export const togglePageSelection = (
  selectedKeys: readonly string[],
  pageKeys: readonly string[],
  maxCount: number,
): string[] => {
  const selected = new Set(selectedKeys);
  const isAllSelected =
    pageKeys.length > 0 && pageKeys.every((key) => selected.has(key));
  if (isAllSelected || selectedKeys.length >= maxCount) {
    const page = new Set(pageKeys);
    return selectedKeys.filter((key) => !page.has(key));
  }
  const next = [...selectedKeys];
  for (const key of pageKeys) {
    if (next.length >= maxCount) {
      break;
    }
    if (!selected.has(key)) {
      next.push(key);
    }
  }
  return next;
};
