"use client";

import type { KeyboardEvent } from "react";

import { Box } from "../Box/Box";
import { stateLayerSx } from "../theme/state-layer";

export interface RosterEmptyGroupCellProps {
  /** 淡色提示(例:「+ 時段需求」),滑過 / 鍵盤焦點時才顯示 */
  hint: string | undefined;
  /** 無障礙名稱(提示 + 日期) */
  label: string;
  onClick: () => void;
}

const isActivationKey = (event: KeyboardEvent) =>
  event.key === "Enter" || event.key === " ";

/** 頂部群組的空白格:點了回呼使用的模組(帶日期與那一列);滑過顯示淡色「+ 新增」提示。 */
export const RosterEmptyGroupCell = ({
  hint,
  label,
  onClick,
}: RosterEmptyGroupCellProps) => (
  <Box
    role="button"
    tabIndex={0}
    aria-label={label}
    onClick={onClick}
    onKeyDown={(event: KeyboardEvent) => {
      if (!isActivationKey(event)) return;
      event.preventDefault();
      onClick();
    }}
    sx={(theme) => ({
      minHeight: theme.spacing(3.5),
      px: 0.75,
      display: "flex",
      alignItems: "center",
      typography: "caption",
      color: "text.disabled",
      outline: "none",
      "& > span": { opacity: 0 },
      "&:hover > span, &:focus-visible > span": { opacity: 1 },
      ...stateLayerSx(theme),
    })}
  >
    {hint === undefined ? null : <span>{hint}</span>}
  </Box>
);
