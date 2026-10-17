import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen } from "@testing-library/react";

import { mediaRulesOf } from "@/test/media-rules";
import { setupReactFlowEnvironment } from "@/test/react-flow";

import {
  findCanvas,
  propertiesPanel,
  renderWorkflows,
} from "./workflows-page-test-support";

setupReactFlowEnvironment();

beforeAll(async () => {
  await import("./WorkflowsPage");
});

/** 主題斷點(MUI 預設):xs 0、xl 1536。jsdom 不套 @media,讀宣告原文(`@/test/media-rules`)。 */
const XS = 0;
const XL = 1536;

/**
 * T48:流程管理頁原本宣告內容區最小寬度 `xl`,1440 / 1280 寬時 `<main>` 水平溢出。
 * 改成沿用殼層 `lg`(`ShellLayout.test.tsx` 守),設計器在 `xl` 以下收窄屬性面板
 * (與表單設計器共用 `pages/base/system/designer-layout.ts`)。實際寬度以 mock 模式量測為準。
 */
describe("流程管理:設計器的響應式版面(T48)", () => {
  it("屬性面板 xl 以下收窄(300)、xl 起 360", async () => {
    renderWorkflows();
    await findCanvas();

    const panel = propertiesPanel();
    expect(mediaRulesOf(panel, XS)).toContain("width: 300px;");
    expect(mediaRulesOf(panel, XL)).toContain("width: 360px;");
  });

  it("標頭:標題欄以內容寬為底,操作鈕自成一組可整組換行(不把標題擠扁)", async () => {
    renderWorkflows();
    await findCanvas();

    const titleColumn = screen.getByRole("heading", { level: 1 }).parentElement;
    if (titleColumn === null) {
      throw new Error("標題沒有父層");
    }
    const style = globalThis.getComputedStyle(titleColumn);
    expect(style.flexBasis).toBe("auto");
    expect(style.minWidth).toBe("0");

    const actions = titleColumn.nextElementSibling;
    if (actions === null) {
      throw new Error("標題欄後面沒有操作鈕組");
    }
    expect(actions.querySelectorAll("button").length).toBeGreaterThan(0);
    expect(globalThis.getComputedStyle(actions).flexWrap).toBe("wrap");
  });
});
