import { type ReactNode, type Ref, useEffect } from "react";

import { Box } from "@repo/ui/box";
import { Drawer } from "@repo/ui/drawer";

import { SHELL_HEADER_HEIGHT } from "@/lib/base/shell-header-geometry";
import {
  type DesignerDrawerSource,
  useDesignerDrawerStore,
} from "@/stores/base/useDesignerDrawerStore";

import { designerPropertyPanelSx } from "./designer-layout";

export interface DesignerPropertyPanelProps {
  /** 區塊名稱(電腦寬是 `section` 的 aria-label;平板寬是抽屜標題,抽屜以它命名),例:「屬性」 */
  label: string;
  /** 抽屜關閉鈕的無障礙名稱 */
  closeLabel: string;
  /** 平板寬(`useIsDesignerTablet`):改成右側抽屜 */
  isTablet: boolean;
  /** 平板寬時抽屜開著(選了欄位 / 關卡,或按了整張表單 / 整個流程的設定);電腦寬不看 */
  isOpen: boolean;
  /** 誰的屬性面板(回報抽屜開關給詳情卡片時區分;詳情卡片只看目前顯示的那一個) */
  source: DesignerDrawerSource;
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
 *   開著時畫布照樣看得到、點得到(換選另一個欄位 / 關卡直接換內容),在抽屜裡按 Esc 或按關閉鈕收回。
 *   抽屜從頂部列與頁籤列下面開始(不蓋通知、頭像與頁籤列的「⋯」);開著沒有回報給外層詳情卡片(`useDesignerDrawerStore`),
 *   由卡片讓出抽屜寬(`designerDrawerReserve`),工具列的 [存草稿] 也露在外面。
 */
export const DesignerPropertyPanel = ({
  label,
  closeLabel,
  isTablet,
  isOpen,
  source,
  onClose,
  panelRef,
  children,
}: DesignerPropertyPanelProps) => {
  const focusable = panelRef === undefined ? {} : { tabIndex: -1 };
  const report = useDesignerDrawerStore((state) => state.report);
  const isDrawerShown = isTablet && isOpen;
  useEffect(() => {
    report(source, isDrawerShown);
  }, [report, source, isDrawerShown]);
  useEffect(
    () => () => {
      report(source, false);
    },
    [report, source],
  );

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
      topOffset={SHELL_HEADER_HEIGHT}
    >
      {/* 抽屜本身已是以標題命名的 region,這層只當程式聚焦的落點 */}
      <Box ref={panelRef} {...focusable}>
        {children}
      </Box>
    </Drawer>
  );
};
