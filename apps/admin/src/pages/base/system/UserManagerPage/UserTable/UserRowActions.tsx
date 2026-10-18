import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Tooltip } from "@repo/ui/tooltip";

import type { UserActionAbility, UserRow } from "../user-manager-types";

export interface UserRowActionsProps {
  user: UserRow;
  ability: UserActionAbility;
  /**
   * 這一列是受保護的頂層組織擁有者(ADR-0009):**只有「停用」停用並提示**。
   * 「所屬組織」照常可開:api 的 `assertOwnedOrgsKept` 只擋「移出他擁有的
   * 租戶頂層」,加入其他組織一直是允許的 —— 鎖在彈窗裡的那一個節點上。
   */
  isOwnerProtected: boolean;
  /** 沒有組織樹(缺 `system.org-manager.view`)時「所屬組織」無從勾選,一併停用 */
  isOrgTreeAvailable: boolean;
  onEdit: (user: UserRow) => void;
  onManageOrgs: (user: UserRow) => void;
  onAssignRoles: (user: UserRow) => void;
  onToggleEnabled: (user: UserRow) => void;
  onCopyOrgRoles: (user: UserRow) => void;
}

/**
 * 每列的動作(Figma 31:98):有權限才出現;擁有者受保護的動作出現但 disabled 並以 Tooltip 說明原因
 * (停用被 api 以 `OWNER_PROTECTED` 擋下,先在畫面上講清楚)。
 * **「所屬組織」不在此列**:api 只擋「移出他擁有的租戶頂層」,
 * 整個按鈕停用比 api 嚴,擁有者會因此連加入其他組織都做不到。
 */
export const UserRowActions = ({
  user,
  ability,
  isOwnerProtected,
  isOrgTreeAvailable,
  onEdit,
  onManageOrgs,
  onAssignRoles,
  onToggleEnabled,
  onCopyOrgRoles,
}: UserRowActionsProps) => {
  const t = useTranslations("admin.userManager");
  // 只有「停用」會被擋;已停用的擁有者要重新啟用不受限,那顆按鈕就不必提示
  const isToggleLocked = isOwnerProtected && user.enabled;

  return (
    <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap" }}>
      {ability.canEdit && (
        <Button
          variant="text"
          size="small"
          onClick={() => {
            onEdit(user);
          }}
        >
          {t("actions.edit")}
        </Button>
      )}
      {ability.canManageOrgs && (
        <Button
          variant="text"
          size="small"
          disabled={!isOrgTreeAvailable}
          onClick={() => {
            onManageOrgs(user);
          }}
        >
          {t("actions.orgs")}
        </Button>
      )}
      {ability.canAssignRoles && (
        <Button
          variant="text"
          size="small"
          onClick={() => {
            onAssignRoles(user);
          }}
        >
          {t("actions.roles")}
        </Button>
      )}
      {ability.canCopyOrgRoles && (
        <Button
          variant="text"
          size="small"
          onClick={() => {
            onCopyOrgRoles(user);
          }}
        >
          {t("actions.copyOrgRoles")}
        </Button>
      )}
      {ability.canToggleEnabled && (
        // 停用的按鈕收不到 hover,包 span 的事情交給 Tooltip 自己處理(REACT-10)
        <Tooltip title={isToggleLocked ? t("ownerProtected") : ""}>
          <Button
            variant="text"
            size="small"
            color={user.enabled ? "error" : "success"}
            disabled={isToggleLocked}
            onClick={() => {
              onToggleEnabled(user);
            }}
          >
            {user.enabled ? t("actions.disable") : t("actions.enable")}
          </Button>
        </Tooltip>
      )}
    </Stack>
  );
};
