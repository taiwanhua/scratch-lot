import type { RefObject } from "react";

import { IconButton } from "@repo/ui/icon-button";
import { ChevronDoubleLeftIcon } from "@repo/ui/icons";
import { Tooltip } from "@repo/ui/tooltip";

export interface DesignerListCollapseButtonProps {
  /** 無障礙名稱與提示(例:「收起表單清單」) */
  label: string;
  /** 要收起的清單(`aria-controls`) */
  listId: string;
  onCollapse: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
}

/**
 * 設計器頁在平板寬、左清單展開時,清單標頭上的 [收起](外框圖示鈕、雙左箭頭,同側欄收合鈕 `SideNavToggle`)。
 * 收起後換成 `DesignerListRail` 的 [展開];狀態與焦點由 `useDesignerListCollapse` 管。
 */
export const DesignerListCollapseButton = ({
  label,
  listId,
  onCollapse,
  buttonRef,
}: DesignerListCollapseButtonProps) => (
  <Tooltip title={label} describeChild={false}>
    <IconButton
      ref={buttonRef}
      variant="outlined"
      size="small"
      aria-label={label}
      aria-expanded
      aria-controls={listId}
      onClick={onCollapse}
    >
      <ChevronDoubleLeftIcon fontSize="small" />
    </IconButton>
  </Tooltip>
);
