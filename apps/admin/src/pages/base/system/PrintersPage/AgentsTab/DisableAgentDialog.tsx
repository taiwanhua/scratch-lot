import { useTranslations } from "use-intl";

import {
  type PrintAgentFieldsFragment,
  useDisablePrintAgentMutation,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import { printersErrorOf } from "../printers-error";
import { useInvalidatePrinters } from "../usePrintersLookups";

export interface DisableAgentDialogProps {
  agent: PrintAgentFieldsFragment;
  onClose: () => void;
}

/**
 * [停用] 的確認:金鑰失效、旗下印表機在列印按鈕上不可選、
 * 等待中與已送出的工作標失敗。停用是終態 —— 不能重新配對、不能再啟用,要再用就新增代理程式。
 */
export const DisableAgentDialog = ({
  agent,
  onClose,
}: DisableAgentDialogProps) => {
  const t = useTranslations("admin.printers.disableAgent");
  const tErrors = useTranslations("admin.printers.errors");
  const { session } = useSession();
  const invalidate = useInvalidatePrinters();

  const disable = useDisablePrintAgentMutation(
    session.client,
    useMutationFeedback({
      success: t("success"),
      error: (error) => tErrors(printersErrorOf(error).code),
      onSuccess: () => {
        void invalidate();
        onClose();
      },
    }),
  );

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      title={t("title", { name: agent.name })}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            color="error"
            disabled={disable.isPending}
            onClick={() => {
              disable.mutate({ input: { id: agent.id } });
            }}
          >
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Typography variant="body2">{t("body")}</Typography>
    </Dialog>
  );
};
