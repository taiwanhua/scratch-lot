import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

export interface ConfirmDeleteDialogProps {
  title: string;
  message: string;
  /** 確定鍵的文字(預設同標題) */
  confirmLabel?: string;
  isPending: boolean;
  /** 確認句下方的欄位(例:代改畫休截止後的原因);不給 = 只有一句話 */
  children?: ReactNode;
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
  children,
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
      {children === undefined ? (
        <Typography>{message}</Typography>
      ) : (
        <Stack spacing={2}>
          <Typography>{message}</Typography>
          {children}
        </Stack>
      )}
    </Dialog>
  );
};
