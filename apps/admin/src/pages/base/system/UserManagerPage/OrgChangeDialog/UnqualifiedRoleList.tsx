import { useTranslations } from "use-intl";

import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import type { UnqualifiedRole } from "./unqualified-roles";

export interface UnqualifiedRoleListProps {
  roles: readonly UnqualifiedRole[];
}

/**
 * 失去資格的角色逐筆清單:角色(擁有組織)+ 每個原因一條
 * (`OWNED_BY_REMOVED_ORG` / `NO_REMAINING_SUBTREE_SUPPORT` 可同時成立);
 * 受擁有者保護的那筆另外標示「不會被解除」。
 */
export const UnqualifiedRoleList = ({ roles }: UnqualifiedRoleListProps) => {
  const t = useTranslations("admin.userManager.orgChange");

  if (roles.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary">
        {t("noneAffected")}
      </Typography>
    );
  }

  return (
    <Stack component="ul" spacing={1} sx={{ m: 0, pl: 2.5 }}>
      {roles.map((role) => (
        <Stack component="li" key={role.roleId} spacing={0.25}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Typography variant="subtitle2">
              {t("roleWithOrg", {
                role: role.roleName,
                org: role.ownerOrgName ?? role.ownerOrgId ?? "",
              })}
            </Typography>
            {role.ownerProtected && (
              <Tag
                tone="warning"
                label={t("protected", { role: role.roleName })}
              />
            )}
          </Stack>
          {role.reasons.map((reason) => (
            <Typography key={reason} variant="caption" color="textSecondary">
              {t(`reasons.${reason}`)}
            </Typography>
          ))}
        </Stack>
      ))}
    </Stack>
  );
};
