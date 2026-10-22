import type { ReactNode } from "react";

import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

export interface DemoFieldRowProps {
  label: string;
  children: ReactNode;
}

/**
 * 詳情頁的一列欄位(Figma 177:494 起:左欄名 90 寬、次要色,右內容)。
 * 內容是 slot,所以標籤、圖片、連結這類複合內容由設定物件的 `render` 組(REACT-05)。
 */
export const DemoFieldRow = ({ label, children }: DemoFieldRowProps) => (
  <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
    <Typography
      variant="body2"
      color="textSecondary"
      sx={{ width: 90, flexShrink: 0 }}
    >
      {label}
    </Typography>
    {typeof children === "string" ? (
      <Typography variant="body2">{children}</Typography>
    ) : (
      children
    )}
  </Stack>
);
