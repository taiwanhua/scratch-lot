"use client";

import MuiDrawer, {
  type DrawerProps as MuiDrawerProps,
} from "@mui/material/Drawer";

import { mergeSx } from "../theme/sx";

export interface NavDrawerProps extends Omit<
  MuiDrawerProps,
  "anchor" | "variant" | "onClose"
> {
  open: boolean;
  /** 點遮罩、按 Esc 時呼叫(呼叫端把 `open` 改回 false) */
  onClose: () => void;
}

/** 紙面排成直欄,內容(側欄)自己決定寬度並撐滿高度 */
const PAPER_SX = { display: "flex", flexDirection: "column" } as const;

/**
 * 從左側滑出的導覽抽屜(暫時性,蓋在畫面上、有遮罩):admin 殼在手機寬(< `sm`)把側欄放進來。
 * 和 `Drawer` 不同,它**沒有**標題列與動作列 —— 內容(側欄本身)自己有頂部識別;
 * 寬度由內容決定,高度撐滿視窗,內容自己排成直欄(側欄的模組樹那一格自己捲)。
 */
export const NavDrawer = ({ children, slotProps, ...rest }: NavDrawerProps) => {
  // 呼叫端給的 paper 設定保留(含 `sx`,疊在本元件的排版之後);只有物件形式能合併,函式形式照原樣交給 MUI
  const paper = slotProps?.paper;
  const mergedPaper =
    typeof paper === "function"
      ? paper
      : {
          ...paper,
          sx: mergeSx(PAPER_SX, paper?.sx),
        };
  return (
    <MuiDrawer
      anchor="left"
      variant="temporary"
      slotProps={{ ...slotProps, paper: mergedPaper }}
      {...rest}
    >
      {children}
    </MuiDrawer>
  );
};
