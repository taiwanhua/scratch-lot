import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import { delay } from "msw";

import { api, server } from "@/test/msw/server";
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

describe("流程管理:存完草稿馬上發布", () => {
  it("版本清單的重查還沒回來也帶新的修訂號(不被擋成「已被別人更新」)", async () => {
    const { user, world } = renderWorkflows();
    const canvas = await findCanvas();
    clickNode(canvas, "人資");
    await user.click(
      within(propertiesPanel()).getByRole("button", { name: "在後面加一關" }),
    );
    // 之後的版本清單重查一律不回(模擬 CI 上重查比使用者的下一步慢)
    server.use(
      api.query("WorkflowVersions", async () => {
        await delay("infinite");
      }),
    );
    await user.click(screen.getByRole("button", { name: "存草稿" }));
    expect(await screen.findByText("草稿修訂 2")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "流程版本" }));
    await user.click(await screen.findByRole("button", { name: "發布" }));
    const dialog = await screen.findByRole("dialog", { name: "發布草稿" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "變更說明" }),
      "多一關",
    );
    await user.click(within(dialog).getByRole("button", { name: "發布" }));
    await waitFor(() => {
      expect(world.inputs.publish).toHaveLength(1);
    });
    expect(world.inputs.publish[0]?.expectedDraftRevision).toBe(2);
  });
});
