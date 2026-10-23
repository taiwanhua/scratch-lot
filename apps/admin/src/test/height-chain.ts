import { mediaRulesOf } from "./media-rules";

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

/** 頁面根(`shell-content` 的直接子層)在殼的 column flex 欄裡的宣告值。 */
export interface PageRootLink {
  readonly label: string;
  readonly flexGrow: string;
  readonly flexShrink: string;
  readonly flexBasis: string;
  readonly minHeight: string;
  /** 自己裁切溢出(`overflow: hidden` / `clip`;MUI `Card` 預設如此) */
  readonly clips: boolean;
}

const clipsOverflow = (element: HTMLElement) => {
  const style = globalThis.getComputedStyle(element);
  return [style.overflow, style.overflowY].some((value) =>
    ["hidden", "clip"].includes(value),
  );
};

/** 宣告值是 0(jsdom 原樣回傳宣告值:`0`、`0px`、`0%` 都可能)。 */
const isZero = (value: string) => ["0", "0px", "0%"].includes(value);

/**
 * 頁面根:`anchor` 往上找到 `shell-content`(殼的內容區,STYLE-08)的直接子層。
 * 走不到 `shell-content` 時拋錯 —— 那代表頁面不在殼裡,測試該紅。
 */
export const pageRootOf = (anchor: HTMLElement): HTMLElement => {
  let node: HTMLElement | null = anchor;
  while (node !== null) {
    const parent: HTMLElement | null = node.parentElement;
    if (parent?.dataset.testid === "shell-content") {
      return node;
    }
    node = parent;
  }
  throw new Error("找不到 shell-content:這個元素不在殼的內容區裡");
};

/** 主題斷點(MUI 預設,px):`sx` 的斷點物件每個斷點各一條 `@media (min-width:<值>px)`。 */
const BREAKPOINTS = [0, 600, 900, 1200, 1536] as const;

/** 列表頁殼釘高的起點(`md`;`lib/base/list-page-layout.ts` 的 `LIST_PAGE_PIN_BREAKPOINT`)。 */
export const LIST_PIN_MIN_WIDTH = 900;

/** `flex` 簡寫 → 三個值(只處理 sx 會產生的寫法:`1`、`1 0 auto`、`none`)。 */
const expandFlex = (value: string) => {
  if (value === "none") {
    return { flexGrow: "0", flexShrink: "0", flexBasis: "auto" };
  }
  const [grow = "0", shrink = "1", basis = "0%"] = value.trim().split(/\s+/);
  return { flexGrow: grow, flexShrink: shrink, flexBasis: basis };
};

const declarationIn = (cssText: string, property: string) => {
  const match = new RegExp(
    String.raw`(?:^|[\s;{])${property}:\s*([^;}]+)`,
  ).exec(cssText);
  return match?.[1]?.trim();
};

/**
 * 頁面根在視窗寬 `width` 時宣告的 flex 與 min-height:先取不分斷點的值(getComputedStyle),
 * 再依序疊上不超過 `width` 的每條斷點 `@media` 宣告(jsdom 不套 `@media`,只能讀宣告;`test/media-rules.ts`)。
 */
export const declaredFlexAt = (element: HTMLElement, width: number) => {
  const style = globalThis.getComputedStyle(element);
  const declared = {
    flexGrow: style.flexGrow,
    flexShrink: style.flexShrink,
    flexBasis: style.flexBasis,
    minHeight: style.minHeight,
  };
  for (const breakpoint of BREAKPOINTS.filter((value) => value <= width)) {
    const text = mediaRulesOf(element, breakpoint);
    const flex = declarationIn(text, "flex");
    if (flex !== undefined) {
      Object.assign(declared, expandFlex(flex));
    }
    for (const [property, key] of [
      ["flex-grow", "flexGrow"],
      ["flex-shrink", "flexShrink"],
      ["flex-basis", "flexBasis"],
      ["min-height", "minHeight"],
    ] as const) {
      const value = declarationIn(text, property);
      if (value !== undefined) {
        declared[key] = value;
      }
    }
  }
  return declared;
};

