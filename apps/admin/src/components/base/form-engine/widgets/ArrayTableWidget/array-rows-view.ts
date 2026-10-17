import type { ArrayColumnDef, ArrayRowValue } from "@repo/domain/form";

import type { FilterLinkValues } from "@/lib/base/form-engine/filter-links";
import type { FormDisplayItemLike } from "@/lib/base/form-engine/value-text";

import type { WidgetContext } from "../widget-types";

export type ArrayReferencePick = (
  rowId: string,
  columnKey: string,
  value: { id: string; label: string },
  sourceValues: Readonly<Record<string, unknown>>,
) => void;

/** 明細列的兩種畫法(桌機表格 / 手機卡片)共用的 props。 */
export interface ArrayRowsViewProps {
  arrayKey: string;
  /** 明細欄的標題(表格的無障礙名稱、卡片標題的前綴) */
  label: string;
  columns: readonly ArrayColumnDef[];
  rows: readonly ArrayRowValue[];
  context: WidgetContext;
  /** 可以增刪改(填寫 / 預覽、且改得動這一欄) */
  canEdit: boolean;
  /** 還沒到 `maxRows`(複製、上方插入一列也受它限制) */
  canAdd: boolean;
  isDisabled: boolean;
  isReadOnly: boolean;
  isDesign: boolean;
  cellError: (rowId: string, columnKey: string) => string | null;
  displayOf: (columnKey: string) => readonly FormDisplayItemLike[];
  onCellChange: (rowId: string, columnKey: string, value: unknown) => void;
  /** 連動篩選的被引用欄位(表單層)目前的值;給引用子欄 */
  filterLinks: FilterLinkValues | undefined;
  /** 引用子欄選定 / 改選(有列內帶入時):引用值與帶入的子欄一次寫進同一列 */
  onReferencePick: ArrayReferencePick;
  onInsertBefore: (rowId: string) => void;
  onMove: (rowId: string, offset: -1 | 1) => void;
  onDuplicate: (rowId: string) => void;
  onRemove: (rowId: string) => void;
}
