import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { MASTER_DATA_PERMISSIONS as P } from "@repo/domain/project/lottery-master-data";

import { renderMasterData } from "../master-data-test-support";

/**
 * 檔案管理列表頁(規格 5.1 / 5.5 的「沒有權限時」;Figma MD-01、MD-05):
 * 分頁看模組有沒有綁、按鈕看權限、逐列的 [編輯] 看 api 的 abilities。
 */
describe("檔案管理:分頁與按鈕", () => {
  it("兩個分頁都綁:顯示 遊戲 | 收銀點;遊戲預設只列販售中", async () => {
    renderMasterData();
    expect(
      await screen.findByRole("tab", { name: "遊戲" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "收銀點" })).toBeInTheDocument();
    expect(await screen.findByText("金好運")).toBeInTheDocument();
    expect(screen.queryByText("舊彩")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "+ 新增遊戲" }),
    ).toBeInTheDocument();
  });

  it("沒有 games.create → 看不到 [+ 新增遊戲]", async () => {
    renderMasterData({ permissions: [P.cashPointsCreate, P.cashPointsEdit] });
    expect(await screen.findByText("金好運")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "+ 新增遊戲" }),
    ).not.toBeInTheDocument();
  });

  it("收銀點分頁:有 create / edit → [+ 新增收銀點] 與每列 [編輯]", async () => {
    const { user } = renderMasterData();
    await user.click(await screen.findByRole("tab", { name: "收銀點" }));
    expect(await screen.findAllByText("店外攤位")).not.toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "+ 新增收銀點" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "編輯" })).toHaveLength(3);
  });

  it("沒有 cash-points.create / edit → 看不到 [+ 新增收銀點] 與 [編輯]", async () => {
    const { user } = renderMasterData({
      permissions: [P.gamesCreate, P.gamesEdit, P.gamesDelete],
    });
    await user.click(await screen.findByRole("tab", { name: "收銀點" }));
    expect(await screen.findAllByText("店外攤位")).not.toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "+ 新增收銀點" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "編輯" }),
    ).not.toBeInTheDocument();
  });

  it("只綁收銀點:沒有分頁籤,直接是收銀點列表", async () => {
    renderMasterData({ games: false });
    expect(await screen.findAllByText("店外攤位")).not.toHaveLength(0);
    // 路由頁籤列也是 tab;頁內分頁籤「遊戲」「收銀點」都不出現
    expect(
      screen.queryByRole("tab", { name: "收銀點" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "遊戲" })).not.toBeInTheDocument();
  });

  it("新增收銀點:選崗位自動帶入名稱;同分店崗位重複 → 顯示原因並標在欄位", async () => {
    const { user, fake } = renderMasterData();
    await user.click(await screen.findByRole("tab", { name: "收銀點" }));
    await user.click(
      await screen.findByRole("button", { name: "+ 新增收銀點" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "新增收銀點" });
    await user.click(
      within(dialog).getByRole("combobox", { name: /對應崗位/ }),
    );
    await user.click(await screen.findByRole("option", { name: "店外攤位" }));
    expect(within(dialog).getByRole("textbox", { name: /名稱/ })).toHaveValue(
      "店外攤位",
    );
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(
      await within(dialog).findByText("這家分店已有這個崗位的收銀點"),
    ).toBeInTheDocument();
    expect(fake.inputs.createCashPoint).toEqual([
      {
        orgId: "org-store-a",
        positionKey: "outdoor-stall",
        name: "店外攤位",
        order: 0,
        printerId: null,
        note: null,
      },
    ]);
  });

  it("新增收銀點成功:彈窗關閉、列表多一筆", async () => {
    const { user } = renderMasterData();
    await user.click(await screen.findByRole("tab", { name: "收銀點" }));
    await user.click(
      await screen.findByRole("button", { name: "+ 新增收銀點" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "新增收銀點" });
    await user.click(
      within(dialog).getByRole("combobox", { name: /對應崗位/ }),
    );
    await user.click(await screen.findByRole("option", { name: "補貨" }));
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(await screen.findAllByText("補貨")).toHaveLength(2);
  });
});
