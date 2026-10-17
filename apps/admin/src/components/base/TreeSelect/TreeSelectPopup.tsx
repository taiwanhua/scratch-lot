import type { ReactNode } from "react";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Popover } from "@repo/ui/popover";

export interface TreeSelectPopupProps {
  /** 面板 / 對話框的無障礙名稱與對話框標題(= 欄位標籤) */
  label: string;
  /** 錨點是欄位外框;`null` = 關閉 */
  anchorEl: HTMLElement | null;
  /** < sm 改開全螢幕對話框(呼叫端也要用它決定樹的捲動上限,所以由呼叫端判斷) */
  isMobile: boolean;
  /** 手機對話框的 [確定](只負責關閉;選取都是即時生效) */
  confirmLabel: string;
  onClose: () => void;
  /** 打開後的內容(搜尋 + 樹…),關閉即卸載(REACT-08) */
  children: ReactNode;
}

/**
 * 樹狀選擇器打開後的外殼(`OrgTreeSelect`、`PermissionTreeSelect` 共用):sm 以上是欄位下方的
 * 浮動面板(寬度至少跟欄位同寬),< sm 改開全螢幕對話框(標題 + 內容 + [確定])。
 */
export const TreeSelectPopup = ({
  label,
  anchorEl,
  isMobile,
  confirmLabel,
  onClose,
  children,
}: TreeSelectPopupProps) => {
  if (anchorEl === null) {
    return null;
  }
  if (isMobile) {
    return (
      <Dialog
        open
        fullScreen
        onClose={onClose}
        title={label}
        actions={<Button onClick={onClose}>{confirmLabel}</Button>}
      >
        {children}
      </Dialog>
    );
  }
  return (
    <Popover
      open
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      transformOrigin={{ vertical: "top", horizontal: "left" }}
      slotProps={{
        paper: {
          "aria-label": label,
          // 寬度跟著欄位(Figma:面板與欄位同寬);窄欄位時至少照內容撐開
          sx: { minWidth: anchorEl.offsetWidth, mt: 0.5 },
        },
      }}
    >
      <Box sx={{ px: 1, py: 1.5 }}>{children}</Box>
    </Popover>
  );
};
