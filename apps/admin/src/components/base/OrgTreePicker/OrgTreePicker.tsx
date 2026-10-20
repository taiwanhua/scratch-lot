import { useCallback, useMemo, useState } from "react";

import { Tree } from "@repo/ui/tree";

import {
  type OrgLabelSuffix,
  type OrgNodeLike,
  allOrgIds,
  filterOrgTree,
  toTreeNodes,
} from "@/lib/base/org-tree";

import { OrgDisabledReason } from "./OrgDisabledReason";

export interface OrgTreePickerProps {
  /** `orgTree` 查詢的結果(範圍外節點已標 `outOfScope`,本元件轉成 disabled) */
  nodes: readonly OrgNodeLike[];
  isLoading?: boolean;
  /** 受控的選取 id;單選模式傳 0 或 1 個 */
  selectedIds: readonly string[];
  onSelectedIdsChange: (ids: string[]) => void;
  /** 多選 + 節點左側核取方塊(選擇所屬組織);預設單選(頁面左側篩選樹) */
  isMultiSelect?: boolean;
  /** 搜尋關鍵字:命中節點與其祖先留下,其餘隱藏 */
  keyword?: string;
  /** 節點名稱右側的附加標籤(組織管理頁的「停用」「租戶」);預設沒有 */
  labelSuffixOf?: OrgLabelSuffix;
  /**
   * 勾選框鎖住的節點:已勾的維持勾選、未勾的勾不上,勾選狀態都改不動,但該列仍可展開。
   * 兩種用法:「擁有者不可被移出自己擁有的租戶頂層」(鎖住已勾的),以及
   * `OrgTreeSelect` 多選到上限時鎖住其餘未勾的節點。與整個節點停用
   * (範圍外、`disabledReasons`)不同 —— 鎖住的只是勾選框,節點本身不灰。
   */
  lockedIds?: readonly string[];
  /**
   * 停用 + 原因:列在裡面的節點整個停用(不能選),節點右側顯示原因文字,滑過顯示完整原因
   * (例「已由 王小明 對應」;專案的一對一對應把已占用的組織停用並註明)。
   * 與 `lockedIds` 不同 —— 這裡的節點不是選取結果的一部分,只是「看得到、選不了」。
   */
  disabledReasons?: Readonly<Partial<Record<string, string>>>;
  maxHeight?: number | string;
  "aria-label"?: string;
}

/**
 * 組織樹選擇器(使用者管理的左側篩選樹與「選擇所屬組織」彈窗、組織管理、
 * 欄位型的 `OrgTreeSelect` 共用,STRUCT-02)。
 * 預設整棵展開:展開狀態由「使用者收合過哪些節點」反推(REACT-06:不在 effect 內 setState,
 * 資料載入後新節點自動是展開的)。
 */
/** 停用、而且子孫裡有沒停用的節點 id。 */
const parentsWithSelectableDescendant = (
  nodes: readonly OrgNodeLike[],
  disabledIds: ReadonlySet<string>,
): Set<string> => {
  const result = new Set<string>();
  const visit = (node: OrgNodeLike): boolean => {
    let hasSelectable = false;
    for (const child of node.children ?? []) {
      const childSelectable = visit(child);
      hasSelectable ||=
        childSelectable || !(child.outOfScope || disabledIds.has(child.id));
    }
    if (hasSelectable && (node.outOfScope || disabledIds.has(node.id))) {
      result.add(node.id);
    }
    return hasSelectable;
  };
  for (const node of nodes) {
    visit(node);
  }
  return result;
};

/** 上面那種節點在樹上不標範圍外(否則 MUI 連子孫一起停用);其餘照舊。 */
const withOpenParents = (
  nodes: readonly OrgNodeLike[],
  openParentIds: ReadonlySet<string>,
): OrgNodeLike[] =>
  nodes.map((node) => ({
    ...node,
    outOfScope: node.outOfScope && !openParentIds.has(node.id),
    children: withOpenParents(node.children ?? [], openParentIds),
  }));

