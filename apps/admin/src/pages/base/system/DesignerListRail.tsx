import type { RefObject } from "react";

import { Card } from "@repo/ui/card";
import { IconButton } from "@repo/ui/icon-button";
import { ChevronDoubleRightIcon } from "@repo/ui/icons";
import { Tooltip } from "@repo/ui/tooltip";

export interface DesignerListRailProps {
  /** [展開] 鈕的無障礙名稱與提示(例:「展開表單清單」) */
  label: string;
  /** 被收起的清單(`aria-controls`) */
  listId: string;
  onExpand: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
}

/**
 * 設計器頁在平板寬收起左清單後留下的窄條:只有一顆 [展開](外框圖示鈕、雙右箭頭,同側欄收合鈕 `SideNavToggle`)。
 * 狀態與焦點由 `useDesignerListCollapse` 管。
 */
export const DesignerListRail = ({
  label,
  listId,
  onExpand,
  buttonRef,
}: DesignerListRailProps) => (
  <Card
    sx={{
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      p: 1,
    }}
  >
    <Tooltip title={label} placement="right" describeChild={false}>
      <IconButton
        ref={buttonRef}
        variant="outlined"
        aria-label={label}
        aria-expanded={false}
        aria-controls={listId}
        onClick={onExpand}
      >
        <ChevronDoubleRightIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  </Card>
);
