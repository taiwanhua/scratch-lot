"use client";

import MuiButtonBase from "@mui/material/ButtonBase";
import type { ReactNode } from "react";

import { ChevronDownIcon } from "../icons/ChevronDownIcon";
import { ChevronRightIcon } from "../icons/ChevronRightIcon";

export interface RosterGroupToggleProps {
  /** 按鈕文字;`hideLabel` 時改當無障礙名稱(須是字串) */
  label: ReactNode;
  /** 只顯示箭頭(欄位群組展開時,不多佔欄寬) */
  hideLabel?: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** 文字在箭頭前([統計 ▸])或後(▾ 時段需求);預設在後 */
  iconPosition?: "start" | "end";
}

/** 收合 / 展開鈕(▾ / ▸):頂部群組標題與欄位群組共用。 */
export const RosterGroupToggle = ({
  label,
  expanded,
  onToggle,
  iconPosition = "start",
  hideLabel = false,
}: RosterGroupToggleProps) => {
  const icon = expanded ? (
    <ChevronDownIcon fontSize="inherit" />
  ) : (
    <ChevronRightIcon fontSize="inherit" />
  );
  return (
    <MuiButtonBase
      disableRipple
      aria-expanded={expanded}
      aria-label={hideLabel && typeof label === "string" ? label : undefined}
      onClick={onToggle}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        color: "text.secondary",
        typography: "subtitle2",
        cursor: "pointer",
        whiteSpace: "nowrap",
        borderRadius: 0.5,
        "&:hover": { color: "text.primary" },
        "&.Mui-focusVisible": {
          outline: 2,
          outlineColor: "action.focus",
          outlineStyle: "solid",
        },
      }}
    >
      {iconPosition === "start" ? icon : null}
      {hideLabel ? null : label}
      {iconPosition === "end" ? icon : null}
    </MuiButtonBase>
  );
};
