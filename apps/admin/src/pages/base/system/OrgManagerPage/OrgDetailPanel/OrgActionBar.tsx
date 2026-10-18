import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Tooltip } from "@repo/ui/tooltip";

import type { OrgActionAbility, OrgDetail } from "../org-manager-types";

export interface OrgActionBarProps {
  org: OrgDetail;
  ability: OrgActionAbility;
  /**
   * 這是租戶頂層、而操作者是租戶內的人：停用 / 刪除 / 搬移只有根組織能做
   * （ADR-0009）。同根組織保護的做法：按鈕出現但停用並提示，不是藏起來。
   */
  isTenantTopProtected: boolean;
  /**
   * 「撤銷開通」出不出現:持有 `tenant-ops.revoke-provision`、站在根組織視角、
   * 且選中的是租戶頂層 —— 三者都成立才給按鈕(判斷在 `OrgManagerPage`,這裡只負責畫)。
   */
  canRevokeProvision: boolean;
  onEdit: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
  onRevokeProvision: () => void;
}

/**
 * 資料區的動作列(Figma 87:245):按鈕**依權限決定出不出現**(ADR-0011「頁內判斷」),
 * 根組織保護則是**出現但停用** — 「這個動作我做不到」跟「這個組織不准被這樣動」是兩回事,
 * 前者不該給按鈕、後者要讓人看得出為什麼(`isSystem` 的 tooltip)。
 */
export const OrgActionBar = ({
  org,
  ability,
  isTenantTopProtected,
  canRevokeProvision,
  onEdit,
  onToggleEnabled,
  onDelete,
  onRevokeProvision,
}: OrgActionBarProps) => {
  const t = useTranslations("admin.orgManager.actions");

  /** 組織本身不准被這樣動的兩種情況:平台根組織、租戶頂層(對租戶內的人)。 */
  const isLocked = org.isSystem || isTenantTopProtected;
  const lockedHint = org.isSystem ? t("systemOrgHint") : t("tenantTopHint");

  return (
    <Stack direction="row" spacing={1}>
      {ability.canEdit && (
        <Button size="small" variant="outlined" onClick={onEdit}>
          {t("edit")}
        </Button>
      )}
      {/* 停用的按鈕收不到 hover,包 span 的事情交給 Tooltip 自己處理 */}
      {ability.canToggleEnabled && (
        <Tooltip title={isLocked ? lockedHint : ""}>
          <Button
            size="small"
            variant="text"
            color={org.enabled ? "error" : "primary"}
            disabled={isLocked}
            onClick={onToggleEnabled}
          >
            {org.enabled ? t("disable") : t("enable")}
          </Button>
        </Tooltip>
      )}
      {ability.canDelete && (
        <Tooltip title={isLocked ? lockedHint : ""}>
          <Button
            size="small"
            variant="text"
            disabled={isLocked}
            onClick={onDelete}
          >
            {t("delete")}
          </Button>
        </Tooltip>
      )}
      {/* 撤銷開通只在根組織視角 + 租戶頂層時出現;不是「出現但停用」——
          對非租戶頂層的組織它根本不是一個可想像的動作,給了按鈕只會讓人困惑 */}
      {canRevokeProvision && (
        <Button
          size="small"
          variant="text"
          color="error"
          onClick={onRevokeProvision}
        >
          {t("revokeProvision")}
        </Button>
      )}
    </Stack>
  );
};
