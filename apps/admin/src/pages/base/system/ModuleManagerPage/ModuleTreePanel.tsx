import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import { ModuleSidebarType } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Tree, type TreeNode } from "@repo/ui/tree";
import { Typography } from "@repo/ui/typography";

import { allModuleIds, isPermissionContainer } from "./module-admin-tree";
import type { ModuleAdminNodeLike } from "./module-manager-types";

export interface ModuleTreePanelProps {
  nodes: readonly ModuleAdminNodeLike[];
  isLoading: boolean;
  selectedModuleId: string | null;
  onSelectModule: (moduleId: string | null) => void;
}

/**
 * 左欄模組樹(Figma ModuleTree 89:218)。
 *
 * 這裡放的是**治理面的全樹**:側欄看不到的 hidden 節點、隱藏的 api 權限樹、
 * 以及已停用的模組都照樣列出來 —— 停用一律以標籤表示,不以「不顯示」表示,
 * 不然停用後就再也找不到它、開不回來(`docs/modules/module-manager.md`)。
 */
export const ModuleTreePanel = ({
  nodes,
  isLoading,
  selectedModuleId,
  onSelectModule,
}: ModuleTreePanelProps) => {
  const t = useTranslations("admin.moduleManager.tree");

  const [collapsedIds, setCollapsedIds] = useState<readonly string[]>([]);

  const items = useMemo(() => {
    /**
     * 類型標籤只給群組與隱藏節點(Figma 89:223 / 89:243):連結是絕大多數節點的樣子,
     * 每一列都掛一個「連結」標籤只是噪音;三種類型完整的說法在右側「側欄類型」那一列。
     *
     * 隱藏節點再分兩種:有畫面的是「隱藏頁」,沒畫面的是「權限容器」
     * (`isPermissionContainer`)—— 一律標成隱藏頁會讓人去找一個不存在的頁面。
     */
    const typeTagOf = (node: ModuleAdminNodeLike) => {
      if (node.sidebarType === ModuleSidebarType.Group) {
        return <Tag tone="grey" label={t("groupTag")} />;
      }
      if (isPermissionContainer(node)) {
        return <Tag tone="grey" label={t("containerTag")} />;
      }
      if (node.sidebarType === ModuleSidebarType.Hidden) {
        return <Tag tone="warning" label={t("hiddenTag")} />;
      }
      return null;
    };

    const toItems = (source: readonly ModuleAdminNodeLike[]): TreeNode[] =>
      source.map((node) => ({
        id: node.id,
        label: node.name,
        labelSuffix: (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
            {typeTagOf(node)}
            {!node.enabled && <Tag tone="error" label={t("disabledTag")} />}
          </Stack>
        ),
        // 葉節點給 undefined 而不是空陣列,否則會長出不該有的展開箭頭
        children:
          node.children === undefined || node.children.length === 0
            ? undefined
            : toItems(node.children),
      }));

    return toItems(nodes);
  }, [nodes, t]);

  const expandedIds = useMemo(
    () => allModuleIds(nodes).filter((id) => !collapsedIds.includes(id)),
    [nodes, collapsedIds],
  );

  return (
    <Card
      sx={{
        p: 2,
        // 手機寬(主從一次只顯示一邊)清單滿版
        width: { xs: "100%", sm: 340 },
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
        <Typography variant="subtitle1">{t("title")}</Typography>
        {/* 樹佔滿標題列以外的高度,超出時自己捲(STYLE-08) */}
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <Tree
            items={items}
            isLoading={isLoading}
            selectedIds={selectedModuleId === null ? [] : [selectedModuleId]}
            onSelectedIdsChange={(ids) => {
              onSelectModule(ids[0] ?? null);
            }}
            expandedIds={expandedIds}
            onExpandedIdsChange={(ids) => {
              setCollapsedIds(
                allModuleIds(nodes).filter((id) => !ids.includes(id)),
              );
            }}
            aria-label={t("title")}
          />
        </Box>
      </Stack>
    </Card>
  );
};
