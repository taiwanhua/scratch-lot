import { describe, expect, it } from "@jest/globals";
import { screen } from "@testing-library/react";

import { mediaRulesOf } from "@/test/media-rules";

import {
  findDesigner,
  preloadFormsPage,
  renderFormsPage,
  smallDesignOptions,
} from "./forms-page-test-support";

preloadFormsPage();

/** 主題斷點(MUI 預設):xs 0、xl 1536。jsdom 不套 @media,讀宣告原文(`@/test/media-rules`)。 */
const XS = 0;
const XL = 1536;

/**
 * T48:表單管理頁在 1440 寬水平溢出 —— 原因是頁面宣告內容區最小寬度 `xl`(三欄設計器放不下)。
 * 改成沿用殼層 `lg`(`ShellLayout.test.tsx` 守),設計器在 `xl` 以下自己換版。這裡守換版的宣告;
 * 實際寬度以 mock 模式量 `<main>` 的 `scrollWidth === clientWidth` 為準(1440 / 1280)。
 */
describe("表單管理:設計器的響應式版面(T48)", () => {
  it("xl 以下元件面板佔滿一列、橫向換行,工作區換行;xl 起三欄並排", async () => {
    renderFormsPage(smallDesignOptions());
    const palette = await findDesigner();
    const workspace = palette.parentElement;
    if (workspace === null) {
      throw new Error("元件面板沒有父層");
    }

    const paletteNarrow = mediaRulesOf(palette, XS);
    expect(paletteNarrow).toContain("width: 100%;");
    expect(paletteNarrow).toContain("flex-direction: row;");
    expect(paletteNarrow).toContain("flex-wrap: wrap;");
    const paletteWide = mediaRulesOf(palette, XL);
    expect(paletteWide).toContain("width: 180px;");
    expect(paletteWide).toContain("flex-direction: column;");

    expect(mediaRulesOf(workspace, XS)).toContain("flex-wrap: wrap;");
    expect(mediaRulesOf(workspace, XL)).toContain("flex-wrap: nowrap;");
  });

  it("屬性面板 xl 以下收窄(300)、xl 起 360;畫布可縮(min-width: 0)", async () => {
    renderFormsPage(smallDesignOptions());
    await findDesigner();

    const panel = screen.getByRole("region", { name: "屬性" });
    expect(mediaRulesOf(panel, XS)).toContain("width: 300px;");
    expect(mediaRulesOf(panel, XL)).toContain("width: 360px;");
    expect(
      globalThis.getComputedStyle(screen.getByRole("region", { name: "畫布" }))
        .minWidth,
    ).toBe("0");
  });

  it("標頭:xl 以下標題欄以內容寬為底(xl 起照舊 basis 0),操作鈕自成一組可整組換行(不把標題擠扁)", async () => {
    renderFormsPage(smallDesignOptions());
    await findDesigner();

    const title = screen.getByRole("heading", { level: 1 });
    const titleColumn = title.parentElement;
    if (titleColumn === null) {
      throw new Error("標題沒有父層");
    }
    expect(mediaRulesOf(titleColumn, XS)).toContain("flex-basis: auto;");
    expect(mediaRulesOf(titleColumn, XL)).toContain("flex-basis: 0;");
    expect(globalThis.getComputedStyle(titleColumn).minWidth).toBe("0");

    const actions = screen.getByRole("button", {
      name: "分派租戶",
    }).parentElement;
    expect(actions).not.toBe(titleColumn.parentElement);
    expect(actions?.parentElement).toBe(titleColumn.parentElement);
    expect(globalThis.getComputedStyle(actions as Element).flexWrap).toBe(
      "wrap",
    );
  });
});
