import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type {
  RoleManagerErrorCode,
  RoleNotDeletableReason,
  RoleReference,
} from "./role-manager-error";
import type { RoleRow } from "./role-manager-types";

export interface DeleteRoleDialogProps {
  role: RoleRow;
  isSubmitting: boolean;
  errorCode: RoleManagerErrorCode | null;
  /** `ROLE_NOT_DELETABLE` 時 api 逐項回報為什麼不能刪 */
  reasons: readonly RoleNotDeletableReason[];
  /** `REFERENCED_BY_AUDIENCE` 時 api 帶回的引用處,列在該原因底下 */
  references: readonly RoleReference[];
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * 刪除確認(Figma 57:720)。四個前置檢查(無授予 / 非種子角色 / 非租戶副本 / 沒被人員條件引用)在 api,
 * 前端不預判 — 送出後收到 `ROLE_NOT_DELETABLE` 才把 `reasons` 攤成清單並提示改用停用;
 * 被人員條件引用時,引用處(`references`)逐項列在那個原因底下。
 */
export const DeleteRoleDialog = ({
  role,
  isSubmitting,
  errorCode,
  reasons,
  references,
  onCancel,
  onConfirm,
}: DeleteRoleDialogProps) => {
  const t = useTranslations("admin.roleManager.delete");
  const tForm = useTranslations("admin.roleManager.form");
  const tErrors = useTranslations("admin.roleManager.errors");
  const isBlocked = reasons.length > 0;

  return (
    <Dialog
      open
      onClose={onCancel}
      fullWidth
      maxWidth="xs"
      title={t("title", { name: role.name })}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {isBlocked ? t("close") : tForm("cancel")}
          </Button>
          {!isBlocked && (
            <Button color="error" disabled={isSubmitting} onClick={onConfirm}>
              {t("confirm")}
            </Button>
          )}
        </>
      }
    >
      <Stack spacing={2}>
        {isBlocked ? (
          <>
            <Typography variant="body2">{t("blocked")}</Typography>
            <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 3 }}>
              {reasons.map((reason) => (
                <Typography key={reason} component="li" variant="body2">
                  {t(`reasons.${reason}`)}
                  {reason === "REFERENCED_BY_AUDIENCE" &&
                    references.length > 0 && (
                      <Stack
                        component="ul"
                        spacing={0.25}
                        sx={{ mt: 0.5, mb: 0, pl: 2.5 }}
                      >
                        {references.map((reference) => (
                          <Typography
                            key={`${reference.kind}:${reference.name}:${reference.stepName ?? ""}`}
                            component="li"
                            variant="body2"
                          >
                            {t(`references.${reference.kind}`, {
                              name: reference.name,
                              step: reference.stepName ?? "",
                            })}
                          </Typography>
                        ))}
                      </Stack>
                    )}
                </Typography>
              ))}
            </Stack>
            <Alert severity="info">{t("useDisableInstead")}</Alert>
          </>
        ) : (
          <Typography variant="body2">{t("body")}</Typography>
        )}
        {errorCode !== null && !isBlocked && (
          <Alert severity="error">{tErrors(errorCode)}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
