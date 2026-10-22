import { useTranslations } from "use-intl";

import { Avatar } from "@repo/ui/avatar";
import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { PageTabs } from "@/components/base/PageTabs/PageTabs";

import { MembersTab } from "../MembersTab/MembersTab";
import { ORG_MANAGER_PERMISSIONS } from "../org-manager-permissions";
import type { OrgActionAbility, OrgDetail } from "../org-manager-types";
import { OrgActionBar } from "./OrgActionBar";
import { OrgDetailRow } from "./OrgDetailRow";
import { OrgManagersRow } from "./OrgManagersRow";

export interface OrgDetailPanelProps {
  org: OrgDetail | undefined;
  isLoading: boolean;
  /** 上層組織名稱(從樹上取,`org(id)` 只給 `parentId`);樹根沒有上層 */
  parentName: string | null;
  /** 租戶擁有者的姓名;沒有使用者清單權限或不是租戶頂層時為 null */
  ownerName: string | null;
  /** 這個組織有擁有者(= 租戶頂層),但名字看不到時仍要顯示欄位 */
  hasOwner: boolean;
  ability: OrgActionAbility;
  /** 租戶頂層對租戶內的人:停用 / 刪除 / 搬移停用並提示(ADR-0009) */
  isTenantTopProtected: boolean;
  /** 根組織視角 + 租戶頂層 + 有 `tenant-ops.revoke-provision` 才給「撤銷開通」 */
  canRevokeProvision: boolean;
  onEdit: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
  onRevokeProvision: () => void;
}

/**
 * 右欄資料區(Figma OrgDetail 87:244 / 92:724):名稱 + 狀態標籤 + 動作列,底下逐列的組織資料。
 * 商標只在有值時出現(`logoUrl` 是 api 現簽的短效網址,ADR-0010);
 * 擁有者只有租戶頂層有(ADR-0009),其餘組織連欄位都不渲染。
 *
 * **「成員」頁籤只在持 `system.org-manager.view-members` 時出現**:沒有那筆權限的人
 * 看到的就是沒有撤銷開通時的樣子(沒有頁籤列,直接是組織資料),不是「出現但停用」——
 * 頁籤不是一個動作,給了空的頁籤只會讓人困惑。頁籤用 `PageTabs`,目前分頁記在網址 `?tab=`(REACT-14);
 * 只剩「組織資料」一個分頁時 `PageTabs` 不顯示分頁籤。
 */
export const OrgDetailPanel = ({
  org,
  isLoading,
  parentName,
  ownerName,
  hasOwner,
  ability,
  isTenantTopProtected,
  canRevokeProvision,
  onEdit,
  onToggleEnabled,
  onDelete,
  onRevokeProvision,
}: OrgDetailPanelProps) => {
  const t = useTranslations("admin.orgManager.detail");

  if (org === undefined) {
    return (
      <Card
        component="section"
        aria-label={t("region")}
        sx={{ flex: 1, minWidth: 0, minHeight: 0, p: 3, overflow: "auto" }}
      >
        <Stack sx={{ alignItems: "center", py: 4 }}>
          {isLoading ? (
            <CircularProgress aria-label={t("loading")} />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t("empty")}
            </Typography>
          )}
        </Stack>
      </Card>
    );
  }

  return (
    <Card
      component="section"
      aria-label={t("region")}
      sx={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        p: 3,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <Stack
        direction="row"
        spacing={1.25}
        // 放不下(手機寬)時操作鈕整組換到下一列,不把組織名稱擠成直排
        sx={{ alignItems: "center", flexWrap: "wrap", pb: 1.75 }}
      >
        <Typography variant="subtitle1">{org.name}</Typography>
        <Tag
          tone={org.enabled ? "success" : "error"}
          label={org.enabled ? t("enabled") : t("disabled")}
        />
        <Stack sx={{ flex: 1 }} />
        <OrgActionBar
          org={org}
          ability={ability}
          isTenantTopProtected={isTenantTopProtected}
          canRevokeProvision={canRevokeProvision}
          onEdit={onEdit}
          onToggleEnabled={onToggleEnabled}
          onDelete={onDelete}
          onRevokeProvision={onRevokeProvision}
        />
      </Stack>

      {/* 間距沿用改版前:分頁列與內容之間 1.5 */}
      <PageTabs
        aria-label={t("tabs.label")}
        spacing={1.5}
        items={[
          {
            value: "detail",
            label: t("tabs.detail"),
            content: (
              <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                <Stack spacing={0}>
                  <OrgDetailRow label={t("parent")}>
                    <Typography variant="body2">
                      {parentName ?? t("none")}
                    </Typography>
                  </OrgDetailRow>
                  <OrgDetailRow label={t("description")}>
                    <Typography variant="body2">
                      {org.description ?? t("none")}
                    </Typography>
                  </OrgDetailRow>
                  {org.logoUrl !== null && org.logoUrl !== undefined && (
                    <OrgDetailRow label={t("logo")}>
                      <Avatar
                        variant="rounded"
                        src={org.logoUrl}
                        alt={t("logoAlt", { name: org.name })}
                      />
                    </OrgDetailRow>
                  )}
                  {hasOwner && (
                    <OrgDetailRow label={t("owner")}>
                      <Typography variant="body2">
                        {ownerName ?? t("ownerHidden")}
                      </Typography>
                    </OrgDetailRow>
                  )}
                  {/* 根組織不屬於任何租戶,不能設主管 */}
                  {!org.isSystem && <OrgManagersRow orgId={org.id} />}
                </Stack>
              </Box>
            ),
          },
          {
            value: "members",
            label: t("tabs.members"),
            permission: ORG_MANAGER_PERMISSIONS.viewMembers,
            content: (
              <Box
                sx={{
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                {/* 換組織時整個重來(已選的人不該跟著跑到別的組織;頁碼在網址上以組織 id 對齊,見 useOrgMembers) */}
                <MembersTab
                  key={org.id}
                  orgId={org.id}
                  orgName={org.name}
                  canAdd={ability.canAddMembers}
                />
              </Box>
            ),
          },
        ]}
      />
    </Card>
  );
};
