import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import type { FormDefinition } from "@repo/domain/form";

import {
  canvas,
  findDesigner,
  preloadFormsPage,
  renderFormsPage,
} from "./forms-page-test-support";

preloadFormsPage();

/** 存草稿送出的第 n 筆的第一個分區(input 的 `layout` 是 JSON scalar)。 */
const savedSection = (saves: readonly { layout: unknown }[], index: number) =>
  (saves[index]?.layout as FormDefinition["layout"] | undefined)?.sections[0];

const properties = () => screen.getByRole("region", { name: "屬性" });

describe("表單管理:設計器的分區設定(可以收合、預設收合、收合時標題列顯示的欄位)", () => {
  it("打開分區設定 → 三個設定寫進草稿的 layout;關掉可以收合時另兩項一起拿掉", async () => {
    const { user, world } = renderFormsPage();
    await findDesigner();

    await user.click(
      within(canvas()).getByRole("button", { name: "分區設定「採購內容」" }),
    );
    // 畫布上打開設定的那個分區反白
    expect(
      within(canvas()).getByRole("region", { name: "採購內容" }),
    ).toHaveAttribute("aria-current", "true");
    const panel = properties();
    expect(within(panel).getByText("分區設定 — 採購內容")).toBeInTheDocument();
    const defaultCollapsed = within(panel).getByRole("switch", {
      name: "預設收合",
    });
    expect(defaultCollapsed).toBeDisabled();
    expect(
      within(panel).getByRole("button", { name: "+ 欄位" }),
    ).toBeDisabled();

    await user.click(within(panel).getByRole("switch", { name: "可以收合" }));
    await user.click(defaultCollapsed);
    await user.click(within(panel).getByRole("button", { name: "+ 欄位" }));
    // 只列本分區的欄位;選了就不再出現在選單
    await user.click(await screen.findByRole("menuitem", { name: "品項" }));
    expect(
      within(
        within(panel).getByRole("list", { name: "收合時標題列顯示的欄位" }),
      ).getByText("品項"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "存草稿" }));
    await waitFor(() => {
      expect(world.inputs.saveFormVersionDraft).toHaveLength(1);
    });
    expect(savedSection(world.inputs.saveFormVersionDraft, 0)).toMatchObject({
      key: "basic",
      collapsible: true,
      defaultCollapsed: true,
      summaryFieldKeys: ["item"],
    });

    await user.click(within(panel).getByRole("switch", { name: "可以收合" }));
    await user.click(screen.getByRole("button", { name: "存草稿" }));
    await waitFor(() => {
      expect(world.inputs.saveFormVersionDraft).toHaveLength(2);
    });
    const section = savedSection(world.inputs.saveFormVersionDraft, 1);
    expect(section).not.toHaveProperty("collapsible");
    expect(section).not.toHaveProperty("defaultCollapsed");
    expect(section).not.toHaveProperty("summaryFieldKeys");
  });

  it("選欄位會離開分區設定;「← 表單設定」回到表單設定", async () => {
    const { user } = renderFormsPage();
    await findDesigner();

    await user.click(
      within(canvas()).getByRole("button", { name: "分區設定「採購內容」" }),
    );
    await user.click(
      within(properties()).getByRole("button", { name: "← 表單設定" }),
    );
    expect(
      within(properties()).queryByText("分區設定 — 採購內容"),
    ).not.toBeInTheDocument();

    await user.click(
      within(canvas()).getByRole("button", { name: "分區設定「採購內容」" }),
    );
    await user.click(
      within(canvas()).getByRole("button", { name: "選取欄位「數量」(qty)" }),
    );
    expect(
      await within(properties()).findByRole("textbox", { name: "顯示名稱" }),
    ).toHaveValue("數量");
  });
});
