import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { workflowFragment } from "@/test/msw/workflow-fixtures";
import { setupReactFlowEnvironment } from "@/test/react-flow";
import { urlParam } from "@/test/url-reload";
import { restoreViewportAfterEach, setMobileViewport } from "@/test/viewport";

import {
  defaultDesignOptions,
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
