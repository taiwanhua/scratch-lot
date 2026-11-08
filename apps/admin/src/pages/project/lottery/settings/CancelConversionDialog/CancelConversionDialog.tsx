import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Typography } from "@repo/ui/typography";

export interface CancelConversionDialogProps {
  orgName: string;
  isPending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * 取消轉換?(Figma CS-50g;規格 9.2):寫出後果 —— 當下回到張數盤點、未對號記號照常用;
 * 取消轉換等於幫這家店自訂「張數」,之後上層預設再改也不跟著動,要按 [還原] 才恢復沿用。
 */
export const CancelConversionDialog = ({
  orgName,
  isPending,
  onConfirm,
  onClose,
}: CancelConversionDialogProps) => {
  const t = useTranslations("admin.lotterySettings.cancelDialog");
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="xs"
      title={t("title", { org: orgName })}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("back")}
          </Button>
          <Button disabled={isPending} onClick={onConfirm}>
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Typography variant="body2" color="textSecondary">
        {t("body", { org: orgName })}
      </Typography>
    </Dialog>
  );
};
