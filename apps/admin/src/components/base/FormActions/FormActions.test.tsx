import { describe, expect, it, jest } from "@jest/globals";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import { AppThemeProvider } from "@repo/ui/app-theme-provider";
import { defaultBrand } from "@repo/ui/theme";

import { mediaRulesOf } from "@/test/media-rules";

import { FormActions } from "./FormActions";

const XS = 0;
const SM_TABLET = 600;
const MD_TABLET = 900;
const LG = 1200;

const noop = () => {
  // 回呼在本測試不觸發
};

const renderActions = (node: ReactNode) =>
  render(<AppThemeProvider brand={defaultBrand}>{node}</AppThemeProvider>);

const rowOf = (button: HTMLElement): HTMLElement => {
  const row = button.closest<HTMLElement>(".MuiStack-root");
  if (row === null) {
    throw new Error("找不到動作列");
  }
  return row;
};

describe("FormActions(新增 / 編輯頁的動作列,REACT-16)", () => {
  it("順序固定 [取消] → [存草稿] → [送出],variant 依位置 text / outlined / contained", () => {
    renderActions(
      <FormActions
        submit={{ label: "送出", onClick: noop }}
        draft={{ label: "存草稿", onClick: noop }}
        cancel={{ label: "取消", onClick: noop }}
      />,
    );

    const row = rowOf(screen.getByRole("button", { name: "送出" }));
    const names = within(row)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(names).toEqual(["取消", "存草稿", "送出"]);
    expect(screen.getByRole("button", { name: "取消" })).toHaveClass(
      "MuiButton-text",
    );
    expect(screen.getByRole("button", { name: "存草稿" })).toHaveClass(
      "MuiButton-outlined",
    );
    expect(screen.getByRole("button", { name: "送出" })).toHaveClass(
      "MuiButton-contained",
    );
  });

  it("按鈕群靠右;左側內容(合計、刪除)排在按鈕前面並佔掉剩餘寬度", () => {
    renderActions(
      <FormActions
        start={<span>共 3 本</span>}
        cancel={{ label: "取消", onClick: noop }}
        submit={{ label: "儲存", onClick: noop }}
      />,
    );

    const row = rowOf(screen.getByRole("button", { name: "儲存" }));
    const css = [...document.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules])
      .map((rule) => rule.cssText)
      .filter((text) =>
        [...row.classList].some((name) => text.startsWith(`.${name}`)),
      )
      .join("\n");
    expect(css).toContain("justify-content: flex-end");
    expect(row.firstElementChild).toHaveTextContent("共 3 本");
    expect(row.lastElementChild).toHaveTextContent("儲存");
  });

  it("手機與平板(lg 以下)黏在可視底部並補背景、上邊框、z-index;lg 起回到一般位置", () => {
    renderActions(<FormActions submit={{ label: "儲存", onClick: noop }} />);

    const row = rowOf(screen.getByRole("button", { name: "儲存" }));
    const xs = mediaRulesOf(row, XS);
    expect(xs).toContain("position: sticky;");
    expect(xs).toContain("z-index: var(--mui-zIndex-mobileStepper);");
    expect(xs).toContain("border-top: 1px solid;");
    expect(xs).toContain(
      "background-color: var(--mui-palette-background-paper);",
    );
    // 只宣告 xs 與 lg 兩段:sm / md(平板)沿用 xs 的黏底
    expect(mediaRulesOf(row, SM_TABLET)).toBe("");
    expect(mediaRulesOf(row, MD_TABLET)).toBe("");
    const lg = mediaRulesOf(row, LG);
    expect(lg).toContain("position: static;");
    expect(lg).toContain("z-index: auto;");
    expect(lg).toMatch(/border-top: 0/);
  });

  it("gutter:黏底時以負 margin 撐滿捲動卡片的左右內距,lg 起歸零", () => {
    renderActions(
      <FormActions gutter={3} submit={{ label: "儲存", onClick: noop }} />,
    );

    const row = rowOf(screen.getByRole("button", { name: "儲存" }));
    const xs = mediaRulesOf(row, XS);
    expect(xs).toContain("margin-left: calc(-3 * var(--mui-spacing));");
    expect(xs).toContain("padding-left: calc(3 * var(--mui-spacing));");
    const lg = mediaRulesOf(row, LG);
    expect(lg).toMatch(/margin-left: (0|calc\(0 \* var\(--mui-spacing\)\));/);
    expect(lg).toMatch(/padding-left: (0|calc\(0 \* var\(--mui-spacing\)\));/);
  });

  it("gutter 依斷點給:各斷點各自取負", () => {
    renderActions(
      <FormActions
        gutter={{ xs: 2, sm: 3 }}
        submit={{ label: "儲存", onClick: noop }}
      />,
    );

    const row = rowOf(screen.getByRole("button", { name: "儲存" }));
    expect(mediaRulesOf(row, XS)).toContain(
      "margin-left: calc(-2 * var(--mui-spacing));",
    );
    expect(mediaRulesOf(row, SM_TABLET)).toContain(
      "margin-left: calc(-3 * var(--mui-spacing));",
    );
  });

  it("沒給的按鈕不出現;停用與點擊照傳入的值", async () => {
    const onSubmit = jest.fn();
    renderActions(
      <FormActions submit={{ label: "儲存", onClick: onSubmit }} />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "儲存" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("disabled 的按鈕停用", () => {
    renderActions(
      <FormActions
        draft={{ label: "存草稿", onClick: noop, disabled: true }}
        submit={{ label: "送出", onClick: noop, disabled: true }}
      />,
    );

    expect(screen.getByRole("button", { name: "存草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "送出" })).toBeDisabled();
  });
});
