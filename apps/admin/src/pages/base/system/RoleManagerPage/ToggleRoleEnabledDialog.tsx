import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { RoleManagerErrorCode } from "./role-manager-error";
import type { RoleRow } from "./role-manager-types";

export interface ToggleRoleEnabledDialogProps {
  role: RoleRow;
  isSubmitting: boolean;
  errorCode: RoleManagerErrorCode | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * 停用 / 啟用角色確認。停用後持有者的這個角色立即不生效(PermissionResolver 排除
 * `enabled=false`,ADR-0011 步驟 2),授予本身不動;種子角色與租戶副本照樣可停用(可逆)。
 * api 目前沒有「不能停用自己正在用的角色」這類保護,UI 也不自行加限制。
 */
export const ToggleRoleEnabledDialog = ({
  role,
  isSubmitting,
  errorCode,
  onCancel,
  onConfirm,
}: ToggleRoleEnabledDialogProps) => {
  const t = useTranslations("admin.roleManager.toggle");
  const tErrors = useTranslations("admin.roleManager.errors");
  const isDisabling = role.enabled;

  return (
    <Dialog
      open
      onClose={onCancel}
      fullWidth
      maxWidth="xs"
      title={
        isDisabling
          ? t("disableTitle", { name: role.name })
          : t("enableTitle", { name: role.name })
      }
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button
            color={isDisabling ? "error" : "primary"}
            disabled={isSubmitting}
            onClick={onConfirm}
          >
            {isDisabling ? t("confirmDisable") : t("confirmEnable")}
          </Button>
        </>
      }
    >
      <Stack spacing={2}>
        <Typography variant="body2">
          {isDisabling ? t("disableBody") : t("enableBody")}
        </Typography>
        {errorCode !== null && (
          <Alert severity="error">{tErrors(errorCode)}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
