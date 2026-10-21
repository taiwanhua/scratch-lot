import { useLayoutEffect, useState } from "react";

/** 排班表整頁的根節點(`RosterPage` 標 `data-roster-root`):量「捲動區塊下面還有多少內容」的邊界。 */
const ROSTER_ROOT_SELECTOR = "[data-roster-root]";

/** 量到的空間小於此值時不設上限(捲動區塊依內容長高),整頁只由 `<main>` 捲(例:手機工具列與圖例換成多行)。 */
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

/**
 * 量出內層捲動區塊(排班表、時間軸)能用的高度:`<main>` 的可見高度扣掉同頁其他內容
 * (上方工具列、下方圖例、殼與頁殼的內距)。不寫死工具列高度 —— 工具列換行、檢核面板開關、
 * 視窗大小改變時都重算(STYLE-08:頁面不釘高、交給 `<main>` 捲;排班表要 sticky 表頭與看得到的
 * 橫向捲軸,所以保留這一層內層捲動,但高度剛好塞滿 `<main>`,不會出現兩層垂直捲動)。
 * 剩下的空間不到 `minHeight` 時不設上限:捲動區塊依內容長高、只由 `<main>` 捲(仍然只有一層垂直捲動)。
 *
 * 回傳 `[height, setTarget]`:`setTarget` 當 ref 接在捲動區塊外面那層;`height` 是捲動區塊可用的像素
 * (已扣掉外層的橫向捲軸);還沒量到、或空間不足時為 null(不設上限)。
 */
export const useFitMainHeight = (minHeight = DEFAULT_MIN_HEIGHT) => {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const main = element?.closest("main") ?? null;
    if (element === null || main === null) {
      return;
    }
    const boundary =
      element.closest<HTMLElement>(ROSTER_ROOT_SELECTOR) ?? element;
    const measure = () => {
      const mainTop = main.getBoundingClientRect().top + main.clientTop;
      const rect = element.getBoundingClientRect();
      // 捲動區塊在 <main> 捲動內容裡的位置(含 <main> 上內距與上方工具列)
      const above = rect.top - mainTop + main.scrollTop;
      // 捲動區塊下面同一頁的內容(圖例、手機檢核面板留白)
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
  }, [element, minHeight]);

  return [height, setElement] as const;
};
