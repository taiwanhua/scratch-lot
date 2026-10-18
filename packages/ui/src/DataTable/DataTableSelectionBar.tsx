"use client";

import MuiBox from "@mui/material/Box";
import MuiButton from "@mui/material/Button";
import MuiTypography from "@mui/material/Typography";
import type { ReactNode } from "react";

export interface DataTableSelectionBarProps {
  count: number;
  countText: ReactNode;
  clearLabel: string;
  hint?: ReactNode;
  actions?: ReactNode;
  onClear: () => void;
}

/**
 * 表格上方的「已選 N 筆 · 清除」列(`DataTable` 專用子元件;有勾選時才出現):
 * 左邊已選筆數、清除與說明,右邊呼叫端的動作。
 */
export const DataTableSelectionBar = ({
  count,
  countText,
  clearLabel,
  hint,
  actions,
  onClear,
}: DataTableSelectionBarProps) => (
  <MuiBox
    role="region"
    aria-label={typeof countText === "string" ? countText : undefined}
    data-count={count}
    sx={{
      display: "flex",
      alignItems: "center",
      gap: 1.5,
      flexWrap: "wrap",
      minHeight: 48,
      px: 2,
      py: 1,
      borderRadius: 1,
      bgcolor: "action.hover",
    }}
  >
    <MuiTypography variant="subtitle2" component="span">
      {countText}
    </MuiTypography>
    <MuiButton variant="text" size="small" onClick={onClear}>
      {clearLabel}
    </MuiButton>
    {hint !== undefined && (
      <MuiTypography
        variant="body2"
        component="span"
        sx={{ color: "text.secondary" }}
      >
        {hint}
      </MuiTypography>
    )}
    {actions !== undefined && (
      <MuiBox sx={{ ml: "auto", display: "flex", gap: 1 }}>{actions}</MuiBox>
    )}
  </MuiBox>
);
