import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { RootOrgNotice } from "@/components/base/RootOrgNotice/RootOrgNotice";

import type { NotificationSettingsErrorCode } from "./notification-settings-error";

export interface ResetDefaultDialogProps {
  /** 已換成目前語系的類型名稱 */
  typeName: string;
  /** 還原後會套用的預設收件人(類型宣告的人員條件摘要);當事人通知沒有 = null */
  defaultAudienceSummary: string | null;
  /** 還原後會套用的預設提醒時間(摘要);沒宣告可調時間 = null */
  defaultScheduleSummary: string | null;
  isSubmitting: boolean;
  errorCode: NotificationSettingsErrorCode | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * 還原預設的確認(確認類彈窗,不進網址;REACT-14):這個類型可調的部分(收件人、提醒時間)全部改回
 * 類型宣告的預設,逐行寫出還原後的值。只還原其中一塊在編輯框裡各自的 [還原預設]。
 */
export const ResetDefaultDialog = ({
  typeName,
  defaultAudienceSummary,
  defaultScheduleSummary,
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
        {defaultAudienceSummary !== null && (
          <Typography variant="body2">
            {t("audienceLine", { audience: defaultAudienceSummary })}
          </Typography>
        )}
        {defaultScheduleSummary !== null && (
          <Typography variant="body2">
            {t("scheduleLine", { schedule: defaultScheduleSummary })}
          </Typography>
        )}
        <Typography variant="body2" color="textSecondary">
          {t("body")}
        </Typography>
        {errorCode === "TENANT_ONLY" && (
          <RootOrgNotice variant="inline" message={tErrors(errorCode)} />
        )}
        {errorCode !== null && errorCode !== "TENANT_ONLY" && (
          <Alert severity="error">{tErrors(errorCode)}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
