import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { DemoListPage } from "@/components/base/crud/DemoListPage";

import { sampleTwoModule } from "../SampleTwoModule";
import {
  SAMPLE_TWO_ROUTES,
  SAMPLE_TWO_VIEW_ONLY,
  findSampleTwoRowOf,
  renderSampleTwo,
} from "../demo-sample-two-test-support";

/**
 * 示範模組2 列表(`/demo/sample-two`)。
 *
 * 版型與示範模組1 同一組共用元件,所以這裡**只測對照組自己的差異**:
 * 四欄、沒有分類篩選、沒有狀態欄。三頁共通的行為(分頁、放棄變更…)在示範模組1 的測試裡。
 */
describe("示範模組2 列表(/demo/sample-two)", () => {
  it("列出示範項目;沒有分類與狀態欄,備註沒填顯示「—」", async () => {
    renderSampleTwo();

    const row = await findSampleTwoRowOf("對照組項目A");
    expect(
      within(row).getByText("沒有分類、沒有狀態的對照資料"),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole("switch", {
        name: "切換「對照組項目A」的啟用狀態",
      }),
    ).toBeChecked();

    const plain = await findSampleTwoRowOf("對照組項目B");
    expect(within(plain).getByText("—")).toBeInTheDocument();

    // 對照組沒有這兩欄(示範模組1 才有)
    expect(screen.queryByText("分類")).not.toBeInTheDocument();
    expect(screen.queryByText("狀態")).not.toBeInTheDocument();
  });

  it("工具列只有搜尋與新增 —— 對照組沒有模組自有的篩選器", async () => {
    renderSampleTwo();
    await findSampleTwoRowOf("對照組項目A");

    expect(screen.getByLabelText("搜尋")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "+ 新增示範項目" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("分類")).not.toBeInTheDocument();
  });

  it("搜尋比對名稱與備註,把關鍵字送給 api(不是前端過濾)", async () => {
    const { user: actor, fake } = renderSampleTwo();
    await findSampleTwoRowOf("對照組項目A");

    await actor.type(screen.getByLabelText("搜尋"), "已停用");

    await waitFor(() => {
      expect(screen.queryByText("對照組項目A")).not.toBeInTheDocument();
    });
    expect(await screen.findByText("對照組項目C")).toBeInTheDocument();
    expect(fake.calls.demoItemsTwo).toBeGreaterThan(1);
  });

  it("列操作依 api 給的 abilities:改不動、刪不掉的那一列只剩「檢視」", async () => {
    renderSampleTwo();

    const editable = await findSampleTwoRowOf("對照組項目A");
    expect(
      within(editable).getByRole("button", { name: "編輯「對照組項目A」" }),
    ).toBeInTheDocument();

    const locked = await findSampleTwoRowOf("對照組項目C");
    expect(
      within(locked).getByRole("button", { name: /檢視/ }),
    ).toBeInTheDocument();
    expect(
      within(locked).queryByRole("button", { name: /編輯/ }),
    ).not.toBeInTheDocument();
    expect(
      within(locked).queryByRole("button", { name: /刪除/ }),
    ).not.toBeInTheDocument();
  });

  it("刪除:先跳確認彈窗,確認後那一列從清單消失", async () => {
    const { user: actor, fake } = renderSampleTwo();
    const row = await findSampleTwoRowOf("對照組項目A");

    await actor.click(
      within(row).getByRole("button", { name: "刪除「對照組項目A」" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/此操作無法復原/)).toBeInTheDocument();

    await actor.click(within(dialog).getByRole("button", { name: "確認刪除" }));

    await waitFor(() => {
      expect(fake.inputs.deleteDemoItemTwo).toEqual([{ id: "demo-two-1" }]);
    });
    await waitFor(() => {
      expect(screen.queryByText("對照組項目A")).not.toBeInTheDocument();
    });
  });

  it("啟用欄:改得動的那一列是開關,切換後送出並更新列表", async () => {
    const { user: actor, fake } = renderSampleTwo();
    const row = await findSampleTwoRowOf("對照組項目A");

    await actor.click(
      within(row).getByRole("switch", {
        name: "切換「對照組項目A」的啟用狀態",
      }),
    );

    await waitFor(() => {
      expect(fake.inputs.setDemoItemTwoEnabled).toEqual([
        { id: "demo-two-1", enabled: false },
      ]);
    });
    // 成功後只失效當前清單(DATA-02 / 04)→ 重查後那一列是停用的
    await waitFor(() => {
      expect(
        within(screen.getByRole("row", { name: /對照組項目A/ })).getByRole(
          "switch",
        ),
      ).not.toBeChecked();
    });
  });

  it("改不動的那一列沒有開關,啟用狀態退回唯讀標籤", async () => {
    renderSampleTwo();

    const locked = await findSampleTwoRowOf("對照組項目C");
    expect(within(locked).getByText("停用")).toBeInTheDocument();
    expect(within(locked).queryByRole("switch")).not.toBeInTheDocument();
  });

  it("設定沒給 `useSetEnabled` 時,啟用欄維持唯讀標籤(共版型裡它是選配)", async () => {
    // 未來的模組不一定有啟用 / 停用:不給那支 hook 的設定仍然是合法的 `DemoModuleConfig`
    // (型別上 `useSetEnabled?` 是選配),列表就退回原本的標籤。
    // 探針掛在路由旁,所以換一份設定不必另外登記路由(`renderApp` 的 `extra`)。
    renderSampleTwo({
      path: "/",
      extra: (
        <DemoListPage
          config={{ ...sampleTwoModule, useSetEnabled: undefined }}
        />
      ),
    });

    const row = await findSampleTwoRowOf("對照組項目A");
    expect(within(row).getByText("啟用")).toBeInTheDocument();
    expect(within(row).queryByRole("switch")).not.toBeInTheDocument();
  });

  it("只有 view 權限:沒有新增鈕", async () => {
    renderSampleTwo({ permissions: SAMPLE_TWO_VIEW_ONLY });
    await findSampleTwoRowOf("對照組項目A");

    expect(
      screen.queryByRole("button", { name: "+ 新增示範項目" }),
    ).not.toBeInTheDocument();
  });

  it("點「檢視」導向詳情頁的網址(模組路由 + 那一筆的 id)", async () => {
    const { user: actor } = renderSampleTwo();
    const row = await findSampleTwoRowOf("對照組項目A");

    await actor.click(within(row).getByRole("button", { name: /檢視/ }));

    expect(await screen.findByTestId("location")).toHaveTextContent(
      `${SAMPLE_TWO_ROUTES.viewPage}/demo-two-1`,
    );
  });
});
