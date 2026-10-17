import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type PrintAgentFieldsFragment,
  PrintJobError,
  type PrinterFieldsFragment,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useTemporalText } from "@/hooks/base/useTemporalText";

import { TestPageReceipt } from "./TestPageReceipt";
import { type TestPrintOutcome, useTestPrint } from "./useTestPrint";

export interface TestPrintDialogProps {
  printer: PrinterFieldsFragment;
  /** 印表機掛的代理程式(離線時顯示最後連線時間);對照表還沒載到為 undefined */
  agent: PrintAgentFieldsFragment | undefined;
  onClose: () => void;
}

/**
 * [測試列印](底座規格「測試頁」;Figma BS-18a 成功 / BS-18b 缺紙 / BS-18c 離線):
 * 開窗就送出測試頁,結果顯示在對話框裡 —— 成功提示核對項目;失敗顯示原因與 [重試]。
 */
export const TestPrintDialog = ({
  printer,
  agent,
  onClose,
}: TestPrintDialogProps) => {
  const t = useTranslations("admin.printers.testPrint");
  const tJobError = useTranslations("admin.printers.jobError");
  const tErrors = useTranslations("admin.printers.errors");
  const temporalText = useTemporalText();
  const [receipt, setReceipt] = useState<HTMLDivElement | null>(null);
  const { outcome, retry } = useTestPrint(printer.id, receipt);

  const failureText = (
    result: Extract<TestPrintOutcome, { kind: "failed" }>,
  ): string => {
    if (result.error === PrintJobError.PaperOut) {
      return t("paperOut");
    }
    if (result.error === PrintJobError.AgentOffline) {
      const lastSeenAt = agent?.lastSeenAt;
      return lastSeenAt === null || lastSeenAt === undefined
        ? t("agentOfflineNever")
        : t("agentOffline", {
            lastSeenAt: temporalText(lastSeenAt, "datetime"),
          });
    }
    return t("failed", {
      reason: tJobError(result.error ?? PrintJobError.Other),
    });
  };

  const isRetryable = outcome.kind === "failed" || outcome.kind === "rejected";

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      title={t("title", { name: printer.name })}
      actions={
        <>
          {isRetryable && (
            <Button variant="text" onClick={onClose}>
              {t("close")}
            </Button>
          )}
          {isRetryable ? (
            <Button onClick={retry}>{t("retry")}</Button>
          ) : (
            <Button onClick={onClose}>{t("close")}</Button>
          )}
        </>
      }
    >
      <TestPageReceipt printer={printer} receiptRef={setReceipt} />
      {outcome.kind === "printing" && (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <CircularProgress size={20} />
          <Typography variant="body2" role="status">
            {outcome.isSent ? t("sent") : t("sending")}
          </Typography>
        </Stack>
      )}
      {outcome.kind === "printed" && (
        <Alert severity="success">{t("printed")}</Alert>
      )}
      {outcome.kind === "failed" && (
        <Alert
          severity={
            outcome.error === PrintJobError.PaperOut ? "warning" : "error"
          }
        >
          {failureText(outcome)}
        </Alert>
      )}
      {outcome.kind === "rejected" && (
        <Alert severity="error">
          {t("rejected", { reason: tErrors(outcome.code) })}
        </Alert>
      )}
    </Dialog>
  );
};
