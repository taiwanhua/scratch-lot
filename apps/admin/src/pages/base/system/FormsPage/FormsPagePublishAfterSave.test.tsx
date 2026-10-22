import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import { delay } from "msw";

import { api, server } from "@/test/msw/server";

import {
  findDesigner,
  preloadFormsPage,
  renderFormsPage,
  smallDesignOptions,
} from "./forms-page-test-support";

preloadFormsPage();

describe("表單管理:存完草稿馬上發布", () => {
  it("版本清單的重查還沒回來也帶新的修訂號(不被擋成「已被別人更新」)", async () => {
    const { user, world } = renderFormsPage(smallDesignOptions());
    const palette = await findDesigner();
    await user.click(
      within(palette).getByRole("button", { name: "新增數字欄位" }),
    );
    // 之後的版本清單重查一律不回(模擬 CI 上重查比使用者的下一步慢)
    server.use(
      api.query("FormVersions", async () => {
        await delay("infinite");
      }),
    );
    await user.click(screen.getByRole("button", { name: "存草稿" }));
    expect(await screen.findByText("草稿修訂 2")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "表單版本" }));
    const table = await screen.findByRole("table", { name: "版本清單" });
    await user.click(within(table).getByRole("button", { name: "發布" }));
    const dialog = await screen.findByRole("dialog", { name: "發布新版本" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "變更說明" }),
      "第二版",
    );
    await user.click(within(dialog).getByRole("button", { name: "發布" }));
    await waitFor(() => {
      expect(world.inputs.publishFormVersion).toHaveLength(1);
    });
    expect(world.inputs.publishFormVersion[0]?.expectedDraftRevision).toBe(2);
  });
});
