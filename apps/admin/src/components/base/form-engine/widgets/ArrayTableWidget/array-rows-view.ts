import type { ArrayColumnDef, ArrayRowValue } from "@repo/domain/form";

import type { FormDisplayItemLike } from "@/lib/base/form-engine/value-text";

import type { WidgetContext } from "../widget-types";

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
  onInsertBefore: (rowId: string) => void;
  onMove: (rowId: string, offset: -1 | 1) => void;
  onDuplicate: (rowId: string) => void;
  onRemove: (rowId: string) => void;
}
