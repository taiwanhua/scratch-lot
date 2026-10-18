"use client";

import { type SxProps, type Theme, styled } from "@mui/material/styles";
import { RichTreeView } from "@mui/x-tree-view/RichTreeView";
import { type ReactNode, type SyntheticEvent, useMemo } from "react";

import { TreeItemRow } from "./TreeItemRow";
import { type TreeItemRowState, TreeRowsContext } from "./tree-rows";

/** 樹節點資料(Figma Draft/OrgTreeItem 98:2)。`disabled` = 顯示但不可選(可見範圍外 / 無權限)。 */
export interface TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
  disabled?: boolean;
  /**
   * 標籤右側的附加內容(Figma Draft/OrgTreeItem 的 ShowTag 槽位):停用 / 租戶這類 `Tag`、權限 key。
   * 只影響呈現,不影響選取與鍵盤操作;`label` 仍是純文字,搜尋與無障礙名稱照舊。
   */
  labelSuffix?: ReactNode;
  /**
   * 列尾靠右的操作槽位(權限矩陣頂層群組列的「全選整組 / 清空整組」;Figma 角色管理 172:284)。
   * 與 `labelSuffix` 是同一套機制的兩個位置:`labelSuffix` 是貼著標籤的唯讀資訊,
   * `actions` 是推到列尾、點擊不會外溢成選取或展開的操作。
   */
  actions?: ReactNode;
}

export interface TreeProps {
  items: readonly TreeNode[];
  /** 勾選模式:節點左側出現核取方塊(選擇所屬組織這類多選情境) */
  checkboxSelection?: boolean;
  /** 選取模式:預設單選;開啟後同時可選多個節點 */
  multiSelect?: boolean;
  /** 受控的選取節點 id;單選模式下傳 0 或 1 個 */
  selectedIds?: readonly string[];
  /** 非受控的初始選取節點 id */
  defaultSelectedIds?: readonly string[];
  /** 選取變動;單選模式一律回傳 0 或 1 個 id */
  onSelectedIdsChange?: (ids: string[]) => void;
  /**
   * 部分勾選(三態)的節點 id:勾選框顯示 indeterminate、該列 `aria-checked="mixed"`。
   * **連動由呼叫端算**(權限矩陣的規則在 `@repo/domain/permission`),`Tree` 只負責呈現。
   */
  indeterminateIds?: readonly string[];
  /**
   * 勾選框停用的節點 id:不可勾也不可取消(「有子孫被勾的上層不可取消」),
   * 但該列仍可展開 / 收合 — 和把整個節點標 `disabled` 不一樣。
   * 鍵盤(空白鍵)同樣擋下,前提是 `selectedIds` 受控(矩陣本來就是受控的)。
   */
  disabledCheckIds?: readonly string[];
  /** 受控的展開節點 id */
  expandedIds?: readonly string[];
  /** 非受控的初始展開節點 id */
  defaultExpandedIds?: readonly string[];
  onExpandedIdsChange?: (ids: string[]) => void;
  /** 子節點相對父節點的水平縮排;預設 12px(MUI),權限矩陣照 Figma 用 24 */
  childrenIndentation?: number | string;
  /** 載入中:顯示骨架列取代節點 */
  isLoading?: boolean;
  sx?: SxProps<Theme>;
  "aria-label"?: string;
}

/** 內容列的左內距基底;縮排量由 MUI 的兩個 CSS 變數乘出來後疊在它上面。 */
const CONTENT_PADDING = 1;

/** Figma Draft/OrgTreeItem:選取態 primary.lighter 底 + primary.dark 字、停用態 text.disabled。 */
const TreeRoot = styled("div")(({ theme }) => ({
  "& .MuiTreeItem-content": {
    ...theme.typography.body2,
    borderRadius: theme.shape.borderRadius,
    padding: theme.spacing(CONTENT_PADDING),
    /*
     * 依層級縮排:MUI X Tree View v9 把縮排做在**內容列的 paddingLeft** —
     * `calc(base + var(--TreeView-itemChildrenIndentation) * var(--TreeView-itemDepth))`
     * (`--TreeView-itemDepth` 由 `useTreeItem` 寫在該列 `li` 的 inline style,
     *  `--TreeView-itemChildrenIndentation` 寫在 `role="tree"` 的根)。
     * 上面那行 `padding` 簡寫會把它整個蓋掉(這一層的選擇器比 MUI 自己的類別更具體),
     * 整棵樹因此全部貼齊左緣;把算式接回來,縮排才會隨深度增加。
     */
    paddingLeft: `calc(${theme.spacing(CONTENT_PADDING)} + var(--TreeView-itemChildrenIndentation) * var(--TreeView-itemDepth))`,
  },
  "& .MuiTreeItem-content.Mui-selected": {
    ...theme.typography.subtitle2,
    backgroundColor: theme.palette.primary.lighter,
    color: theme.palette.primary.dark,
    "&:hover": { backgroundColor: theme.palette.primary.lighter },
  },
  "& .MuiTreeItem-content.Mui-disabled": {
    color: theme.palette.text.disabled,
    opacity: 1,
  },
}));

