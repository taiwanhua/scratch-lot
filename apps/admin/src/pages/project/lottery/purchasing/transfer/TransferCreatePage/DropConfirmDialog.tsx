import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Typography } from "@repo/ui/typography";

export interface DropConfirmDialogProps {
  /** 哪些在途的張會變成待查(`useShippedLines().confirmText`) */
  text: string;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 編輯頁送出前確認:取消勾選 / 整列移除在途的張,送出後會變成待查(規格 8.4)。 */
export const DropConfirmDialog = ({
  text,
  isPending,
  onCancel,
  onConfirm,
}: DropConfirmDialogProps) => {
  const tEdit = useTranslations("admin.lotteryPurchasing.transfer.edit");
  return (
    <Dialog
      open
      onClose={onCancel}
      fullWidth
      maxWidth="xs"
      title={tEdit("dropConfirm.title")}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {tEdit("dropConfirm.cancel")}
          </Button>
          <Button disabled={isPending} onClick={onConfirm}>
            {tEdit("dropConfirm.confirm")}
          </Button>
        </>
      }
    >
      <Typography variant="body2">{text}</Typography>
    </Dialog>
  );
};
