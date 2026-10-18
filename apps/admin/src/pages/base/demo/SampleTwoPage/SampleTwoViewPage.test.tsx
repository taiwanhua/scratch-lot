import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  SAMPLE_TWO_ROUTES,
  renderSampleTwo,
} from "../demo-sample-two-test-support";

const viewPath = (id: string) => `${SAMPLE_TWO_ROUTES.viewPage}/${id}`;

/** 示範模組2 詳情。路由防守在 `SampleTwoRoutes.test.tsx`。 */
describe("示範模組2 詳情(/demo/sample-two/view-page/:id)", () => {
  it("欄位表只有備註 / 啟用 / 建立者 —— 對照組沒有內部備註、封面與附件", async () => {
    renderSampleTwo({ path: viewPath("demo-two-1") });

    expect(
      await screen.findByRole("heading", { name: "對照組項目A" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("沒有分類、沒有狀態的對照資料"),
    ).toBeInTheDocument();
    expect(screen.getByText("王小明")).toBeInTheDocument();

    expect(screen.queryByText("內部備註")).not.toBeInTheDocument();
    expect(screen.queryByText("封面")).not.toBeInTheDocument();
    expect(screen.queryByText("附件")).not.toBeInTheDocument();
  });

  it("建立者查不到那位使用者時顯示「—」(seed 示範資料的建立者是假 id)", async () => {
    renderSampleTwo({ path: viewPath("demo-two-2") });

    await screen.findByRole("heading", { name: "對照組項目B" });
    expect(screen.getByText("建立者").nextSibling).toHaveTextContent("—");
  });

  it("改不動、刪不掉的那一筆只剩「返回列表」", async () => {
    renderSampleTwo({ path: viewPath("demo-two-3") });

    await screen.findByRole("heading", { name: "對照組項目C" });
    expect(
      screen.getByRole("button", { name: "← 返回列表" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "編輯" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "刪除" }),
    ).not.toBeInTheDocument();
  });

  it("刪除:確認後回到列表", async () => {
    const { user: actor, fake } = renderSampleTwo({
      path: viewPath("demo-two-1"),
    });
    await screen.findByRole("heading", { name: "對照組項目A" });

    await actor.click(screen.getByRole("button", { name: "刪除" }));
    const dialog = await screen.findByRole("dialog");
    await actor.click(within(dialog).getByRole("button", { name: "確認刪除" }));

    await waitFor(() => {
      expect(fake.inputs.deleteDemoItemTwo).toEqual([{ id: "demo-two-1" }]);
    });
    expect(await screen.findByTestId("location")).toHaveTextContent(
      SAMPLE_TWO_ROUTES.list,
    );
  });

  it("看不到的資料:api 回 NOT_FOUND,畫面講清楚不是壞掉", async () => {
    renderSampleTwo({ path: viewPath("demo-two-missing") });

    expect(await screen.findByText(/找不到這筆示範項目/)).toBeInTheDocument();
  });
});
