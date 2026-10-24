/**
 * 讀元素在某條 `@media` 裡的 CSS 宣告原文(emotion 插進 `<style>` 的規則)。
 *
 * jsdom 的 `getComputedStyle` 不套 `@media`、也不算 `calc()`,響應式的值只能讀宣告:
 * `sx` 的斷點物件語法每個斷點各一條 `@media (min-width:<斷點>px)`(xs = `0px`);
 * 另外寫成 theme 函式的條件(例:列表頁殼「寬 ≥ `md` 且視窗高 ≥ 720px」)是 `@media (min-width:…) and (min-height:…)`。
 * 實際的版面仍以 mock 模式目視 / 量測為準;這裡守的是「宣告不再退回去」。
 */

/** 模擬的視窗大小(px)。 */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

const mediaRules = () =>
  [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]);

/** `@media <條件> {` 的條件原文;不是 `@media` 規則回 null。 */
const conditionOf = (cssText: string) => {
  const brace = cssText.indexOf("{");
  return cssText.startsWith("@media ") && brace > 0
    ? cssText.slice("@media ".length, brace).trim()
    : null;
};

const appliesTo = (element: Element, cssText: string) =>
  [...element.classList].some((name) => cssText.includes(`.${name} `));

/** 只認 `(min|max)-(width|height):<n>px` 以 `and` 串起來的條件;其餘寫法一律當不成立(測試該紅,而不是悄悄套用)。 */
const matchesViewport = (condition: string, viewport: Viewport) =>
  condition.split(" and ").every((part) => {
    const match = /^\((min|max)-(width|height):\s*([\d.]+)px\)$/.exec(
      part.trim(),
    );
    if (match === null) {
      return false;
    }
    const [, bound, axis, raw] = match;
    const actual = axis === "width" ? viewport.width : viewport.height;
    const limit = Number(raw);
    return bound === "min" ? actual >= limit : actual <= limit;
  });

/** 只有 `(min-width:<minWidth>px)` 這一個條件的規則(`sx` 斷點物件產生的那種)。 */
export const mediaRulesOf = (element: Element, minWidth: number): string =>
  mediaRules()
    .map((rule) => rule.cssText)
    .filter(
      (text) =>
        conditionOf(text) === `(min-width:${String(minWidth)}px)` &&
        appliesTo(element, text),
    )
    .join("\n");

/** 在視窗 `viewport` 下會成立的每一條 `@media` 規則,依樣式表順序(後面的蓋前面的)。 */
export const mediaRulesAt = (element: Element, viewport: Viewport): string[] =>
  mediaRules()
    .map((rule) => rule.cssText)
    .filter((text) => {
      const condition = conditionOf(text);
      return (
        condition !== null &&
        appliesTo(element, text) &&
        matchesViewport(condition, viewport)
      );
    });
