import { useTranslations } from "use-intl";

import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { roleOptionLabel } from "@/lib/base/role-options";

import type { RoleOption } from "./assignable-roles";

export interface RoleOptionListProps {
  /** 目前選中的角色(照選擇器的順序) */
  roles: readonly RoleOption[];
}

/**
 * 已選角色的狀態清單(取代原本每一列一個勾選框的 `RoleOptionRow`)。
 *
 * 選取本身由 `@repo/ui/autocomplete` 負責,但**選中的 chip 只放得下一行字**,
 * 而「組織外 / 已停用 / 租戶副本 / 管理範圍外」這幾件事在按下儲存前必須看得到 ——
 * 尤其管理範圍外的既有授予:它拔不掉,使用者要知道為什麼這個 chip 沒有關閉鈕。
 */
export const RoleOptionList = ({ roles }: RoleOptionListProps) => {
  const t = useTranslations("admin.userManager.assignRoles");

  if (roles.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary">
        {t("noneSelected")}
      </Typography>
    );
  }

  return (
    <Stack spacing={0}>
      {roles.map((role) => (
        <Stack
          key={role.id}
          direction="row"
          spacing={1}
          sx={{
            alignItems: "center",
            py: 0.75,
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Typography variant="subtitle2">
            {roleOptionLabel(role.name, role.ownerOrgName)}
          </Typography>
          {role.isOutOfScope && <Tag tone="warning" label={t("outOfScope")} />}
          {!role.enabled && <Tag tone="error" label={t("roleDisabled")} />}
          {role.isTemplateCopy && <Tag tone="grey" label={t("templateCopy")} />}
          {role.isOutOfReach && <Tag tone="grey" label={t("outOfReach")} />}
          {role.description !== null && role.description !== "" && (
            <Typography
              variant="caption"
              color="textDisabled"
              sx={{ flex: 1, minWidth: 0 }}
            >
              {role.description}
            </Typography>
          )}
        </Stack>
      ))}
    </Stack>
  );
};