/** 攤平整棵樹,收集每一列的附加內容與勾選框狀態;沒有任何額外資訊的列不進表。 */
const collectRows = (
  nodes: readonly TreeNode[],
  indeterminateIds: ReadonlySet<string>,
  disabledCheckIds: ReadonlySet<string>,
  into: Map<string, TreeItemRowState>,
): Map<string, TreeItemRowState> => {
  for (const node of nodes) {
    const row: TreeItemRowState = {};
    if (node.labelSuffix !== undefined) {
      row.labelSuffix = node.labelSuffix;
    }
    if (node.actions !== undefined) {
      row.actions = node.actions;
    }
    if (indeterminateIds.has(node.id)) {
      row.indeterminate = true;
    }
    if (disabledCheckIds.has(node.id)) {
      row.disabled = true;
    }
    if (Object.keys(row).length > 0) {
      into.set(node.id, row);
    }
    collectRows(node.children ?? [], indeterminateIds, disabledCheckIds, into);
  }
  return into;
};

/** MUI 單選回傳 `string | null`、多選回傳 `string[]`;本包裝層一律正規化成陣列。 */
const toIdArray = (value: string | readonly string[] | null): string[] => {
  if (value === null) {
    return [];
  }
  return typeof value === "string" ? [value] : [...value];
};

const EMPTY_IDS: readonly string[] = [];

/**
 * 樹狀選單:包一層 `@mui/x-tree-view`(MIT 社群版)。
 * 資料以 `{ id, label, children, disabled }` 陣列傳入,不用 children 組裝;
 * 選取值對外一律是 `string[]`,單 / 多選只差在 `multiSelect`,呼叫端不必改型別。
 *
 * 兩類 props 的分工:**內容**(`labelSuffix`、`actions`、`disabled`)跟著節點資料走;
 * **狀態**(`selectedIds`、`expandedIds`、`indeterminateIds`、`disabledCheckIds`)是 id 陣列,
 * 隨勾選即時變動而不必重建整棵 `items`。
 *
 * **展開 / 收合只由最前面的箭頭觸發**(`expansionTrigger="iconContainer"`):
 * MUI 預設是點整個內容區,於是「選一個組織」順手把它收起來,選完要再點一次箭頭展開;
 * 這裡把兩件事分開 —— 點文字只選取,點箭頭只展開 / 收合。
 */
export const Tree = ({
  items,
  checkboxSelection = false,
  multiSelect = false,
  selectedIds,
  defaultSelectedIds,
  onSelectedIdsChange,
  indeterminateIds = EMPTY_IDS,
  disabledCheckIds = EMPTY_IDS,
  expandedIds,
  defaultExpandedIds,
  onExpandedIdsChange,
  childrenIndentation,
  isLoading = false,
  sx,
  "aria-label": ariaLabel,
}: TreeProps) => {
  const rows = useMemo(
    () =>
      collectRows(
        items,
        new Set(indeterminateIds),
        new Set(disabledCheckIds),
        new Map<string, TreeItemRowState>(),
      ),
    [items, indeterminateIds, disabledCheckIds],
  );

  const toSelectionValue = (
    ids: readonly string[] | undefined,
  ): readonly string[] | string | null | undefined => {
    if (ids === undefined) {
      return undefined;
    }
    return multiSelect ? ids : (ids[0] ?? null);
  };

  /** 勾選框停用的列不該因為鍵盤(空白鍵)繞過停用;滑鼠那條路 MUI 自己就擋住了。 */
  const isBlockedByDisabledCheck = (next: readonly string[]) =>
    selectedIds !== undefined &&
    disabledCheckIds.some(
      (id) => selectedIds.includes(id) !== next.includes(id),
    );

  const handleSelectedItemsChange = (
    _event: SyntheticEvent | null,
    value: string | string[] | null,
  ) => {
    const next = toIdArray(value);
    if (isBlockedByDisabledCheck(next)) {
      return;
    }
    onSelectedIdsChange?.(next);
  };

  const handleExpandedItemsChange = (
    _event: SyntheticEvent | null,
    itemIds: string[],
  ) => {
    onExpandedIdsChange?.(itemIds);
  };

  return (
    <TreeRoot sx={sx}>
      <TreeRowsContext.Provider value={rows}>
        <RichTreeView<TreeNode, boolean>
          items={items}
          slots={{ item: TreeItemRow }}
          multiSelect={multiSelect}
          checkboxSelection={checkboxSelection}
          isItemDisabled={(item) => item.disabled === true}
          selectedItems={toSelectionValue(selectedIds)}
          defaultSelectedItems={toSelectionValue(defaultSelectedIds)}
          onSelectedItemsChange={handleSelectedItemsChange}
          // 展開 / 收合只認最前面的箭頭,點文字是「選這一列」而已
          expansionTrigger="iconContainer"
          expandedItems={expandedIds}
          defaultExpandedItems={defaultExpandedIds}
          onExpandedItemsChange={handleExpandedItemsChange}
          itemChildrenIndentation={childrenIndentation}
          loading={isLoading}
          aria-label={ariaLabel}
        />
      </TreeRowsContext.Provider>
    </TreeRoot>
  );
};
