import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import {
  purchaseWorkflowDefinition,
  workflowFragment,
  workflowVersionFragment,
} from "@/test/msw/workflow-fixtures";
import { setupReactFlowEnvironment } from "@/test/react-flow";

import {
  clickNode,
  findCanvas,
  propertiesPanel,
  renderWorkflows,
} from "./workflows-page-test-support";

setupReactFlowEnvironment();

beforeAll(async () => {
  await import("./WorkflowsPage");
});

const purchaseWorld = () => ({
  workflows: [workflowFragment({ key: "purchase_review", name: "採購審核" })],
  versions: {
    purchase_review: [
      workflowVersionFragment(purchaseWorkflowDefinition(), {
        workflowKey: "purchase_review",
      }),
    ],
  },
});

const findPurchaseCanvas = async () => {
  const canvas = await screen.findByRole("region", { name: "流程圖" });
  await within(canvas).findByRole("group", { name: "原部門初審" });
  return canvas;
};

describe("流程設計器:分流 / 匯合的建立與限制", () => {
  it("從此關分流 3 條 → 三個分支關卡 + 一個匯合節點;存草稿的定義帶連線", async () => {
    const { user, world } = renderWorkflows();
    const canvas = await findCanvas();

    clickNode(canvas, "直屬主管");
    await user.click(
      within(propertiesPanel()).getByRole("button", { name: "從此關分流" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "從「直屬主管」分流",
    });
    await user.click(within(dialog).getByRole("combobox", { name: "分支數" }));
    await user.click(await screen.findByRole("option", { name: "3 條" }));
    await user.click(within(dialog).getByRole("button", { name: "分流" }));

    expect(
      await within(canvas).findByRole("group", { name: "匯合:匯合" }),
    ).toBeInTheDocument();
    expect(
      within(canvas).getByRole("group", { name: "關卡 3" }),
    ).toBeInTheDocument();
    expect(
      within(canvas).getByRole("group", { name: "關卡 5" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "存草稿" }));
    await screen.findByText("已存草稿");
    const [saved] = world.inputs.saveDraft;
    const edges = saved.definition.edges ?? [];
    expect(edges).toContainEqual({ from: "manager", to: "step_3" });
    expect(edges.filter((edge) => edge.to === "join_6")).toHaveLength(3);
    expect(edges).toContainEqual({ from: "join_6", to: "hr" });
  });

  it("分支裡的關卡不能再分流;在分流來源、分支、匯合上各有對應的操作", async () => {
    const { user } = renderWorkflows({ world: purchaseWorld() });
    const canvas = await findPurchaseCanvas();

    clickNode(canvas, "財務部審核");
    const panel = propertiesPanel();
    expect(
      within(panel).queryByRole("button", { name: "從此關分流" }),
    ).not.toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "加一條分支" }),
    ).toBeInTheDocument();

    clickNode(canvas, "原部門初審");
    expect(
      within(propertiesPanel()).queryByRole("button", { name: "從此關分流" }),
    ).not.toBeInTheDocument();

    clickNode(canvas, "匯合:三部門匯合");
    const joinPanel = propertiesPanel();
    expect(within(joinPanel).getByText(/3 條分支都通過/)).toBeInTheDocument();
    expect(
      within(joinPanel).queryByRole("combobox", { name: "審核者來源" }),
    ).not.toBeInTheDocument();
    await user.click(
      within(joinPanel).getByRole("button", { name: "加一條分支" }),
    );
    expect(
      await within(canvas).findByRole("group", { name: "關卡 7" }),
    ).toBeInTheDocument();
  });

  it("刪分支唯一的關卡 = 刪那條分支;刪到只剩一條時收成直線、匯合一起刪", async () => {
    const { user } = renderWorkflows({ world: purchaseWorld() });
    const canvas = await findPurchaseCanvas();

    clickNode(canvas, "採購部審核");
    await user.click(
      within(propertiesPanel()).getByRole("button", { name: "刪除此關" }),
    );
    expect(
      within(canvas).queryByRole("group", { name: "採購部審核" }),
    ).not.toBeInTheDocument();
    expect(
      within(canvas).getByRole("group", { name: "匯合:三部門匯合" }),
    ).toBeInTheDocument();

    clickNode(canvas, "法務部審核");
    await user.click(
      within(propertiesPanel()).getByRole("button", { name: "刪除此關" }),
    );
    expect(
      within(canvas).queryByRole("group", { name: "匯合:三部門匯合" }),
    ).not.toBeInTheDocument();
    expect(
      within(canvas).getByRole("group", { name: "財務部審核" }),
    ).toBeInTheDocument();
  });

  it("刪整組分流(連同匯合);刪分流來源會讓分流懸空 → 拒絕並說明", async () => {
    const { user } = renderWorkflows({ world: purchaseWorld() });
    const canvas = await findPurchaseCanvas();

    clickNode(canvas, "原部門初審");
    await user.click(
      within(propertiesPanel()).getByRole("button", { name: "刪除此關" }),
    );
    expect(
      await screen.findByText(/分流前面一定要有一個審核關卡/),
    ).toBeInTheDocument();
    expect(
      within(canvas).getByRole("group", { name: "原部門初審" }),
    ).toBeInTheDocument();

    clickNode(canvas, "匯合:三部門匯合");
    await user.click(
      within(propertiesPanel()).getByRole("button", { name: "刪除整組分流" }),
    );
    expect(
      within(canvas).queryByRole("group", { name: "財務部審核" }),
    ).not.toBeInTheDocument();
    expect(
      within(canvas).getByRole("group", { name: "原部門確認" }),
    ).toBeInTheDocument();
  });

  it("移到別條分支(拖拉的按鈕版);移走後會留下空分支的選項不列", async () => {
    const { user, world } = renderWorkflows({ world: purchaseWorld() });
    const canvas = await findPurchaseCanvas();

    clickNode(canvas, "財務部審核");
    await user.click(
      within(propertiesPanel()).getByRole("button", { name: "加一條分支" }),
    );
    clickNode(canvas, "原部門確認");
    await user.click(
      within(propertiesPanel()).getByRole("combobox", { name: "移到分支" }),
    );
    await user.click(
      await screen.findByRole("option", {
        name: "移到「三部門匯合」第 1 條分支",
      }),
    );

    await user.click(screen.getByRole("button", { name: "存草稿" }));
    await screen.findByText("已存草稿");
    const edges = world.inputs.saveDraft[0].definition.edges ?? [];
    expect(edges).toContainEqual({ from: "finance", to: "confirm" });
    expect(edges).toContainEqual({ from: "confirm", to: "merge" });
  });

  it("選了匯合節點時也能按「回到整個流程設定」回到整個流程面板", async () => {
    const { user } = renderWorkflows({ world: purchaseWorld() });
    const canvas = await findPurchaseCanvas();
    clickNode(canvas, "匯合:三部門匯合");

    await user.click(
      within(propertiesPanel()).getByRole("button", {
        name: "回到整個流程設定",
      }),
    );

    expect(
      within(propertiesPanel()).getByRole("region", { name: "整個流程的設定" }),
    ).toBeInTheDocument();
    expect(propertiesPanel()).toHaveFocus();
  });
});
