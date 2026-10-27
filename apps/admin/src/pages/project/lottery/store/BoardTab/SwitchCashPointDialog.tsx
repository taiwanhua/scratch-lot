import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";

export interface SwitchCashPointDialogProps {
  /** 目前的本機收銀點(有自己開著的班) */
  from: string;
  to: string;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * 切換本機收銀點?(專案規格 6.2;Figma ST-34b 222:14843):這台裝置還有自己開著的班時先確認,
 * 之後的兌獎、投庫、出庫都算到新的收銀點。只有一兩句話,手機也維持置中的小視窗。
 */
export const SwitchCashPointDialog = ({
  from,
  to,
  onClose,
  onConfirm,
}: SwitchCashPointDialogProps) => {
  const t = useTranslations("admin.lotteryStore.switchDialog");
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      title={t("title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={onConfirm}>{t("confirm", { to })}</Button>
        </>
      }
    >
      {t("message", { from, to })}
    </Dialog>
  );
};
