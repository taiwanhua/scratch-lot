import { useTranslations } from "use-intl";

import { PrintJobError } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { CheckCircleIcon, ErrorCircleIcon } from "@repo/ui/icons";
import { Typography } from "@repo/ui/typography";

import type { PrintPhase } from "./usePrintJob";

export interface PrintStatusProps {
  phase: PrintPhase;
  /** 這張單據已印的次數(沒在列印時顯示「已印 N 次」)。 */
  printedCount: number;
}

const LINE_SX = { display: "flex", alignItems: "center", gap: 0.5 } as const;

/**
 * 按鈕右邊的進度文字(Figma `Draft/PrintButton`):
 * 已送到印表機… → ✓ 已印出 / ✗ 失敗:<原因>;平常印過的單據顯示「已印 N 次」。
 * 「未收到列印結果」可能已經出紙,另起一行提示先確認再決定要不要補印。
 * 以 `role="status"` 包住,進度變了螢幕閱讀器會念。
 */
export const PrintStatus = ({ phase, printedCount }: PrintStatusProps) => {
  const t = useTranslations("admin.printButton");
  // 失敗原因的文案與印表機管理頁(列印紀錄、測試列印)同一份
  const tJobError = useTranslations("admin.printers.jobError");
  const error =
    phase.kind === "failed" ? (phase.error ?? PrintJobError.Other) : null;

  return (
    <Box role="status">
      {phase.kind === "sending" ? (
        <Typography variant="body2" color="textSecondary">
          {t("sending")}
        </Typography>
      ) : null}
      {phase.kind === "printed" ? (
        <Box sx={LINE_SX}>
          <CheckCircleIcon fontSize="small" sx={{ color: "success.main" }} />
          <Typography variant="body2" color="textSecondary">
            {t("printed")}
          </Typography>
        </Box>
      ) : null}
      {error === null ? null : (
        <>
          <Box sx={LINE_SX}>
            <ErrorCircleIcon fontSize="small" sx={{ color: "error.main" }} />
            <Typography variant="body2">
              {t("failed", { reason: tJobError(error) })}
            </Typography>
          </Box>
          {error === PrintJobError.NoResult ? (
            <Typography variant="caption" color="textSecondary">
              {t("noResultHint")}
            </Typography>
          ) : null}
        </>
      )}
      {phase.kind === "idle" && printedCount > 0 ? (
        <Typography variant="body2" color="textSecondary">
          {t("printedCount", { count: printedCount })}
        </Typography>
      ) : null}
    </Box>
  );
};
