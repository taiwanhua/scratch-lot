import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  SAMPLE_ONE_ROUTES,
  VIEW_ONLY,
  findRowOf,
  renderSampleOne,
} from "../demo-sample-one-test-support";

/**
 * 示範模組1 列表(Figma 175:3)。
 * 詳情與共版型各有自己的測試檔;路由防守在 `SampleOneRoutes.test.tsx`。
 */
describe("示範模組1 列表(/demo/sub/sample-one)", () => {
  it("列出示範項目,狀態有標籤、啟用是開關,沒填的欄位顯示「—」", async () => {
    renderSampleOne();

    const row = await findRowOf("醬燒雞腿排");
    expect(within(row).getByText("主食")).toBeInTheDocument();
    expect(within(row).getByText("已發布")).toBeInTheDocument();
    expect(
      within(row).getByRole("switch", { name: "切換「醬燒雞腿排」的啟用狀態" }),
    ).toBeChecked();

    // 備註沒填的那一筆顯示「—」,不是空白格
    const plain = await findRowOf("涼拌小黃瓜");
    expect(within(plain).getByText("—")).toBeInTheDocument();

    // 停用 + 已封存 + 改不動的那一筆:啟用欄退回唯讀標籤
    const archived = await findRowOf("古早味紅茶");
    expect(within(archived).getByText("已封存")).toBeInTheDocument();
    expect(within(archived).getByText("停用")).toBeInTheDocument();
    expect(within(archived).queryByRole("switch")).not.toBeInTheDocument();
  });

  it("啟用欄:改得動的那一列是開關,切換後送出並更新列表", async () => {
    const { user: actor, fake } = renderSampleOne();
    const row = await findRowOf("醬燒雞腿排");

    await actor.click(
      within(row).getByRole("switch", { name: "切換「醬燒雞腿排」的啟用狀態" }),
    );

    await waitFor(() => {
      expect(fake.inputs.setDemoItemOneEnabled).toEqual([
        { id: "demo-1", enabled: false },
      ]);
    });
    // 成功後只失效當前清單(DATA-02 / 04)→ 重查後那一列是停用的
    await waitFor(() => {
      expect(
        within(screen.getByRole("row", { name: /醬燒雞腿排/ })).getByRole(
          "switch",
        ),
      ).not.toBeChecked();
    });
  });

  it("切換失敗時列表上出現說明,狀態不變", async () => {
    const { user: actor } = renderSampleOne({
      world: { failures: { SetDemoItemOneEnabled: { code: "FORBIDDEN" } } },
    });
    const row = await findRowOf("醬燒雞腿排");

    await actor.click(
      within(row).getByRole("switch", { name: "切換「醬燒雞腿排」的啟用狀態" }),
    );

    expect(
      await screen.findByText("你沒有執行這個動作的權限。"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: /醬燒雞腿排/ })).getByRole(
        "switch",
      ),
    ).toBeChecked();
  });

  it("搜尋比對名稱與備註,把關鍵字送給 api(不是前端過濾)", async () => {
    const { user: actor, fake } = renderSampleOne();
    await findRowOf("醬燒雞腿排");

    await actor.type(screen.getByLabelText("搜尋"), "紅茶");

    await waitFor(() => {
      expect(screen.queryByText("醬燒雞腿排")).not.toBeInTheDocument();
    });
    expect(await screen.findByText("古早味紅茶")).toBeInTheDocument();
    expect(fake.calls.demoItemsOne).toBeGreaterThan(1);
  });

  it("分類篩選的選項來自欄位管理的「示範分類」,選了就送 category 給 api", async () => {
    const { user: actor, fake } = renderSampleOne();
    await findRowOf("醬燒雞腿排");

    await actor.click(screen.getByLabelText("分類"));
    // 停用的選項不列出來(停用只影響新填寫;既有資料照樣顯示它原本的分類名)
    expect(
      screen.queryByRole("option", { name: /飲品/ }),
    ).not.toBeInTheDocument();
    await actor.click(await screen.findByRole("option", { name: /小菜/ }));

    await waitFor(() => {
      expect(screen.queryByText("醬燒雞腿排")).not.toBeInTheDocument();
    });
    expect(await screen.findByText("涼拌小黃瓜")).toBeInTheDocument();
    expect(fake.calls.demoItemsOne).toBeGreaterThan(1);
  });

  it("列操作依 api 給的 abilities:改不動、刪不掉的那一列只剩「檢視」", async () => {
    renderSampleOne();

    const editable = await findRowOf("醬燒雞腿排");
    expect(
      within(editable).getByRole("button", { name: "編輯「醬燒雞腿排」" }),
    ).toBeInTheDocument();
    expect(
      within(editable).getByRole("button", { name: "刪除「醬燒雞腿排」" }),
    ).toBeInTheDocument();

    const locked = await findRowOf("古早味紅茶");
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
    const { user: actor, fake } = renderSampleOne();
    const row = await findRowOf("醬燒雞腿排");

    await actor.click(
      within(row).getByRole("button", { name: "刪除「醬燒雞腿排」" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/此操作無法復原/)).toBeInTheDocument();

    await actor.click(within(dialog).getByRole("button", { name: "確認刪除" }));

    await waitFor(() => {
      expect(fake.inputs.deleteDemoItemOne).toEqual([{ id: "demo-1" }]);
    });
    await waitFor(() => {
      expect(screen.queryByText("醬燒雞腿排")).not.toBeInTheDocument();
    });
  });

  it("刪除確認可以取消,不送出任何請求", async () => {
    const { user: actor, fake } = renderSampleOne();
    const row = await findRowOf("醬燒雞腿排");

    await actor.click(
      within(row).getByRole("button", { name: "刪除「醬燒雞腿排」" }),
    );
    const dialog = await screen.findByRole("dialog");
    await actor.click(within(dialog).getByRole("button", { name: "取消" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(fake.inputs.deleteDemoItemOne).toHaveLength(0);
    expect(await screen.findByText("醬燒雞腿排")).toBeInTheDocument();
  });

  it("只有 view 權限:沒有新增鈕(`create` 權限與新增頁兩者缺一不可)", async () => {
    renderSampleOne({ permissions: VIEW_ONLY });
    await findRowOf("醬燒雞腿排");

    expect(
      screen.queryByRole("button", { name: "+ 新增示範項目" }),
    ).not.toBeInTheDocument();
  });

  it("有 create 權限但沒綁新增頁:一樣沒有新增鈕(進不去的頁不給入口)", async () => {
    renderSampleOne({ pages: ["list", "viewPage", "editPage"] });
    await findRowOf("醬燒雞腿排");

    expect(
      screen.queryByRole("button", { name: "+ 新增示範項目" }),
    ).not.toBeInTheDocument();
  });

  it("沒綁詳情頁 / 編輯頁時,列上就沒有「檢視」/「編輯」", async () => {
    renderSampleOne({ pages: ["list"] });
    const row = await findRowOf("醬燒雞腿排");

    expect(
      within(row).queryByRole("button", { name: /檢視/ }),
    ).not.toBeInTheDocument();
    expect(
      within(row).queryByRole("button", { name: /編輯/ }),
    ).not.toBeInTheDocument();
    // 刪除不需要另一頁,照 abilities 出現
    expect(
      within(row).getByRole("button", { name: "刪除「醬燒雞腿排」" }),
    ).toBeInTheDocument();
  });

  it("點「檢視」導向詳情頁的網址(模組路由 + 那一筆的 id)", async () => {
    const { user: actor } = renderSampleOne();
    const row = await findRowOf("醬燒雞腿排");

    await actor.click(within(row).getByRole("button", { name: /檢視/ }));

    expect(await screen.findByTestId("location")).toHaveTextContent(
      `${SAMPLE_ONE_ROUTES.viewPage}/demo-1`,
    );
  });

  it("沒有欄位管理檢視權限時不顯示分類篩選(給一個永遠空的篩選器只會誤導)", async () => {
    renderSampleOne({
      permissions: ["demo.sub.sample-one.view"],
    });
    await findRowOf("醬燒雞腿排");

    expect(screen.queryByLabelText("分類")).not.toBeInTheDocument();
  });
});
