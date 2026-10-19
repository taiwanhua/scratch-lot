"use client";

import MuiDialog, {
  type DialogProps as MuiDialogProps,
} from "@mui/material/Dialog";
import MuiDialogActions from "@mui/material/DialogActions";
import MuiDialogContent from "@mui/material/DialogContent";
import MuiDialogTitle from "@mui/material/DialogTitle";
import type { ReactNode } from "react";

/** `title` 在 MUI 是 DOM 的 `title` 屬性(string),這裡改成插槽,所以先 Omit 掉。 */
export interface DialogProps extends Omit<MuiDialogProps, "title"> {
  /** 標題插槽;省略則不渲染標題列。 */
  title?: ReactNode;
  /** 動作插槽(按鈕列,靠右);省略則不渲染動作列。 */
  actions?: ReactNode;
}

/**
 * 彈窗(Figma Components / Dialog 70:221:Draft/ConfirmDialog 57:712、Draft/HelpDialog 95:235)。
 * 圓角與陰影由 theme 的 MuiDialog 覆寫供給;這裡只補 Figma 的內距節奏
 * (上 24 / 左右 24 / 下 20,標題與內文間距 12,動作列上方再 8;沒有動作列時內文自己留下 20)。
 * children 一律被包進 DialogContent — 內文用預設 body2 + text.secondary。
 */
export const Dialog = ({ title, actions, children, ...rest }: DialogProps) => (
  <MuiDialog {...rest}>
    {title === undefined ? null : (
      <MuiDialogTitle sx={{ px: 3, pt: 3, pb: 0, typography: "h6" }}>
        {title}
      </MuiDialogTitle>
    )}
    <MuiDialogContent
      sx={{
        // MUI 自己有一條 `.MuiDialogTitle-root + .MuiDialogContent-root { padding-top: 0 }`,
        // 兩個 class 的特異度贏過 `sx` 的單一 class,上內距會被吃成 0;內容區又是
        // `overflow-y: auto`,於是第一個 TextField 的浮動標籤被標題壓住兼裁掉。
        // `&&` 把選擇器變成兩個 class,特異度打平後由後注入的 `sx` 勝出,間距節奏才留得住。
        // 沒有動作列時(按鈕放在內文裡,如列表欄位配置的編輯器),下內距補成與動作列相同的 20,
        // 最後一排按鈕才不會貼齊彈窗底邊
        "&&": { px: 3, pt: 1.5, pb: actions === undefined ? 2.5 : 0 },
        typography: "body2",
        color: "text.secondary",
      }}
    >
      {children}
    </MuiDialogContent>
    {actions === undefined ? null : (
      <MuiDialogActions sx={{ px: 3, pt: 2.5, pb: 2.5 }}>
        {actions}
      </MuiDialogActions>
    )}
  </MuiDialog>
);
