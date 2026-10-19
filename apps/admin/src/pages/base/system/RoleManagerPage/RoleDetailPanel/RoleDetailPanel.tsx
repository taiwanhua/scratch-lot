import { useTranslations } from "use-intl";

import { RoleKind } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { Typography } from "@repo/ui/typography";

import { AssignUsersTab } from "../AssignUsersTab/AssignUsersTab";
import { PermissionMatrixTab } from "../PermissionMatrixTab/PermissionMatrixTab";
import {
  type RoleActionAbility,
  type RoleDetailTab,
  type RoleRow,
  rowAbilityOf,
} from "../role-manager-types";
import type { useRoleMatrix } from "../useRoleMatrix";
import { DetailTabs } from "./DetailTabs";

export interface RoleDetailPanelProps {
  role: RoleRow | null;
  ability: RoleActionAbility;
  activeTab: RoleDetailTab;
  onChangeTab: (tab: RoleDetailTab) => void;
  matrix: ReturnType<typeof useRoleMatrix>;
  onUsersChanged: () => void;
}

/**
 * 右側的單一角色明細(Figma 57:142):兩個頁籤各自一個子元件。
 * 沒有任何角色(清單空)時只顯示提示 — 頁籤本身沒有可操作的對象。
 */
export const RoleDetailPanel = ({
  role,
  ability,
  activeTab,
  onChangeTab,
  matrix,
  onUsersChanged,
}: RoleDetailPanelProps) => {
  const t = useTranslations("admin.roleManager");

  return (
    <Card
      sx={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        p: 2.5,
      }}
    >
      {role === null ? (
        <Typography variant="body2" color="text.secondary">
          {t("noSelection")}
        </Typography>
      ) : (
        <>
          <DetailTabs active={activeTab} onChange={onChangeTab} />
          <Box
            role="tabpanel"
            sx={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              pt: 1.5,
            }}
          >
            {activeTab === "matrix" ? (
              <PermissionMatrixTab
                roleName={role.name}
                // 種子角色的矩陣唯讀:權限有、但這個角色不給編 —
                // 兩層相乘的結果由 `rowAbilityOf` 算,前端不重算種類規則
                canEdit={rowAbilityOf(ability, role).canEditMatrix}
                isSeedRole={role.kind === RoleKind.System}
                matrix={matrix}
              />
            ) : (
              <AssignUsersTab
                key={role.id}
                role={role}
                canAssign={ability.canAssignUsers}
                onChanged={onUsersChanged}
              />
            )}
          </Box>
        </>
      )}
    </Card>
  );
};
