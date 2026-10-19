/**
 * 滿版版面的高度鏈檢查(STYLE-08 / STYLE-11;滿版高度曾反覆被回報)。
 *
 * jsdom 不做版面計算,所以驗不到「有沒有真的撐滿」——
 * 但撐不滿的**原因**永遠是同兩件事,而那兩件事讀得到宣告值:
 *
 * 1. 鏈上某一層漏了 `min-height: 0`,該層被內容撐高,`flex: 1` 等於沒作用;
 * 2. 鏈上多開了一層捲動,捲軸變成兩條(使用者清單的表格鏈就發生過)。
 *
 * 所以這裡驗的是**宣告**:從 `<main>` 往下到某個內部捲動容器,中間每一層都 `min-height: 0`,
 * 而且只有最底下那一層捲。實際的視覺滿版仍以 dev 目視為準。
 */
export interface HeightChainLink {
  /** 給失敗訊息認人用:標籤 + 第一個 class(`MuiCard-root` 之類看得出是哪一層) */
  readonly label: string;
  readonly minHeight: string;
  /** 這一層自己開了捲動(見 `isScrollable`) */
  readonly scrolls: boolean;
  readonly flexGrow: string;
}

/**
 * 三個方向都看:`@repo/ui/table` 的 `TableContainer` 只宣告 `overflow-x: auto`,
 * 但 CSS 規定一軸 auto、另一軸 visible 時另一軸也變成 auto —— 它在瀏覽器裡兩個方向都捲。
 */
const isScrollable = (element: HTMLElement) => {
  const style = globalThis.getComputedStyle(element);
  return [style.overflow, style.overflowX, style.overflowY].some((value) =>
    ["auto", "scroll"].includes(value),
  );
};

const linkOf = (element: HTMLElement): HeightChainLink => {
  const style = globalThis.getComputedStyle(element);
  const firstClass = element.className.split(" ", 1)[0] ?? "";
  return {
    label:
      firstClass === "" ? element.tagName : `${element.tagName}.${firstClass}`,
    minHeight: style.minHeight,
    scrolls: isScrollable(element),
    flexGrow: style.flexGrow,
  };
};

/**
 * 從 `anchor` 往上找到最近的捲動容器,再一路收集到 `<main>`(含)為止的每一層。
 * 回傳順序由內而外,`[0]` 就是那個捲動容器。找不到捲動容器、或走不到 `<main>` 時拋錯 ——
 * 兩者都代表版面已經不是「高度由殼給」的那個結構,測試該紅。
 */
export const heightChainOf = (anchor: HTMLElement): HeightChainLink[] => {
  let scroller: HTMLElement | null = anchor;
  while (scroller !== null && !isScrollable(scroller)) {
    scroller = scroller.parentElement;
  }
  if (scroller === null) {
    throw new Error("找不到捲動容器:這個區塊沒有任何一層開捲動");
  }

  const chain: HeightChainLink[] = [];
  let node: HTMLElement | null = scroller;
  while (node !== null) {
    chain.push(linkOf(node));
    if (node.tagName === "MAIN") {
      return chain;
    }
    node = node.parentElement;
  }
  throw new Error("捲動容器不在 <main> 底下:高度不是殼給的(STYLE-08)");
};
