import { beforeAll, describe, expect, it } from "@jest/globals";
import { fireEvent, screen, within } from "@testing-library/react";

import { setupReactFlowEnvironment } from "@/test/react-flow";

import {
  clickNode,
  defaultDesignOptions,
  findCanvas,
  propertiesPanel,
  renderWorkflows,
} from "./workflows-page-test-support";

setupReactFlowEnvironment();

beforeAll(async () => {
  // 懶載入頁面的依賴鏈(React Flow、dagre、檢查器)先載好,不算進 findBy* 的等待(TEST-08)
  await import("./WorkflowsPage");
});

const issue = (code: string, message: string) => ({
  code,
  message,
  stepKey: "hr",
  stepIndex: 1,
  edgeIndex: null,
  property: null,
  exprPath: null,
});

describe("流程管理:「檢查」的結果面板", () => {
  it("同一關的錯誤與警告混列(錯誤在前),各自標示", async () => {
    const { user } = renderWorkflows({
      world: {
        ...defaultDesignOptions(),
        validation: {
          errors: [issue("ROLE_NOT_IN_TENANT", "關卡 hr 的角色不是本租戶的")],
          warnings: [issue("USER_INVALID", "關卡 hr 指定的使用者 u9 已停用")],
        },
      },
    });
    await findCanvas();

    await user.click(screen.getByRole("button", { name: "檢查" }));

    const result = await screen.findByRole("region", { name: "完整檢查" });
    const list = await within(result).findByRole("list", {
      name: "「人資」的問題",
    });
    const rows = within(list)
      .getAllByRole("button")
      .map((row) => row.textContent);
    // api 才看得到的錯誤 / 警告併在同一關;錯誤在前、警告在後
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("錯誤 · ROLE_NOT_IN_TENANT");
    expect(rows.at(-1)).toContain(
      "關卡 hr 指定的使用者 u9 已停用警告 · USER_INVALID",
    );
  });

  it("檢查之後又改了流程 → 提示重新檢查", async () => {
    const { user } = renderWorkflows();
    const canvas = await findCanvas();
    await user.click(screen.getByRole("button", { name: "檢查" }));
    const result = await screen.findByRole("region", { name: "完整檢查" });
    expect(
      within(result).queryByText("流程或檢查用表單在檢查後有修改,請重新檢查。"),
    ).toBeNull();

    clickNode(canvas, "人資");
    fireEvent.change(
      within(propertiesPanel()).getByRole("textbox", { name: "名稱" }),
      { target: { value: "人資部" } },
    );

    expect(
      within(result).getByText("流程或檢查用表單在檢查後有修改,請重新檢查。"),
    ).toBeInTheDocument();
  });

  it("完整檢查失敗(api 錯誤)→ 降級只列即時檢查的結果並說明", async () => {
    const { user } = renderWorkflows({
      world: {
        ...defaultDesignOptions(),
        failures: {
          ValidateWorkflowVersion: { code: "INTERNAL_SERVER_ERROR" },
        },
      },
    });
    await findCanvas();

    await user.click(screen.getByRole("button", { name: "檢查" }));

    const result = await screen.findByRole("region", { name: "完整檢查" });
    expect(
      await within(result).findByText(
        "完整檢查沒有跑完(操作失敗,請稍後再試。),下面只列即時檢查的結果。",
      ),
    ).toBeInTheDocument();
  });
});
