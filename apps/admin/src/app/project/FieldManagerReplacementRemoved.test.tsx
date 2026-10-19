import { describe, expect, it, jest } from "@jest/globals";
import { screen, within } from "@testing-library/react";

/**
 * 把 `app/project/page-replacements.ts` 那一筆拿掉(整份換成空清單)→ 同一個網址回到底座的欄位管理頁:
 * 固定組裝入口、路由、殼都是真的,只有專案的替換清單換掉(ESM 要先登記 mock 再動態載入)。
 */
jest.unstable_mockModule("@/app/project/page-replacements", () => ({
  projectPageReplacements: [],
}));

const { modulePages } = await import("@/app/module-pages");
const { baseModulePages } = await import("@/app/base/module-pages");
const { findRowOf, renderColorPage, selectCategory } =
  await import("@/pages/project/system/FieldManagerWithColorPage/field-manager-color-test-support");

describe("欄位管理:解除客製替換的登記", () => {
  it("登記表回到底座頁", () => {
    const basePage = baseModulePages.pages.find(
      (page) => page.key === "system.field-manager",
    )?.Page;
    expect(basePage).toBeDefined();
    expect(modulePages["system.field-manager"]).toBe(basePage);
  });

  it("路由渲染底座頁:選項表沒有「顏色」欄,也不查顏色", async () => {
    const { user, colorFake } = renderColorPage();
    await selectCategory(user, "示範分類");
    await findRowOf("炸物");

    const headers = within(
      screen.getByRole("region", { name: "欄位選項" }),
    ).getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).not.toContain("顏色");
    expect(colorFake.calls.fieldOptionColors).toBe(0);
  });
});
