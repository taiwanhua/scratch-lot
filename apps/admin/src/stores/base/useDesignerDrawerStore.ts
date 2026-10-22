import { create } from "zustand";

/**
 * 設計器的屬性抽屜從哪裡打開:草稿的設計器(表單 / 流程設計器)或唯讀版本檢視(流程的 `FlowVersionViewer`)。
 * 兩者可能同時掛著(檢視版本時草稿的設計器藏起來但不卸載),詳情卡片只看目前顯示的那一個。
 */
export type DesignerDrawerSource = "designer" | "viewer";

/**
 * 平板寬時設計器的屬性抽屜開著沒(REACT-02:跨元件的用戶端狀態用 zustand)。
 *
 * 屬性面板(`pages/base/system/DesignerPropertyPanel.tsx`)在 effect 裡回報、卸載時歸零;需要它的是外層的
 * 詳情卡片(表單管理 / 流程管理的 `…DetailPanel`):抽屜開著時整張卡片讓出抽屜寬,工具列的 [存草稿] 才露得出來。
 * 表單、流程兩個設計器共用一份(屬性面板是同一個元件;兩頁不會同時顯示),以來源區分。
 */
export interface DesignerDrawerState {
  open: Readonly<Record<DesignerDrawerSource, boolean>>;
  report: (source: DesignerDrawerSource, isOpen: boolean) => void;
}

export const INITIAL_DESIGNER_DRAWER = {
  open: { designer: false, viewer: false },
} as const;

export const useDesignerDrawerStore = create<DesignerDrawerState>()((set) => ({
  ...INITIAL_DESIGNER_DRAWER,
  report: (source, isOpen) => {
    set((state) =>
      state.open[source] === isOpen
        ? state
        : { open: { ...state.open, [source]: isOpen } },
    );
  },
}));
