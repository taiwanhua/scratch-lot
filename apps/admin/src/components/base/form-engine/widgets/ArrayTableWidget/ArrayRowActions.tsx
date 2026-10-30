import { memo } from "react";
import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { IconButton } from "@repo/ui/icon-button";
import { AddIcon, ArrowDownIcon, ArrowUpIcon } from "@repo/ui/icons";
import { Stack } from "@repo/ui/stack";
import { Tooltip } from "@repo/ui/tooltip";

export interface ArrayRowActionsProps {
  rowId: string;
  /** 第幾列(1 起算,按鈕的無障礙名稱用) */
  index: number;
  /** 第一列不能上移、最後一列不能下移 */
  isFirst: boolean;
  isLast: boolean;
  /** 還沒到 `maxRows`:上方插入、複製才可用 */
  canAdd: boolean;
  /** 穩定的回呼(收 `rowId`),memo 才擋得住重繪 */
  onInsertBefore: (rowId: string) => void;
  onMove: (rowId: string, offset: -1 | 1) => void;
  onDuplicate: (rowId: string) => void;
  onRemove: (rowId: string) => void;
  /** 手機卡片的標題列用:文字鈕不留最小寬度,動作整組才放得進窄卡片的同一行 */
  isCompact?: boolean;
}

/**
 * 一列的動作:上方插入一列、上移、下移(圖示鈕)與「複製」「刪除」。
 * 插入與複製到 `maxRows` 就停;移動只換順序,`rowId` 不變。
 */
export const ArrayRowActions = memo(
  ({
    rowId,
    index,
    isFirst,
    isLast,
    canAdd,
    onInsertBefore,
    onMove,
    onDuplicate,
    onRemove,
    isCompact = false,
  }: ArrayRowActionsProps) => {
    const t = useTranslations("admin.formEngine.array");
    const textButtonSx = isCompact ? { minWidth: 0, px: 1 } : undefined;

    return (
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
        <Tooltip title={t("insertAbove")}>
          <IconButton
            size="small"
            disabled={!canAdd}
            aria-label={t("insertAboveAria", { index })}
            onClick={() => {
              onInsertBefore(rowId);
            }}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("moveUp")}>
          <IconButton
            size="small"
            disabled={isFirst}
            aria-label={t("moveUpAria", { index })}
            onClick={() => {
              onMove(rowId, -1);
            }}
          >
            <ArrowUpIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("moveDown")}>
          <IconButton
            size="small"
            disabled={isLast}
            aria-label={t("moveDownAria", { index })}
            onClick={() => {
              onMove(rowId, 1);
            }}
          >
            <ArrowDownIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Button
          variant="text"
          size="small"
          disabled={!canAdd}
          sx={textButtonSx}
          aria-label={t("duplicateRowAria", { index })}
          onClick={() => {
            onDuplicate(rowId);
          }}
        >
          {t("duplicateRow")}
        </Button>
        <Button
          variant="text"
          size="small"
          color="error"
          sx={textButtonSx}
          aria-label={t("removeRowAria", { index })}
          onClick={() => {
            onRemove(rowId);
          }}
        >
          {t("removeRow")}
        </Button>
      </Stack>
    );
  },
);

ArrayRowActions.displayName = "ArrayRowActions";
