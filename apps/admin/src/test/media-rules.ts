/**
 * 讀元素在某條斷點 `@media` 裡的 CSS 宣告原文(emotion 插進 `<style>` 的規則)。
 *
 * jsdom 的 `getComputedStyle` 不套 `@media`、也不算 `calc()`,響應式的值只能讀宣告:
 * `sx` 的斷點物件語法每個斷點各一條 `@media (min-width:<斷點>px)`(xs = `0px`)。
 * 實際的版面仍以 mock 模式目視 / 量測為準;這裡守的是「宣告不再退回去」。
 */
export const mediaRulesOf = (element: Element, minWidth: number): string => {
  const classes = [...element.classList];
  const rules = [...document.styleSheets].flatMap((sheet) => [
    ...sheet.cssRules,
  ]);
  return rules
    .filter((rule) =>
      rule.cssText.startsWith(`@media (min-width:${String(minWidth)}px)`),
    )
    .map((rule) => rule.cssText)
    .filter((text) => classes.some((name) => text.includes(`.${name} `)))
    .join("\n");
};
