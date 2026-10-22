import type { ReactNode, Ref } from "react";

import { Box } from "@repo/ui/box";
import { Drawer } from "@repo/ui/drawer";

import { designerPropertyPanelSx } from "./designer-layout";

export interface DesignerPropertyPanelProps {
  /** 區塊名稱(`section` 的 aria-label;平板寬時也是抽屜標題),例:「屬性」 */
  label: string;
  /** 抽屜關閉鈕的無障礙名稱 */
  closeLabel: string;
  /** 平板寬(`useIsDesignerTablet`):改成右側抽屜 */
  isTablet: boolean;
  /** 平板寬時抽屜開著(選了欄位 / 關卡,或按了整張表單 / 整個流程的設定);電腦寬不看 */
  isOpen: boolean;
  /** 關抽屜(關閉鈕、抽屜裡按 Esc) */
  onClose: () => void;
  /** 區塊本身(給了就可程式聚焦,`tabIndex={-1}`):按鈕卸載後焦點放回這裡,不掉回 body */
  panelRef?: Ref<HTMLElement>;
  children: ReactNode;
}

/**
 * 設計器的屬性面板外框(表單設計器的欄位 / 分區 / 表單設定、流程設計器的關卡 / 整個流程設定):
 *
 * - 電腦寬(≥ `lg`):畫布右邊固定寬的一欄(`designerPropertyPanelSx`),跟以前一樣
 * - 平板寬(`sm`–`lg`):右側滑出的**非遮罩**抽屜(`@repo/ui/drawer` 的 `isModal={false}`),平常不佔畫布寬度;
 *   開著時畫布照樣看得到、點得到(換選另一個欄位 / 關卡直接換內容),Esc 或關閉鈕收回。
 *   開著時工作區要讓出抽屜寬(`designerDrawerReserve`),由設計器自己套在畫布那一列。
 */
export const DesignerPropertyPanel = ({
  label,
  closeLabel,
  isTablet,
  isOpen,
  onClose,
  panelRef,
  children,
}: DesignerPropertyPanelProps) => {
  const focusable = panelRef === undefined ? {} : { tabIndex: -1 };
  if (!isTablet) {
    return (
      <Box
        component="section"
        aria-label={label}
        ref={panelRef}
        {...focusable}
        sx={designerPropertyPanelSx}
      >
        {children}
      </Box>
    );
  }
  return (
    <Drawer
      open={isOpen}
      isModal={false}
      anchor="right"
      title={label}
      closeLabel={closeLabel}
      onClose={onClose}
    >
      <Box component="section" aria-label={label} ref={panelRef} {...focusable}>
        {children}
      </Box>
    </Drawer>
  );
};
