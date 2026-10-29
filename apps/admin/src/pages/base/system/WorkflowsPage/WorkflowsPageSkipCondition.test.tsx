import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { setupReactFlowEnvironment } from "@/test/react-flow";

import {
  clickNode,
  findCanvas,
  propertiesPanel,
  renderWorkflows,
} from "./workflows-page-test-support";

setupReactFlowEnvironment();

beforeAll(async () => {
  // 懶載入頁面的依賴鏈(React Flow、dagre、檢查器)先載好,不算進 findBy* 的等待(TEST-08)
  await import("./WorkflowsPage");
});

const optionsOf = async (
  user: ReturnType<typeof renderWorkflows>["user"],
  combobox: HTMLElement,
): Promise<string[]> => {
  await user.click(combobox);
  const listbox = await screen.findByRole("listbox");
  const names = within(listbox)
    .getAllByRole("option")
    .map((option) => option.textContent);
  await user.keyboard("{Escape}");
  return names;
};

describe("流程管理:跳過條件的型別導向選擇器", () => {
  it("根節點只列回是 / 否的運算;裡層參數可選系統值", async () => {
    const { user } = renderWorkflows();
    const canvas = await findCanvas();
    await user.click(screen.getByRole("combobox", { name: "檢查用表單" }));
    await user.click(await screen.findByRole("option", { name: "病假單" }));

    clickNode(canvas, "人資");
    await user.click(
      within(propertiesPanel()).getByRole("checkbox", { name: "符合跳過條件" }),
    );
    const skip = within(propertiesPanel()).getByRole("group", {
      name: "符合跳過條件",
    });
    await waitFor(() => {
      expect(within(skip).getByRole("button", { name: "設定" })).toBeEnabled();
    });
    await user.click(within(skip).getByRole("button", { name: "設定" }));

    // 病假單沒有是 / 否欄位:根只剩「運算」,而且只列回是 / 否的
    expect(
      await optionsOf(
        user,
        within(skip).getByRole("combobox", { name: "節點種類(根)" }),
      ),
    ).toEqual(["運算"]);
    const operators = await optionsOf(
      user,
      within(skip).getByRole("combobox", { name: "運算" }),
    );
    expect(operators).toEqual(expect.arrayContaining(["等於", "且", "非"]));
    expect(operators).not.toContain("加");
    expect(operators).not.toContain("串接文字");

    // 等於的左邊:欄位、系統值、常數、運算都能選
    expect(
      await optionsOf(
        user,
        within(skip).getByRole("combobox", { name: "節點種類(==.0)" }),
      ),
    ).toEqual(expect.arrayContaining(["欄位", "系統值", "常數"]));
  });
});
