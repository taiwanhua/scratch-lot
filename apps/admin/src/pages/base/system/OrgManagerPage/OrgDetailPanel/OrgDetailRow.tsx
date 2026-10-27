import type { ReactNode } from "react";

import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

export interface OrgDetailRowProps {
  label: string;
  children: ReactNode;
}

/** 資料區的一列(Figma 87:256 起):左欄 120 寬的欄位名 + 右欄內容,上方一條分隔線。 */
export const OrgDetailRow = ({ label, children }: OrgDetailRowProps) => (
  <Stack
    direction="row"
    spacing={2}
    sx={{
      alignItems: "center",
      py: 1.25,
      borderTop: 1,
      borderColor: "divider",
    }}
  >
    <Typography
      variant="subtitle2"
      color="textSecondary"
      sx={{ width: 120, flexShrink: 0 }}
    >
      {label}
    </Typography>
    <Stack sx={{ flex: 1, minWidth: 0 }}>{children}</Stack>
  </Stack>
);
