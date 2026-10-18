"use client";

import type { KeyboardEvent, ReactNode } from "react";

import { Box } from "../Box/Box";
import { stateLayerSx } from "../theme/state-layer";

export interface RosterCellProps {
  /** 可點(有 `onClick`、日期沒停用) */
  onClick?: () => void;
  selected?: boolean;
  /** 無障礙名稱(例:「王小明 2026-10-14」) */
  label: string;
  children?: ReactNode;
}

const isActivationKey = (event: KeyboardEvent) =>
  event.key === "Enter" || event.key === " ";

/**
 * 排程格子(Figma Draft/RosterCell):白底,互動狀態 ——
 * 滑過疊主題的 hover 圖層(grey/500 × `hoverOpacity`)並換邊框、已選取疊 selected 圖層
 * (grey/500 × `selectedOpacity`)+ 1px 邊框、鍵盤焦點 `action.focus` 外框(`stateLayerSx`)。
 * 內容(班別標籤…)由使用的模組決定。
 */
export const RosterCell = ({
  onClick,
  selected = false,
  label,
  children,
}: RosterCellProps) => {
  const interactive = onClick !== undefined;
  return (
    <Box
      role={interactive ? "button" : undefined}
      aria-label={interactive ? label : undefined}
      aria-pressed={interactive ? selected : undefined}
      tabIndex={interactive ? 0 : undefined}
      data-selected={selected || undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (event: KeyboardEvent) => {
              if (!isActivationKey(event)) return;
              event.preventDefault();
              onClick();
            }
          : undefined
      }
      sx={(theme) => ({
        height: "100%",
        minHeight: theme.spacing(7),
        p: 0.5,
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
        outline: "none",
        ...(interactive ? stateLayerSx(theme, { selected }) : {}),
      })}
    >
      {children}
    </Box>
  );
};
