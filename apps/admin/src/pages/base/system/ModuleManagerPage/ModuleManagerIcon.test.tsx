import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  WITHOUT_SET_ICON,
  detail,
  renderPage,
  waitForTree,
} from "./module-manager-test-support";

/**
 * 模組與權限頁的「圖示」欄位(權限 `system.module-manager.set-icon`)。
 * 預設選中的是第一棵樹的根 —— 夾具裡是「總覽」,初始圖示 `dashboard`。
 */

const iconPicker = () =>
  within(detail()).getByRole("combobox", { name: "圖示" });

describe("圖示欄位", () => {
  it("有 set-icon 權限:顯示目前圖示,選了就送出並重新查樹", async () => {
    const { user, fake } = renderPage();
    await waitForTree();

    expect(iconPicker()).toHaveTextContent("儀表板");
    const treeCallsBefore = fake.calls.moduleTree;

    await user.click(iconPicker());
    await user.click(await screen.findByRole("option", { name: "首頁" }));

    await waitFor(() => {
      expect(fake.inputs.setModuleIcon).toEqual([
        { id: "m-overview", icon: "home" },
      ]);
    });
    // invalidate 之後真的重新查了一次(側欄吃的 `me` 也一併失效)
    await waitFor(() => {
      expect(fake.calls.moduleTree).toBeGreaterThan(treeCallsBefore);
    });
    await waitFor(() => {
      expect(iconPicker()).toHaveTextContent("首頁");
    });
  });

  it("只有 toggle-enabled 沒有 set-icon:只看得到目前圖示,沒有選擇器(兩把鑰匙各管各的)", async () => {
    renderPage({ permissions: WITHOUT_SET_ICON });
    await waitForTree();

    expect(
      within(detail()).queryByRole("combobox", { name: "圖示" }),
    ).not.toBeInTheDocument();
    expect(within(detail()).getByText("圖示")).toBeInTheDocument();
    expect(within(detail()).getByText("儀表板")).toBeInTheDocument();
  });
});
