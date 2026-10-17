import { useTranslations } from "use-intl";

import { useRetireCurrentVersionMutation } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { formErrorOf } from "@/lib/base/form-engine/form-errors";

export interface RetireDialogProps {
  formKey: string;
  /** 打開跳窗時看到的目前版本:期間有人發布了新版 → 409,不會誤退新版 */
  expectedVersion: number;
  onClose: () => void;
  onRetired: () => void;
}

/**
 * 退役目前版本(Spec 6a §6 `retireCurrentVersion`):已發布版改退役、`currentVersion → null`;
 * 之後**所有租戶**都不能新增這張表單,直到再發布新版。既有資料照常可看、既有草稿仍可送出。
 */
export const RetireDialog = ({
  formKey,
  expectedVersion,
  onClose,
  onRetired,
}: RetireDialogProps) => {
  const t = useTranslations("admin.forms.retire");
  const tErrors = useTranslations("admin.forms.errors");
  const { session } = useSession();
  const retire = useRetireCurrentVersionMutation(
    session.client,
    useMutationFeedback({
      success: t("success"),
      error: (failure) => tErrors(formErrorOf(failure).code),
      onSuccess: onRetired,
    }),
  );

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
          <Button
            color="error"
            disabled={retire.isPending}
            onClick={() => {
              retire.mutate({ input: { formKey, expectedVersion } });
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
