import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useModuleRoutes } from "@/hooks/base/useModuleRoutes";
import { ROLE_MANAGER_MODULE_KEY } from "@/pages/base/system/RoleManagerPage/role-manager-permissions";

export interface PublishedGrantDialogProps {
  formName: string;
  version: number;
  /** 這次發布新建的依表單新增權限名稱(「<表單名> 新增」) */
  permissionName: string;
  onClose: () => void;
}

/**
 * 發布成功、且這次發布新建了依表單新增權限時的提示:權限**不會自動授予**,
 * 請到角色管理授予需要的角色。沒有角色管理(沒權限)→ 只有 [稍後],不給連結(ADR-0011)。
 */
export const PublishedGrantDialog = ({
  formName,
  version,
  permissionName,
  onClose,
}: PublishedGrantDialogProps) => {
  const t = useTranslations("admin.forms.publish.granted");
  const navigate = useNavigate();
  const roleManagerRoute = useModuleRoutes()(ROLE_MANAGER_MODULE_KEY);

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      title={t("title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("later")}
          </Button>
          {roleManagerRoute !== null && (
            <Button
              onClick={() => {
                onClose();
                void navigate(roleManagerRoute);
              }}
            >
              {t("goToRoles")}
            </Button>
          )}
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2">
          {t("body", { form: formName, version })}
        </Typography>
        <Alert severity="warning">
          {t("hint", { permission: permissionName })}
        </Alert>
      </Stack>
    </Dialog>
  );
};
