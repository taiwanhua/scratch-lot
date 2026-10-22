import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import { WILDCARD_ACTION } from "@repo/domain/permission";
import { Button } from "@repo/ui/button";
import { Tree, type TreeNode } from "@repo/ui/tree";
import { Typography } from "@repo/ui/typography";

import type { MatrixSelection } from "@/lib/base/role-matrix-208";

import type { MatrixModuleView } from "../role-manager-types";

type MatrixPermissionView = MatrixModuleView["permissions"][number];

/** 列尾的 key(Figma 172:281:12px、text.disabled);只影響呈現,不進無障礙名稱。 */
const matrixKey = (value: string) => (
  <Typography variant="caption" color="textDisabled">
    {value}
  </Typography>
);

/** 「全部(`*`)」固定排在同層權限的最前面(Figma 172:301)。 */
const wildcardFirst = (
  left: MatrixPermissionView,
  right: MatrixPermissionView,
): number =>
  Number(right.action === WILDCARD_ACTION) -
  Number(left.action === WILDCARD_ACTION);

interface MatrixTreeLabels {
  wildcard: string;
  selectGroup: string;
  clearGroup: string;
}

interface MatrixTreeContext extends MatrixTreeLabels {
  isGroupGranted: (groupKey: string) => boolean;
  onToggleGroup: (groupKey: string) => void;
}

const toPermissionNode = (
  permission: MatrixPermissionView,
  wildcardLabel: string,
): TreeNode => ({
  id: permission.key,
  label:
    permission.action === WILDCARD_ACTION ? wildcardLabel : permission.name,
  labelSuffix: matrixKey(permission.key),
});

/**
 * 模組列:自己這層的權限在前、子模組在後(Figma 的縮排順序)。
 * 頂層群組列尾放「全選整組 / 清空整組」(ADR-0004:子樹每個模組各一筆 `*`,狀態是衍生的)。
 */
const toModuleNodes = (
  nodes: readonly MatrixModuleView[],
  isTopLevel: boolean,
  context: MatrixTreeContext,
): TreeNode[] =>
  nodes.map((node) => {
    const children: TreeNode[] = [
      ...node.permissions
        .toSorted(wildcardFirst)
        .map((permission) => toPermissionNode(permission, context.wildcard)),
      ...toModuleNodes(node.children ?? [], false, context),
    ];
    return {
      id: node.key,
      label: node.name,
      labelSuffix: matrixKey(node.key),
      actions: isTopLevel ? (
        <Button
          variant="text"
          size="small"
          onClick={() => {
            context.onToggleGroup(node.key);
          }}
        >
          {context.isGroupGranted(node.key)
            ? context.clearGroup
            : context.selectGroup}
        </Button>
      ) : undefined,
      children: children.length === 0 ? undefined : children,
    };
  });

const collectIds = (nodes: readonly TreeNode[]): string[] =>
  nodes.flatMap((node) => [node.id, ...collectIds(node.children ?? [])]);

export interface MatrixTreeProps {
  modules: readonly MatrixModuleView[];
  selection: MatrixSelection;
  /** 群組列的「全選整組 / 清空整組」目前是哪一態 */
  isGroupGranted: (groupKey: string) => boolean;
  onToggleGroup: (groupKey: string) => void;
  onSelectedIdsChange: (ids: string[]) => void;
  isLoading?: boolean;
}

/**
 * 權限矩陣的樹(Figma 57:142 的列;元件能力見 `@repo/ui/tree` 的 PermissionMatrix story):
 * 模組列粗體、其下先列自己這層的權限(「全部(*)」在最前)再列子模組,縮排照 Figma 用 24。
 * 三態與「不可取消」都由呼叫端算好餵進來(`lib/base/role-matrix-208.ts`),`Tree` 只負責呈現。
 * 預設整棵展開:展開狀態由「使用者收合過哪些節點」反推(REACT-06)。
 */
export const MatrixTree = ({
  modules,
  selection,
  isGroupGranted,
  onToggleGroup,
  onSelectedIdsChange,
  isLoading = false,
}: MatrixTreeProps) => {
  const t = useTranslations("admin.roleManager.matrix");
  const [collapsedIds, setCollapsedIds] = useState<readonly string[]>([]);

  const items = useMemo(
    () =>
      toModuleNodes(modules, true, {
        wildcard: t("wildcard"),
        selectGroup: t("selectGroup"),
        clearGroup: t("clearGroup"),
        isGroupGranted,
        onToggleGroup,
      }),
    [modules, isGroupGranted, onToggleGroup, t],
  );
  const allIds = useMemo(() => collectIds(items), [items]);

  return (
    <Tree
      items={items}
      isLoading={isLoading}
      checkboxSelection
      multiSelect
      childrenIndentation={24}
      selectedIds={selection.checkedIds}
      indeterminateIds={selection.indeterminateIds}
      disabledCheckIds={selection.disabledCheckIds}
      onSelectedIdsChange={onSelectedIdsChange}
      expandedIds={allIds.filter((id) => !collapsedIds.includes(id))}
      onExpandedIdsChange={(ids) => {
        setCollapsedIds(allIds.filter((id) => !ids.includes(id)));
      }}
      aria-label={t("treeLabel")}
    />
  );
};
