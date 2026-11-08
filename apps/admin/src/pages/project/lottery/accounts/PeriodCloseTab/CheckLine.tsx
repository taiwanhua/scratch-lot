import type { ReactNode } from "react";

import { Box } from "@repo/ui/box";
import { CheckIcon, ErrorCircleIcon } from "@repo/ui/icons";
import { Stack } from "@repo/ui/stack";

/** 檢查清單的一項:✓ 通過、✕ 擋下、! 只警告。 */
export const CheckLine = ({
  state,
  children,
}: {
  state: "ok" | "blocked" | "warning";
  children: ReactNode;
}) => {
  const colors = {
    ok: "success.main",
    blocked: "error.main",
    warning: "warning.main",
  } as const;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
      <Box sx={{ color: colors[state], display: "flex", pt: "2px" }}>
        {state === "ok" ? (
          <CheckIcon fontSize="small" />
        ) : (
          <ErrorCircleIcon fontSize="small" />
        )}
      </Box>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Stack>
  );
};
