import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  WORKFLOWS_ROUTE,
  workflowFragment,
} from "@/test/msw/workflow-fixtures";
import { setupReactFlowEnvironment } from "@/test/react-flow";
import { urlJson, urlParam } from "@/test/url-reload";

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

describe("流程管理:清單搜尋與選中的流程存在網址(REACT-14)", () => {
  it("搜尋(`?list=`)與選中的流程(`?detail=`)重新整理後都還在", async () => {
    const first = renderWorkflows({ world });
    const list = await screen.findByRole("list", { name: "流程清單" });
    await first.user.click(within(list).getByText("出差審核"));
    await first.user.type(screen.getByLabelText("搜尋"), "出差");
    await waitFor(() => {
      expect(urlJson("list")).toEqual({ keyword: "出差" });
    });
    expect(urlParam("detail")).toBe("trip_review");
    const search = globalThis.location.search;
    first.unmount();

    renderWorkflows({ world, path: `${WORKFLOWS_ROUTE}${search}` });

    expect(
      await screen.findByRole("heading", { name: "出差審核" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("搜尋")).toHaveValue("出差");
  });

  it("帶 `?edit=<流程 key>` 進入 → 選中那個流程並打開改名稱彈窗", async () => {
    renderWorkflows({ world, path: `${WORKFLOWS_ROUTE}?edit=trip_review` });

    expect(
      await screen.findByRole("dialog", { name: "改名稱" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "出差審核", hidden: true }),
    ).toBeInTheDocument();
  });
});
