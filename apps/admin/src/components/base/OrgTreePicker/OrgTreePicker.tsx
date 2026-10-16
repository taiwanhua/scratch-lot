import { useMemo, useState } from "react";

import { Tree } from "@repo/ui/tree";

import {
  type OrgLabelSuffix,
  type OrgNodeLike,
  allOrgIds,
  filterOrgTree,
  toTreeNodes,
} from "@/lib/base/org-tree";

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
   * 勾選框鎖住的節點:已勾的維持勾選、勾不動也取消不掉,但該列仍可展開
   * (#362 的「擁有者不可被移出自己擁有的租戶頂層」)。與整個節點 `disabled`
   * (範圍外)不同 —— 鎖住的節點仍然是選取結果的一部分。
   */
  lockedIds?: readonly string[];
  maxHeight?: number | string;
  "aria-label"?: string;
}

/**
 * 組織樹選擇器(使用者管理 #139 的左側篩選樹與「選擇所屬組織」彈窗、組織管理 #138 共用,STRUCT-02)。
 * 預設整棵展開:展開狀態由「使用者收合過哪些節點」反推(REACT-06:不在 effect 內 setState,
 * 資料載入後新節點自動是展開的)。
 */
export const OrgTreePicker = ({
  nodes,
  isLoading = false,
  selectedIds,
  onSelectedIdsChange,
  isMultiSelect = false,
  keyword = "",
  labelSuffixOf,
  lockedIds,
  maxHeight,
  "aria-label": ariaLabel,
}: OrgTreePickerProps) => {
  const [collapsedIds, setCollapsedIds] = useState<readonly string[]>([]);

  const visibleNodes = useMemo(
    () => filterOrgTree(nodes, keyword),
    [nodes, keyword],
  );
  const items = useMemo(
    () => toTreeNodes(visibleNodes, labelSuffixOf),
    [visibleNodes, labelSuffixOf],
  );
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
      onSelectedIdsChange={onSelectedIdsChange}
      disabledCheckIds={lockedIds}
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