export const pageRootLinkOf = (
  root: HTMLElement,
  width: number,
): PageRootLink => {
  const declared = declaredFlexAt(root, width);
  return {
    ...linkOf(root),
    ...declared,
    clips: clipsOverflow(root),
  };
};

/** 釘高 = `flex-basis: 0` + `min-height: 0`(高度由殼給,不看內容)。 */
export const isPinnedAt = (root: HTMLElement, width: number): boolean => {
  const declared = declaredFlexAt(root, width);
  return isZero(declared.minHeight) && isZero(declared.flexBasis);
};

/**
 * 列表頁殼(`LIST_PAGE_SHELL_SX`):`md` 以下不釘高(`flex-shrink: 0`)、平板以上(`md` 起)釘高。
 * 主從版面從 `sm` 起就釘高,不算(REACT-17)。
 */
export const isListPageShell = (root: HTMLElement): boolean =>
  declaredFlexAt(root, LIST_PIN_MIN_WIDTH - 1).flexShrink === "0" &&
  isPinnedAt(root, LIST_PIN_MIN_WIDTH);

/** 子樹裡有一層捲動容器,從它到 `root` 的每一層都 `min-height: 0`:超出量由它吃掉。 */
const hasAbsorbingScroller = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>("*")].some((element) => {
    if (!isScrollable(element)) {
      return false;
    }
    for (
      let node: HTMLElement | null = element.parentElement;
      node !== null && node !== root;
      node = node.parentElement
    ) {
      if (!isZero(globalThis.getComputedStyle(node).minHeight)) {
        return false;
      }
    }
    return true;
  });

/**
 * 頁面根在視窗寬 `width` 時會不會被殼的 flex 欄壓扁、把內容裁掉(STYLE-08;回傳問題描述,沒問題回 null)。
 *
 * 殼的內容區是釘了高的 column flex,子層預設 `flex-shrink: 1`;`overflow` 不是 visible 的子層,
 * `min-height: auto` 算成 0 —— 內容一長,裁切的根(`Card` / `Paper`)就被壓到殼高、超出的部分直接消失,
 * `<main>` 也沒東西可捲。合法的只有兩種:
 *
 * 1. 不裁切(`Stack` / `Box` 這類 overflow visible 的根,壓了內容也會溢出給 `<main>` 捲),或 `flex-shrink: 0`
 *    (一般內容頁 `flexGrow: 1; flexShrink: 0`,內容多時跟著長);
 * 2. 刻意釘高(`flex-basis: 0` + `min-height: 0`),而且子樹有一層捲動容器,從它到頁面根的每一層都 `min-height: 0`
 *    (主從版面、列表頁:超出量由那一層吃掉)。頁內分頁殼(根裡有 `tabpanel`)只有列表分頁在平板以上可以釘高,
 *    手機寬一律不釘。
 */
export const squeezedPageRootProblem = (
  root: HTMLElement,
  width: number,
): string | null => {
  const link = pageRootLinkOf(root, width);
  if (!link.clips || link.flexShrink === "0") {
    return null;
  }
  const at = `${String(width)}px 寬`;
  if (!isPinnedAt(root, width)) {
    return `${at}:${link.label} 會被壓扁:裁切溢出、flex-shrink ${link.flexShrink || "未宣告(預設 1)"}、flex-basis ${link.flexBasis || "未宣告(預設 auto)"}(一般內容頁用 flexGrow 1 + flexShrink 0)`;
  }
  if (
    width < LIST_PIN_MIN_WIDTH &&
    root.querySelector('[role="tabpanel"]') !== null
  ) {
    return `${at}:${link.label} 是頁內分頁殼,手機寬卻釘了高(列表分頁用 LIST_PAGE_SHELL_SX,其餘 flexGrow 1 + flexShrink 0)`;
  }
  return hasAbsorbingScroller(root)
    ? null
    : `${at}:${link.label} 釘了高但子樹沒有一層吃得掉超出量的捲動容器:超出的內容會被裁掉`;
};
