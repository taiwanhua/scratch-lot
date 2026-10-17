import { useCallback, useMemo } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { OrgTreePicker } from "@/components/base/OrgTreePicker/OrgTreePicker";
import type { OrgNodeLike } from "@/lib/base/org-tree";

export interface OrgTreePanelProps {
  nodes: readonly OrgNodeLike[];
  isLoading: boolean;
  /**
   * 樹根是**平台根組織**(`org(id).isSystem`)。租戶視角的樹根是租戶頂層,
   * api 也把它的 `parentId` 回成 null,所以這個旗標不能從樹的資料推(#186 ④)。
   */
  isRootPerspective: boolean;
  selectedOrgId: string | null;
  onSelectOrg: (orgId: string | null) => void;
  canProvision: boolean;
  canCreateChild: boolean;
  /** 選中的組織在可見範圍內才能往它底下新增 */
  isCreateChildEnabled: boolean;
  onProvision: () => void;
  onCreateChild: () => void;
}

/**
 * 左欄組織樹(Figma OrgTree 87:215 根組織視角 / 92:700 租戶視角)。
 * 兩種視角是同一棵樹,差別只在資料(樹根是誰)與權限(有沒有「開通租戶」),不是兩個元件。
 * 可見範圍外的節點由 `toTreeNodes` 轉成 disabled(顯示但不可選,ADR-0005);
 * 停用的組織在名稱旁掛一個 `Tag`(Figma Draft/OrgTreeItem 的 ShowTag 槽位 → `TreeNode.labelSuffix`)。
 */
export const OrgTreePanel = ({
  nodes,
  isLoading,
  isRootPerspective,
  selectedOrgId,
  onSelectOrg,
  canProvision,
  canCreateChild,
  isCreateChildEnabled,
  onProvision,
  onCreateChild,
}: OrgTreePanelProps) => {
  const t = useTranslations("admin.orgManager.tree");

  /**
   * 「租戶」= **父節點是平台根組織**的節點,不是「父節點是樹根」(#186 ④)。
   * 租戶視角的樹根是租戶頂層,它的子組織只是部門 / 分店,不掛這個標籤。
   */
  const tenantTopIds = useMemo(
    () =>
      new Set(
        isRootPerspective
          ? (nodes[0]?.children ?? []).map((child) => child.id)
          : [],
      ),
    [nodes, isRootPerspective],
  );

  const labelSuffixOf = useCallback(
    (node: OrgNodeLike) => {
      if (!node.enabled) {
        return <Tag tone="error" label={t("disabledTag")} />;
      }
      return tenantTopIds.has(node.id) ? (
        <Tag tone="grey" label={t("tenantTag")} />
      ) : undefined;
    },
    [tenantTopIds, t],
  );

  return (
    <Card
      sx={{
        p: 2,
        width: 360,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="subtitle1" sx={{ flex: 1 }}>
            {t("title")}
          </Typography>
          {canProvision && (
            <Button size="small" onClick={onProvision}>
              {t("provision")}
            </Button>
          )}
          {canCreateChild && (
            <Button
              size="small"
              variant="outlined"
              disabled={!isCreateChildEnabled}
              onClick={onCreateChild}
            >
              {t("createChild")}
            </Button>
          )}
        </Stack>
        {/* 樹佔滿標題列以外的高度,超出時自己捲(#183) */}
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <OrgTreePicker
            nodes={nodes}
            isLoading={isLoading}
            selectedIds={selectedOrgId === null ? [] : [selectedOrgId]}
            onSelectedIdsChange={(ids) => {
              onSelectOrg(ids[0] ?? null);
            }}
            labelSuffixOf={labelSuffixOf}
            aria-label={t("title")}
          />
        </Box>
      </Stack>
    </Card>
  );
};
