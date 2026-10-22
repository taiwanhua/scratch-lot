import { useLayoutEffect, useState } from "react";

/** 預設下限:量到的空間小於此值時不設上限(捲動區塊依內容長高),整頁只由 `<main>` 捲(例:手機工具列與圖例換成多行)。 */
const DEFAULT_MIN_HEIGHT = 240;

/** 從 `boundary` 的父層往上到 `<main>`(含)的下內距與下框線:殼與頁殼留在內容下方的空間。 */
const trailingSpaceOf = (boundary: HTMLElement, main: HTMLElement) => {
  let total = 0;
  for (
    let node = boundary.parentElement;
    node !== null;
    node = node.parentElement
  ) {
    const style = globalThis.getComputedStyle(node);
    total += Number.parseFloat(style.paddingBottom) || 0;
    if (node === main) {
      return total;
    }
    total += Number.parseFloat(style.borderBottomWidth) || 0;
  }
  return total;
};

export interface FitMainHeightOptions {
  /**
   * 量「捲動區塊下面還有多少內容」的邊界(`closest()` 的選擇器;沒給或找不到 = 捲動區塊自己)。
   * 邊界要是**高度跟著內容長**、不含旁邊並排區塊的那一欄:含了比內容高的側欄(例:sticky 面板),
   * 上限一壓低,邊界就被側欄撐高、量到的空間又更小,會來回跳。
   */
  boundarySelector?: string;
  /** 下限(px):剩下的空間不到它時不設上限,只由 `<main>` 捲。預設 240 */
  minHeight?: number;
}

/**
 * 量出內層捲動區塊(表格、時間軸)能用的高度:`<main>` 的可見高度扣掉同頁其他內容
 * (上方工具列、下方圖例、殼與頁殼的內距)。不寫死工具列高度 —— 工具列換行、視窗大小改變時都重算
 * (STYLE-08:頁面不釘高、交給 `<main>` 捲;要 sticky 表頭與看得到的橫向捲軸的區塊保留一層內層捲動,
 * 但高度剛好塞滿 `<main>`,不會出現兩層垂直捲動)。
 * 剩下的空間不到 `minHeight` 時不設上限:捲動區塊依內容長高、只由 `<main>` 捲(仍然只有一層垂直捲動)。
 * 量到的值不隨捲動區塊自己的高度變(上方位置、下方內容、內距都與它無關),所以重算不會來回跳。
 *
 * 回傳 `[height, setTarget]`:`setTarget` 當 ref 接在捲動區塊外面那層;`height` 是捲動區塊可用的像素
 * (已扣掉外層的橫向捲軸);還沒量到、或空間不足時為 null(不設上限)。
 */
export const useFitMainHeight = ({
  boundarySelector,
  minHeight = DEFAULT_MIN_HEIGHT,
}: FitMainHeightOptions = {}) => {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const main = element?.closest("main") ?? null;
    if (element === null || main === null) {
      return;
    }
    const boundary =
      (boundarySelector === undefined
        ? null
        : element.closest<HTMLElement>(boundarySelector)) ?? element;
    const measure = () => {
      const mainTop = main.getBoundingClientRect().top + main.clientTop;
      const rect = element.getBoundingClientRect();
      // 捲動區塊在 <main> 捲動內容裡的位置(含 <main> 上內距與上方工具列)
      const above = rect.top - mainTop + main.scrollTop;
      // 捲動區塊下面同一欄的內容(例:圖例、手機底部面板留白)
      const below = boundary.getBoundingClientRect().bottom - rect.bottom;
      const available = Math.floor(
        main.clientHeight -
          above -
          below -
          trailingSpaceOf(boundary, main) -
          // 外層自己的橫向捲軸與框線(週檢視的外層區塊左右捲動)
          (element.offsetHeight - element.clientHeight),
      );
      const next = available >= minHeight ? available : null;
      setHeight((current) => (current === next ? current : next));
    };
    measure();
    if (typeof globalThis.ResizeObserver !== "function") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    observer.observe(boundary);
    return () => {
      observer.disconnect();
    };
  }, [element, boundarySelector, minHeight]);

  return [height, setElement] as const;
};
