import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Typography } from "@repo/ui/typography";

export interface ConfirmDeleteDialogProps {
  title: string;
  message: string;
  /** 確定鍵的文字(預設同標題) */
  confirmLabel?: string;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 班表管理的刪除確認(只有一兩句話的確認視窗:手機也維持置中的小視窗,規格 16.0)。
 */
export const ConfirmDeleteDialog = ({
  title,
  message,
  confirmLabel,
  isPending,
  onConfirm,
  onCancel,
}: ConfirmDeleteDialogProps) => {
  const tCommon = useTranslations("admin.schedule.common");
  return (
    <Dialog
      open
      maxWidth="xs"
      onClose={onCancel}
      title={title}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {tCommon("cancel")}
          </Button>
          <Button color="error" disabled={isPending} onClick={onConfirm}>
            {confirmLabel ?? title}
          </Button>
        </>
      }
    >
      <Typography>{message}</Typography>
    </Dialog>
  );
};
