import { useTranslations } from "use-intl";

import type { ArrayRowValue } from "@repo/domain/form";
import { Table, type TableColumn } from "@repo/ui/table";

import { ArrayCell } from "./ArrayCell";
import { ArrayRowActions } from "./ArrayRowActions";
import type { ArrayRowsViewProps } from "./array-rows-view";

/** 子欄沒設寬度時的表格欄最小寬(px)。 */
const DEFAULT_COLUMN_WIDTH = 160;

/** 列尾動作欄的寬(px)。 */
const ACTIONS_WIDTH = 260;

const widthOf = (width: number | null | undefined): number =>
  width ?? DEFAULT_COLUMN_WIDTH;

/**
 * 明細列的桌機畫法:表格,每列一行、每格是子欄的填寫元件;子欄的 `width` 是表格欄的最小寬,
 * 加總超過容器時橫向捲動(STYLE-11)。
 */
export const ArrayRowsTable = ({
  arrayKey,
  label,
  columns,
  rows,
  context,
  canEdit,
  canAdd,
  isDisabled,
  isReadOnly,
  isDesign,
  cellError,
  displayOf,
  onCellChange,
  onInsertBefore,
  onMove,
  onDuplicate,
  onRemove,
}: ArrayRowsViewProps) => {
  const t = useTranslations("admin.formEngine.array");

  const cells: TableColumn<ArrayRowValue>[] = columns.map((column) => ({
    key: column.key,
    header: `${column.label}${column.rules?.required === true ? " *" : ""}`,
    width: widthOf(column.width),
    render: (row) => (
      <ArrayCell
        arrayKey={arrayKey}
        column={column}
        rowId={row.rowId}
        value={row[column.key]}
        context={context}
        isDisabled={isDisabled}
        isReadOnly={isReadOnly}
        isDesign={isDesign}
        hiddenLabel
        errorMessage={cellError(row.rowId, column.key)}
        display={displayOf(column.key)}
        onCellChange={onCellChange}
      />
    ),
  }));
  const actions: TableColumn<ArrayRowValue>[] = canEdit
    ? [
        {
          key: "$actions",
          header: t("rowActions"),
          width: ACTIONS_WIDTH,
          render: (row, ctx) => (
            <ArrayRowActions
              rowId={row.rowId}
              index={ctx.index + 1}
              isFirst={ctx.index === 0}
              isLast={ctx.index === rows.length - 1}
              canAdd={canAdd}
              onInsertBefore={onInsertBefore}
              onMove={onMove}
              onDuplicate={onDuplicate}
              onRemove={onRemove}
            />
          ),
        },
      ]
    : [];

  return (
    <Table<ArrayRowValue>
      aria-label={label}
      size="small"
      rows={rows}
      getRowKey={(row) => row.rowId}
      columns={[...cells, ...actions]}
      emptyMessage={isDesign ? t("designPlaceholder") : t("noRows")}
      minWidth={
        columns.reduce((sum, column) => sum + widthOf(column.width), 0) +
        (canEdit ? ACTIONS_WIDTH : 0)
      }
      containerSx={{ height: "auto" }}
    />
  );
};
