import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type PrintAgentFieldsFragment,
  type ResetPrintAgentPairingMutation,
  useResetPrintAgentPairingMutation,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Collapse } from "@repo/ui/collapse";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import { PairingInfo } from "../PairingInfo/PairingInfo";
import { printersErrorOf } from "../printers-error";
import { useInvalidatePrinters } from "../usePrintersLookups";

type Pairing = ResetPrintAgentPairingMutation["resetPrintAgentPairing"];

export interface ResetPairingDialogProps {
  agent: PrintAgentFieldsFragment;
  onClose: () => void;
}

/**
 * [重新配對]:先確認(舊金鑰立即失效)→ 顯示新的
 * 伺服器網址與配對碼(10 分鐘);印表機設定保留。確認類彈窗,不進網址(REACT-14)。
 * 已裝好的電腦用安裝包裡的「重新配對.bat」(安裝程式偵測到舊設定會保留舊金鑰);
 * 手動指令收在下方,給 Linux / macOS 或找不到批次檔時用。
 */
export const ResetPairingDialog = ({
  agent,
  onClose,
}: ResetPairingDialogProps) => {
  const t = useTranslations("admin.printers.resetPairing");
  const tErrors = useTranslations("admin.printers.errors");
  const { session } = useSession();
  const invalidate = useInvalidatePrinters();
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  const reset = useResetPrintAgentPairingMutation(
    session.client,
    useMutationFeedback<ResetPrintAgentPairingMutation>({
      success: t("success"),
      error: (error) => tErrors(printersErrorOf(error).code),
      onSuccess: (payload) => {
        setPairing(payload.resetPrintAgentPairing);
        void invalidate();
      },
    }),
  );

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      title={t("title", { name: agent.name })}
      actions={
        pairing === null ? (
          <>
            <Button variant="text" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button
              disabled={reset.isPending}
              onClick={() => {
                reset.mutate({ input: { id: agent.id } });
              }}
            >
              {t("confirm")}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{t("done")}</Button>
        )
      }
    >
      {pairing === null ? (
        <Typography variant="body2">{t("body")}</Typography>
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2">{t("doneBody")}</Typography>
          <PairingInfo
            pairingCode={pairing.pairingCode}
            expiresAt={pairing.pairingExpiresAt}
          />
          <Stack spacing={0.5} sx={{ alignItems: "flex-start" }}>
            <Button
              size="small"
              variant="text"
              aria-expanded={manualOpen}
              onClick={() => {
                setManualOpen((open) => !open);
              }}
            >
              {manualOpen ? t("manualHide") : t("manualShow")}
            </Button>
            <Collapse in={manualOpen}>
              <Typography variant="caption" color="textSecondary">
                {t("manual")}
              </Typography>
            </Collapse>
          </Stack>
        </Stack>
      )}
    </Dialog>
  );
};
