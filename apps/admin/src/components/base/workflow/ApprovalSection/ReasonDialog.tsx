import { useState } from "react";
import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

export interface ReasonDialogProps {
  /** 文案節點(`admin.approval.<動作>`),底下要有 `title` / `body` / `confirm` / `reason` */
  namespace: "admin.approval.void" | "admin.approval.withdraw";
  /** 理由必填(作廢);撤回不收理由時給 false,輸入框不顯示 */
  requiresReason: boolean;
  isSubmitting: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

/**
 * 申請人的撤回 / 作廢確認跳窗。作廢的理由必填(Spec 6b §6「作廢」),撤回不需要理由。
 */
export const ReasonDialog = ({
  namespace,
  requiresReason,
  isSubmitting,
  errorMessage,
  onCancel,
  onConfirm,
}: ReasonDialogProps) => {
  const t = useTranslations(namespace);
  const tCommon = useTranslations("admin.approval.dialog");
  const [reason, setReason] = useState("");
  const isMissing = requiresReason && reason.trim() === "";

  return (
    <Dialog
      open
      onClose={onCancel}
      fullWidth
      maxWidth="xs"
      title={t("title")}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {tCommon("cancel")}
          </Button>
          <Button
            color="error"
            disabled={isMissing || isSubmitting}
            onClick={() => {
              onConfirm(reason.trim());
            }}
          >
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2">{t("body")}</Typography>
        {requiresReason && (
          <TextField
            label={t("reason")}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
            multiline
            minRows={2}
            required
            size="small"
          />
        )}
        {errorMessage !== null && (
          <Alert severity="error">{errorMessage}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
