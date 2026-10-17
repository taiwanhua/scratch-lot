import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { NotificationSettingsErrorCode } from "./notification-settings-error";

export interface ResetDefaultDialogProps {
  /** 已換成目前語系的類型名稱 */
  typeName: string;
  /** 還原後會套用的預設收件人(類型宣告的人員條件摘要) */
  defaultSummary: string;
  isSubmitting: boolean;
  errorCode: NotificationSettingsErrorCode | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * 還原預設的確認(確認類彈窗,不進網址;REACT-14):調整過的收件人會被丟掉、改回類型宣告的預設條件。
 */
export const ResetDefaultDialog = ({
  typeName,
  defaultSummary,
  isSubmitting,
  errorCode,
  onCancel,
  onConfirm,
}: ResetDefaultDialogProps) => {
  const t = useTranslations("admin.notificationSettings.reset");
  const tErrors = useTranslations("admin.notificationSettings.errors");

  return (
    <Dialog
      open
      onClose={onCancel}
      fullWidth
      maxWidth="xs"
      title={t("title", { name: typeName })}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button disabled={isSubmitting} onClick={onConfirm}>
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={2}>
        <Typography variant="body2">
          {t("body", { audience: defaultSummary })}
        </Typography>
        {errorCode !== null && (
          <Alert severity="error">{tErrors(errorCode)}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
