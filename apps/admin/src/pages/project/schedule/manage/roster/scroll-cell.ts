const SCROLLABLE = /auto|scroll|overlay/u;

const centerOffset = (
  container: HTMLElement,
  element: HTMLElement,
  axis: "x" | "y",
): number => {
  const box = container.getBoundingClientRect();
  const target = element.getBoundingClientRect();
  return axis === "x"
    ? container.scrollLeft +
        (target.left + target.width / 2) -
        (box.left + container.clientWidth / 2)
    : container.scrollTop +
        (target.top + target.height / 2) -
        (box.top + container.clientHeight / 2);
};

/**
 * 把格子捲到它所在捲動區塊的中間(檢核 [查看] 用),只動**檢視自己的捲動容器**:
 * 往上找可捲動的祖先,橫向捲到 `<main>` 之前為止 —— `<main>` 是外殼的頁面最小寬度造成的水平捲動
 * (平板 1024 時內容比視窗寬),捲它會讓整頁(分頁籤、工具列)跟著偏移;直向照常捲到看得到。
 * 不用 `scrollIntoView`:它會連 `<main>` 的橫向一起捲。
 */
export const scrollCellIntoView = (element: HTMLElement): void => {
  let node = element.parentElement;
  while (node !== null) {
    const style = getComputedStyle(node);
    const isMain = node.tagName === "MAIN";
    if (
      !isMain &&
      SCROLLABLE.test(style.overflowX) &&
      node.scrollWidth > node.clientWidth
    ) {
      node.scrollLeft = centerOffset(node, element, "x");
    }
    if (
      SCROLLABLE.test(style.overflowY) &&
      node.scrollHeight > node.clientHeight
    ) {
      node.scrollTop = centerOffset(node, element, "y");
    }
    if (isMain) {
      return;
    }
    node = node.parentElement;
  }
};
