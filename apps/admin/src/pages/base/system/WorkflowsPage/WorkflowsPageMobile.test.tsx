import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { workflowFragment } from "@/test/msw/workflow-fixtures";
import { setupReactFlowEnvironment } from "@/test/react-flow";
import { urlParam } from "@/test/url-reload";
import { restoreViewportAfterEach, setMobileViewport } from "@/test/viewport";

import {
  clickNode,
  defaultDesignOptions,
  findCanvas,
  propertiesPanel,
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

describe("流程管理:手機寬只顯示清單或唯讀摘要", () => {
  restoreViewportAfterEach();

  it("清單滿版 → 點流程只顯示摘要與提示、沒有設計器 → [← 返回] 回到清單", async () => {
    setMobileViewport();
    const { user } = renderWorkflows({ world });
    const list = await screen.findByRole("list", { name: "流程清單" });
    expect(screen.queryByRole("region", { name: "流程摘要" })).toBeNull();

    await user.click(within(list).getByText("出差審核"));
    const summary = await screen.findByRole("region", { name: "流程摘要" });
    expect(
      within(summary).getByRole("heading", { name: "出差審核" }),
    ).toBeInTheDocument();
    expect(
      within(summary).getByText("設計與編輯請使用平板或電腦。"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "流程內容" })).toBeNull();
    expect(workflowList()).toBeNull();
    expect(urlParam("detail")).toBe("trip_review");

    await user.click(screen.getByRole("button", { name: "← 返回" }));
    await waitFor(() => {
      expect(workflowList()).not.toBeNull();
    });
    expect(urlParam("detail")).toBeNull();
  });

  it("sm 以上照舊:兩欄並排、右欄是流程內容", async () => {
    renderWorkflows({ world });
    await screen.findByRole("list", { name: "流程清單" });
    expect(
      await screen.findByRole("region", { name: "流程內容" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "流程摘要" })).toBeNull();
  });
});

describe("流程管理:同一筆不經過未存攔截", () => {
  it("sm 以上:網址沒有選取、設計器有未存變更時再點同一個流程 → 不跳攔截、改動留著,只把選取寫進網址", async () => {
    const { user } = renderWorkflows({ world });
    const canvas = await findCanvas();
    clickNode(canvas, "人資");
    const name = within(propertiesPanel()).getByRole("textbox", {
      name: "名稱",
    });
    await user.clear(name);
    await user.type(name, "人資部");
    expect(urlParam("detail")).toBeNull();

    const list = screen.getByRole("list", { name: "流程清單" });
    await user.click(within(list).getByText("病假審核"));
    await waitFor(() => {
      expect(urlParam("detail")).toBe("leave_review");
    });
    expect(screen.queryByRole("dialog", { name: "還有沒存的變更" })).toBeNull();
    expect(
      within(propertiesPanel()).getByRole("textbox", { name: "名稱" }),
    ).toHaveValue("人資部");
  });
});
