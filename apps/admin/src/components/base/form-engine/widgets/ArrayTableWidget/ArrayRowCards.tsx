import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { ArrayCell } from "./ArrayCell";
import { ArrayRowActions } from "./ArrayRowActions";
import type { ArrayRowsViewProps } from "./array-rows-view";

/**
 * 明細列的手機畫法(< `sm`):每列一張卡片,子欄直排(子欄的 `width` 不適用);列尾動作在卡片標題列。
 */
export const ArrayRowCards = ({
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

  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {isDesign ? t("designPlaceholder") : t("noRows")}
      </Typography>
    );
  }

  return (
    <Stack spacing={1.5} role="list" aria-label={label}>
      {rows.map((row, index) => {
        const title = t("rowTitle", { index: index + 1 });
        return (
          <Card
            key={row.rowId}
            variant="outlined"
            role="listitem"
            aria-label={title}
          >
            <Stack
              direction="row"
              sx={{
                alignItems: "center",
                px: 2,
                py: 1,
                borderBottom: 1,
                borderColor: "divider",
              }}
            >
              <Typography variant="subtitle2" sx={{ flex: 1 }}>
                {title}
              </Typography>
              {canEdit && (
                <ArrayRowActions
                  rowId={row.rowId}
                  index={index + 1}
                  isFirst={index === 0}
                  isLast={index === rows.length - 1}
                  canAdd={canAdd}
                  onInsertBefore={onInsertBefore}
                  onMove={onMove}
                  onDuplicate={onDuplicate}
                  onRemove={onRemove}
                />
              )}
            </Stack>
            <Box sx={{ p: 2 }}>
              <Stack spacing={1.5}>
                {columns.map((column) => (
                  <ArrayCell
                    key={column.key}
                    arrayKey={arrayKey}
                    column={column}
                    rowId={row.rowId}
                    value={row[column.key]}
                    context={context}
                    isDisabled={isDisabled}
                    isReadOnly={isReadOnly}
                    isDesign={isDesign}
                    hiddenLabel={false}
                    errorMessage={cellError(row.rowId, column.key)}
                    display={displayOf(column.key)}
                    onCellChange={onCellChange}
                  />
                ))}
              </Stack>
            </Box>
          </Card>
        );
      })}
    </Stack>
  );
};
