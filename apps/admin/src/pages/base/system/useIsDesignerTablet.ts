import { useBreakpointDown } from "@repo/ui/media-query";

import { DESIGNER_TABLET_BELOW } from "./designer-layout";

/**
 * 視窗是否在設計器的「平板寬」(`sm` ≤ 視窗 < `lg`,`designer-layout.ts` 的 `DESIGNER_TABLET_BELOW`):
 * 兩個設計器頁(表單管理、流程管理)在這個範圍收起左清單、屬性面板改成右側抽屜。
 * 手機寬(< `sm`)不算 —— 那裡不掛設計器,只顯示唯讀摘要(REACT-17)。
 */
export const useIsDesignerTablet = (): boolean => {
  const isBelowDesktop = useBreakpointDown(DESIGNER_TABLET_BELOW);
  const isMobile = useBreakpointDown("sm");
  return isBelowDesktop && !isMobile;
};
