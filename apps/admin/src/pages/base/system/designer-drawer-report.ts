import { createContext } from "react";

/**
 * 設計器的屬性抽屜回報「開著沒」給外面的詳情卡片(平板寬時卡片要讓出抽屜寬,`designerDrawerReserve`)。
 * 詳情卡片替每個會出現抽屜的區塊(設計器、唯讀版本檢視)各包一層、各記一個狀態,
 * 只看目前顯示的那一個 —— 藏起來的區塊抽屜也跟著藏,不該讓卡片讓位。沒有外層時什麼都不做。
 */
export const DesignerDrawerReportContext = createContext<
  (isOpen: boolean) => void
>(() => {
  // 沒有詳情卡片接收(單獨渲染設計器時):不需要讓位
});
