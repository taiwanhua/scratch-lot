"use client";

import MuiBox from "@mui/material/Box";
import { TreeItem, type TreeItemProps } from "@mui/x-tree-view/TreeItem";
import { type SyntheticEvent, useContext, useMemo } from "react";

import { TreeItemRowCheckbox } from "./TreeItemRowCheckbox";
import { TreeItemCheckboxStateContext, TreeRowsContext } from "./tree-rows";

/** 列尾的操作自己處理事件,不該外溢成「選取 / 展開這一列」或樹的鍵盤導覽。 */
const stopPropagation = (event: SyntheticEvent) => {
  event.stopPropagation();
};

/**
 * 樹的單一列(`RichTreeView` 的 item 槽位)。
 * 在 `TreeItem` 之上補三件事:標籤旁的 `labelSuffix`、列尾靠右的 `actions`、勾選框的三態與停用。
 * 槽位元件一定要是模組層的常數(放在 render 內會每次換成新元件、整棵樹重新掛載),
 * 所以逐列的資料經 context 進來,而不是閉包。
 */
export const TreeItemRow = (props: TreeItemProps) => {
  const row = useContext(TreeRowsContext).get(props.itemId);
  const { labelSuffix, actions } = row ?? {};

  const checkboxState = useMemo(
    () => ({
      ...(row?.indeterminate === true ? { indeterminate: true } : {}),
      ...(row?.disabled === true ? { disabled: true } : {}),
    }),
    [row?.indeterminate, row?.disabled],
  );

  const label =
    labelSuffix === undefined && actions === undefined ? (
      props.label
    ) : (
      <MuiBox
        component="span"
        // 放不下時 labelSuffix 換到下一行,標籤本身不被擠成一字一行(窄螢幕)
        sx={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          columnGap: 1,
          width: "100%",
        }}
      >
        {props.label}
        {labelSuffix}
        {/* 這層只攔事件外溢,操作本身是呼叫端傳進來的 Button / Link,語意與鍵盤支援在它們身上 */}
        {actions !== undefined && (
          <MuiBox
            component="span"
            onClick={stopPropagation}
            onKeyDown={stopPropagation}
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 1,
              marginLeft: "auto",
            }}
          >
            {actions}
          </MuiBox>
        )}
      </MuiBox>
    );

  return (
    <TreeItemCheckboxStateContext.Provider value={checkboxState}>
      <TreeItem
        {...props}
        label={label}
        // 部分勾選的列對輔助技術是 mixed;MUI 只有在它自己算連動時才會標,本元件的三態由呼叫端給
        {...(row?.indeterminate === true ? { "aria-checked": "mixed" } : {})}
        slots={{ ...props.slots, checkbox: TreeItemRowCheckbox }}
      />
    </TreeItemCheckboxStateContext.Provider>
  );
};