export const OrgTreePicker = ({
  nodes,
  isLoading = false,
  selectedIds,
  onSelectedIdsChange,
  isMultiSelect = false,
  keyword = "",
  labelSuffixOf,
  lockedIds,
  disabledReasons,
  maxHeight,
  "aria-label": ariaLabel,
}: OrgTreePickerProps) => {
  const [collapsedIds, setCollapsedIds] = useState<readonly string[]>([]);

  /** 原有的附加標籤後面再接停用原因;兩者都沒有的節點維持 undefined(不畫空的附加區)。 */
  const suffixOf = useCallback(
    (node: OrgNodeLike) => {
      const suffix = labelSuffixOf?.(node);
      const reason = disabledReasons?.[node.id];
      return reason === undefined ? (
        suffix
      ) : (
        <>
          {suffix}
          <OrgDisabledReason reason={reason} />
        </>
      );
    },
    [labelSuffixOf, disabledReasons],
  );
  const disabledIds = useMemo(
    () =>
      new Set(
        Object.entries(disabledReasons ?? {}).flatMap(([id, reason]) =>
          reason === undefined ? [] : [id],
        ),
      ),
    [disabledReasons],
  );

  const visibleNodes = useMemo(
    () => filterOrgTree(nodes, keyword),
    [nodes, keyword],
  );
  /**
   * 停用、但底下還有能選的節點(例:店長看整棵租戶樹,上層看不到、自己的分店看得到):
   * MUI 的樹會把停用節點的子孫一起停用,所以這種節點不在樹上標 disabled,
   * 改成鎖住勾選框、並在選取變動時擋掉(見 `handleSelectedIdsChange`);原因照樣顯示。
   */
  const openParentIds = useMemo(
    () => parentsWithSelectableDescendant(visibleNodes, disabledIds),
    [visibleNodes, disabledIds],
  );
  const treeDisabledIds = useMemo(
    () => new Set([...disabledIds].filter((id) => !openParentIds.has(id))),
    [disabledIds, openParentIds],
  );
  const items = useMemo(
    () =>
      toTreeNodes(
        withOpenParents(visibleNodes, openParentIds),
        suffixOf,
        treeDisabledIds,
      ),
    [visibleNodes, openParentIds, suffixOf, treeDisabledIds],
  );
  const checkLockedIds = useMemo(
    () => [...(lockedIds ?? []), ...openParentIds],
    [lockedIds, openParentIds],
  );

  /** 停用的節點(含上面那種沒在樹上標停用的)選不了:只有原本就選著的可以留著 / 取消。 */
  const handleSelectedIdsChange = (ids: string[]) => {
    const allowed = ids.filter(
      (id) =>
        !(disabledIds.has(id) || openParentIds.has(id)) ||
        selectedIds.includes(id),
    );
    const isBlocked =
      allowed.length !== ids.length &&
      allowed.length === selectedIds.length &&
      allowed.every((id) => selectedIds.includes(id));
    if (isBlocked) {
      return;
    }
    onSelectedIdsChange(allowed);
  };
  const expandedIds = useMemo(
    () => allOrgIds(visibleNodes).filter((id) => !collapsedIds.includes(id)),
    [visibleNodes, collapsedIds],
  );

  const handleExpandedIdsChange = (ids: string[]) => {
    setCollapsedIds(allOrgIds(visibleNodes).filter((id) => !ids.includes(id)));
  };

  return (
    <Tree
      items={items}
      isLoading={isLoading}
      multiSelect={isMultiSelect}
      checkboxSelection={isMultiSelect}
      selectedIds={selectedIds}
      onSelectedIdsChange={handleSelectedIdsChange}
      disabledCheckIds={checkLockedIds}
      expandedIds={expandedIds}
      onExpandedIdsChange={handleExpandedIdsChange}
      sx={{
        maxHeight,
        overflowY: maxHeight === undefined ? undefined : "auto",
      }}
      aria-label={ariaLabel}
    />
  );
};
