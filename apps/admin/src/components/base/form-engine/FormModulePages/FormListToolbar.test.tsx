import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";

import { defaultLocale, messages } from "@repo/i18n";
import { AppThemeProvider } from "@repo/ui/app-theme-provider";
import { defaultBrand } from "@repo/ui/theme";

import { FormListToolbar } from "./FormListToolbar";

const noop = () => {
  // 回呼在本測試不觸發
};

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
  it("欄距用 gap 不用 margin:換行後第一個欄位和上一行左對齊", () => {
    render(
      <IntlProvider locale={defaultLocale} messages={messages[defaultLocale]}>
        <AppThemeProvider brand={defaultBrand}>
          <FormListToolbar
            keyword=""
            onKeywordChange={noop}
            forms={[]}
            formKey={null}
            onFormKeyChange={noop}
            status={null}
            onStatusChange={noop}
            canCreate={false}
            hasForms={false}
            onCreate={noop}
          />
        </AppThemeProvider>
      </IntlProvider>,
    );

    const row = screen.getByRole("textbox").closest(".MuiStack-root");
    expect(row).not.toBeNull();
    const css = declaredCss(row ?? document.body);
    expect(css).toContain("flex-wrap: wrap");
    expect(css).toMatch(/(^|[\s;{])gap:/);
    // Stack spacing 的 margin 模式會對第二個起的子元素下 margin-left(換行後的首欄因此不齊)
    expect(css).not.toMatch(/margin/);
  });
});
