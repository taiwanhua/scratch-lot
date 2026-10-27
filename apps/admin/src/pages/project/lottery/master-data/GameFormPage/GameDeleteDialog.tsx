import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Typography } from "@repo/ui/typography";

import type { MasterDataErrorCode } from "../master-data-error";

export interface GameDeleteDialogProps {
  gameName: string;
  isSubmitting: boolean;
  errorCode: MasterDataErrorCode | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 刪除遊戲的確認(只有一兩句話:手機也維持置中小視窗,RW-04)。 */
export const GameDeleteDialog = ({
  gameName,
  isSubmitting,
  errorCode,
  onCancel,
  onConfirm,
}: GameDeleteDialogProps) => {
  const t = useTranslations("admin.lotteryMasterData");
  return (
    <Dialog
      open
      onClose={onCancel}
      maxWidth="xs"
      title={t("gameForm.deleteDialog.title")}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t("gameForm.deleteDialog.cancel")}
          </Button>
          <Button color="error" disabled={isSubmitting} onClick={onConfirm}>
            {t("gameForm.deleteDialog.confirm")}
          </Button>
        </>
      }
    >
      {errorCode !== null && (
        <Alert severity="error">{t(`errors.${errorCode}`)}</Alert>
      )}
      <Typography variant="body2">
        {t("gameForm.deleteDialog.body", { name: gameName })}
      </Typography>
    </Dialog>
  );
};
