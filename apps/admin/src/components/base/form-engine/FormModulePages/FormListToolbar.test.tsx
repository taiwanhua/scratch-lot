import { describe, expect, it } from "@jest/globals";
import { screen } from "@testing-library/react";

import { DEMO_FORM_ROUTES, submissionFragment } from "@/test/msw/form-fixtures";
import { setupFakeViewport } from "@/test/viewport";

import {
  defaultRuntimeOptions,
  renderShopping,
} from "./form-module-test-support";

setupFakeViewport();

/**
 * 元素宣告的 CSS(emotion 插進 `<style>` 的規則原文,含 `& > :not(style) ~ :not(style)` 這類子選擇器)。
 * jsdom 不算版面,換行後對不對齊量不到;對不齊的原因是欄距用子元素的 margin 排,所以直接讀宣告。
 */
const declaredCss = (element: Element): string => {
  const classes = [...element.classList];
  return [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .map((rule) => rule.cssText)
    .filter((text) => classes.some((name) => text.includes(`.${name}`)))
    .join("\n");
};

describe("FormListToolbar(列表頁的過濾條件列)", () => {
  it("欄距用 gap 不用 margin:換行後第一個欄位和上一行左對齊", async () => {
    renderShopping({
      path: DEMO_FORM_ROUTES.list,
      world: {
        ...defaultRuntimeOptions(),
        submissions: [submissionFragment()],
      },
    });

    const search = await screen.findByRole("textbox", { name: "搜尋" });
    const row = search.closest(".MuiStack-root");
    expect(row).not.toBeNull();
    // 篩選列(表單、狀態、組織、日期起迄)與搜尋框在同一列
    expect(row).toContainElement(
      screen.getByRole("combobox", { name: "狀態" }),
    );
    expect(row).toContainElement(screen.getByRole("group", { name: "日期起" }));
    const css = declaredCss(row ?? document.body);
    expect(css).toContain("flex-wrap: wrap");
    expect(css).toMatch(/(^|[\s;{])gap:/);
    // Stack spacing 的 margin 模式會對第二個起的子元素下 margin-left(換行後的首欄因此不齊)
    expect(css).not.toMatch(/margin/);
  });
});
