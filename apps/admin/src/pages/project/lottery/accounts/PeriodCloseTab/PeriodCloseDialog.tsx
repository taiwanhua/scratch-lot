import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type LotteryPeriodCloseCheckQuery,
  useCloseLotteryPeriodMutation,
  useLotteryPeriodCloseCheckQuery,
  useLotteryPeriodClosesQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { CheckIcon, ErrorCircleIcon } from "@repo/ui/icons";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { accountsErrorOf } from "@/lib/project/lottery/accounts-error";

import { PeriodSnapshotList } from "./PeriodSnapshotList";

type Check = LotteryPeriodCloseCheckQuery["lotteryPeriodCloseCheck"];

/** 檢查清單的一項:✓ 通過、✕ 擋下、! 只警告。 */
const CheckLine = ({
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

/**
 * 關帳彈窗(Figma AC-07 93:1664;規格 10.4):檢查清單(班都已結帳、沒有審核中且會記到那個月的單據 —— 擋;
 * 每一班都被日結涵蓋計算 —— 只警告、記入快照)+ 快照預覽 + 輸入月份確認。輸入的月份要相同、而且沒有擋下的項目,
 * [關帳] 才能按;手機全螢幕(有表單欄位的彈窗)。
 */
export const PeriodCloseDialog = ({
  month,
  onClose,
}: {
  month: string;
  onClose: () => void;
}) => {
  const t = useTranslations("admin.lotteryAccounts");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const query = useLotteryPeriodCloseCheckQuery(session.client, { month });
  const check = query.data?.lotteryPeriodCloseCheck;
  const [confirm, setConfirm] = useState("");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const close = useCloseLotteryPeriodMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.closeSuccess"),
      error: (error: unknown) => t(`errors.${accountsErrorOf(error).code}`),
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: useLotteryPeriodClosesQuery.getKey().slice(0, 1),
        });
        onClose();
      },
      onError: (error: unknown) => {
        setErrorCode(accountsErrorOf(error).code);
      },
    }),
  );
  const canSubmit =
    check?.canClose === true && confirm.trim() === month && !close.isPending;
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      fullScreen={isMobile}
      title={t("periodClose.dialog.title", { month })}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("periodClose.dialog.cancel")}
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => {
              close.mutate({
                input: { month, confirmMonth: confirm.trim(), note: null },
              });
            }}
          >
            {t("periodClose.dialog.submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {errorCode !== null && (
          <Alert severity="error">{t(`errors.${errorCode}`)}</Alert>
        )}
        {check !== undefined && <Checklist check={check} month={month} />}
        {check !== undefined && (
          <PeriodSnapshotList
            snapshot={check.snapshot}
            title={t("periodClose.dialog.snapshotTitle")}
          />
        )}
        <TextField
          label={t("periodClose.dialog.confirmLabel")}
          value={confirm}
          placeholder={month}
          helperText={t("periodClose.dialog.confirmHelper", { month })}
          onChange={(event) => {
            setConfirm(event.target.value);
            setErrorCode(null);
          }}
        />
      </Stack>
    </Dialog>
  );
};

/** 檢查清單三項(規格 10.4)。 */
const Checklist = ({ check, month }: { check: Check; month: string }) => {
  const t = useTranslations("admin.lotteryAccounts.periodClose");
  const uncovered = check.snapshot.stores.filter(
    (store) => store.uncoveredShifts.length > 0,
  );
  return (
    <Stack spacing={1}>
      <CheckLine state={check.openShifts.length === 0 ? "ok" : "blocked"}>
        <Typography variant="body2">
          {check.openShifts.length === 0
            ? t("dialog.shiftsOk")
            : t("dialog.shiftsBlocked", {
                count: check.openShifts.length,
                list: check.openShifts
                  .map((shift) => `${shift.orgName} ${shift.label}`)
                  .join(t("listSeparator")),
              })}
        </Typography>
      </CheckLine>
      <CheckLine state={check.pendingDocuments.length === 0 ? "ok" : "blocked"}>
        <Typography variant="body2">
          {check.pendingDocuments.length === 0
            ? t("dialog.documentsOk", {
                monthNumber: Number(month.slice(5)),
              })
            : t("dialog.documentsBlocked", {
                count: check.pendingDocuments.length,
              })}
        </Typography>
        {check.pendingDocuments.map((document) => (
          <Typography
            key={document.submissionId}
            variant="body2"
            color="text.secondary"
          >
            {t("documentLine", {
              kind: t(`documentKinds.${document.kind}`),
              serial:
                document.serialNo == null
                  ? document.orgName
                  : `#${document.serialNo}`,
              shift:
                document.shiftLabel == null
                  ? ""
                  : t("documentShift", { shift: document.shiftLabel }),
            })}
          </Typography>
        ))}
      </CheckLine>
      <CheckLine state={uncovered.length === 0 ? "ok" : "warning"}>
        <Typography variant="body2">
          {uncovered.length === 0
            ? t("dialog.coverageOk")
            : t("dialog.coverageWarning", {
                list: uncovered
                  .map((store) =>
                    t("dialog.coverageStore", {
                      store: store.name,
                      count: store.uncoveredShifts.length,
                    }),
                  )
                  .join(t("listSeparator")),
              })}
        </Typography>
      </CheckLine>
    </Stack>
  );
};
