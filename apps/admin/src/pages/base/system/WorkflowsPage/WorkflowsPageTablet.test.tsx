import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { workflowFragment } from "@/test/msw/workflow-fixtures";
import { setupReactFlowEnvironment } from "@/test/react-flow";
import {
  resizeViewport,
  restoreResizableViewportAfterEach,
  setResizableViewport,
} from "@/test/viewport-resize";

import {
  clickNode,
  defaultDesignOptions,
  findCanvas,
  renderWorkflows,
} from "./workflows-page-test-support";

setupReactFlowEnvironment();

beforeAll(async () => {
  await import("./WorkflowsPage");
});

const world = {
  ...defaultDesignOptions(),
  workflows: [
    workflowFragment(),
    workflowFragment({
      id: "wf-trip_review",
      key: "trip_review",
      name: "出差審核",
    }),
  ],
};

const workflowList = () => screen.queryByRole("list", { name: "流程清單" });
const properties = () => screen.queryByRole("region", { name: "屬性" });
const expandButton = () =>
  screen.queryByRole("button", { name: "展開流程清單" });
/** 流程圖上的節點有沒有被選中(React Flow 在節點外框加 `selected`) */
const isNodeSelected = (canvas: HTMLElement, name: string): boolean =>
  within(canvas)
    .getByRole("group", { name })
    .closest(".react-flow__node")
    ?.classList.contains("selected") ?? false;

describe("流程管理:平板寬(sm–lg)畫布優先", () => {
  restoreResizableViewportAfterEach();

  it("768:清單一進來收起 → [展開] 打開、焦點在 [收起] → 選一個再收起", async () => {
    setResizableViewport(768);
    const { user } = renderWorkflows({ world });
    await findCanvas();
    expect(workflowList()).toBeNull();

    await user.click(screen.getByRole("button", { name: "展開流程清單" }));
    const list = await screen.findByRole("list", { name: "流程清單" });
    expect(screen.getByRole("button", { name: "收起流程清單" })).toHaveFocus();

    await user.click(within(list).getByText("出差審核"));
    await waitFor(() => {
      expect(workflowList()).toBeNull();
    });
    expect(expandButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("1024:點關卡打開屬性抽屜、流程圖上仍選著它;改名稱流程圖跟著變;Esc 關閉、取消選取", async () => {
    setResizableViewport(1024);
    const { user } = renderWorkflows({ world });
    const canvas = await findCanvas();
    expect(properties()).toBeNull();

    clickNode(canvas, "人資");
    const panel = await screen.findByRole("region", { name: "屬性" });
    expect(isNodeSelected(canvas, "人資")).toBe(true);

    const name = within(panel).getByRole("textbox", { name: "名稱" });
    await user.type(name, "審核");
    expect(
      await within(canvas).findByRole("group", { name: "人資審核" }),
    ).toBeInTheDocument();
    expect(isNodeSelected(canvas, "人資審核")).toBe(true);

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(properties()).toBeNull();
    });
    expect(isNodeSelected(canvas, "人資審核")).toBe(false);
    expect(screen.getByText("有未存的變更")).toBeInTheDocument();
  });

  it("平板寬:[整個流程設定] 在抽屜裡打開整個流程的設定;[回到整個流程設定] 留在抽屜裡", async () => {
    setResizableViewport(768);
    const { user } = renderWorkflows({ world });
    const canvas = await findCanvas();

    await user.click(screen.getByRole("button", { name: "整個流程設定" }));
    const panel = await screen.findByRole("region", { name: "屬性" });
    expect(
      within(panel).getByRole("region", { name: "整個流程的設定" }),
    ).toBeInTheDocument();

    clickNode(canvas, "直屬主管");
    await user.click(
      within(panel).getByRole("button", { name: "回到整個流程設定" }),
    );
    expect(
      within(panel).getByRole("region", { name: "整個流程的設定" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "關閉屬性" }));
    await waitFor(() => {
      expect(properties()).toBeNull();
    });
  });

  it("≥ lg(1440)不變:清單常駐、沒有收起 / 展開鈕、屬性面板常駐、沒有 [整個流程設定] 鈕", async () => {
    setResizableViewport(1440);
    renderWorkflows({ world });
    await findCanvas();
    expect(workflowList()).not.toBeNull();
    expect(expandButton()).toBeNull();
    expect(screen.queryByRole("button", { name: "收起流程清單" })).toBeNull();
    expect(
      within(screen.getByRole("region", { name: "屬性" })).getByRole("region", {
        name: "整個流程的設定",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "整個流程設定" })).toBeNull();
  });

  it("有未存變更時縮到手機寬再拉回來:草稿與「有未存的變更」都在;手機寬的摘要提示有未存變更", async () => {
    setResizableViewport(1024);
    const { user } = renderWorkflows({ world });
    const canvas = await findCanvas();
    clickNode(canvas, "人資");
    await user.type(
      within(await screen.findByRole("region", { name: "屬性" })).getByRole(
        "textbox",
        { name: "名稱" },
      ),
      "審核",
    );
    expect(screen.getByText("有未存的變更")).toBeInTheDocument();

    resizeViewport(390);
    expect(screen.queryByRole("region", { name: "流程圖" })).toBeNull();
    const list = await screen.findByRole("list", { name: "流程清單" });
    await user.click(within(list).getByText("病假審核"));
    await screen.findByRole("region", { name: "流程摘要" });
    expect(
      screen.getByText(
        "這個流程有未儲存的變更,仍保留在設計器裡。請改用平板或電腦寬度儲存或放棄。",
      ),
    ).toBeInTheDocument();

    resizeViewport(1024);
    const back = await findCanvas();
    expect(
      within(back).getByRole("group", { name: "人資審核" }),
    ).toBeInTheDocument();
    expect(screen.getByText("有未存的變更")).toBeInTheDocument();
  });
});
