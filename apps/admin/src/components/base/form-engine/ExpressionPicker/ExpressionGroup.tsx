import type { ReactNode } from "react";

import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

export interface ExpressionGroupProps {
  /** 標頭(運算子名,例:「且」「如果…則…否則」) */
  title: string;
  /** 群組內容:運算子下拉與各參數 */
  children: ReactNode;
}

/**
 * 表達式選擇器的**巢狀群組框**(Spec 6a §5 表 B 末段:巢狀運算子畫成帶框縮排群組,標頭是運算子名):
 * 外框 + 標頭 + 縮排的內容。純外觀,不知道表達式;明細列的列內公式也用它。
 */
export const ExpressionGroup = ({ title, children }: ExpressionGroupProps) => (
  <Box
    role="group"
    aria-label={title}
    sx={{
      border: 1,
      borderColor: "divider",
      borderRadius: 1,
      px: 1.5,
      py: 1,
    }}
  >
    <Typography
      variant="caption"
      color="text.secondary"
      component="div"
      sx={{ mb: 1 }}
    >
      {title}
    </Typography>
    <Stack spacing={1} sx={{ pl: 1 }}>
      {children}
    </Stack>
  </Box>
);
