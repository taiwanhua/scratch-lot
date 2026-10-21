import type { ReactNode } from "react";

import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

export interface ReadOnlyFieldProps {
  label: string;
  children: ReactNode;
}

/** 詳情頁的一個唯讀欄位(上方小標、下方值;放在 `FieldGrid` 的格子裡)。 */
export const ReadOnlyField = ({ label, children }: ReadOnlyFieldProps) => (
  <Stack spacing={0.25} sx={{ minWidth: 0 }}>
    <Typography variant="caption" color="text.secondary">
      {label}
    </Typography>
    {typeof children === "string" ? (
      <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
        {children}
      </Typography>
    ) : (
      children
    )}
  </Stack>
);
