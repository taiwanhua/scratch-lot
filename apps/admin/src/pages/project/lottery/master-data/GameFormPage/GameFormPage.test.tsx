import { describe, expect, it } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";

import { MASTER_DATA_PERMISSIONS as P } from "@repo/domain/project/lottery-master-data";

import { expectButtonOrder } from "@/test/button-order";

import { renderMasterData } from "../master-data-test-support";

const field = (name: RegExp) => screen.getByRole("textbox", { name });
/** 單張金額是可輸入的下拉(datalist),角色是 combobox。 */
const price = () => screen.getByRole("combobox", { name: /單張金額/ });

/**
 * 遊戲新增 / 編輯 / 詳情頁(規格 5.1;Figma MD-02 97:456、MD-03 97:822):
 * 預設面額帶入張數、非標準組合只提示、有庫存鎖定、按鈕依權限 / abilities。
 */
describe("遊戲頁", () => {
  it("新增:選預設面額自動帶入張數,改成非標準只提示;送出後到詳情頁", async () => {
    const { user, fake } = renderMasterData({
      path: "/master-data/game-create-page",
    });
    await user.type(
      await screen.findByRole("textbox", { name: /遊戲代號/ }),
      "5300",
    );
    await user.type(field(/遊戲名稱/), "大吉利");
    await user.type(price(), "500");
    expect(field(/整本張數/)).toHaveValue("50");
    await user.clear(field(/整本張數/));
    await user.type(field(/整本張數/), "40");
    expect(
      screen.getByText("非標準組合:面額 500 的標準張數是 50 張"),
    ).toBeInTheDocument();
    expect(field(/整本金額/)).toHaveValue("20,000");
    await user.type(field(/預設批購金額率/), "92");
    await user.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.createGame).toHaveLength(1);
    });
    expect(fake.inputs.createGame[0]).toMatchObject({
      gameCode: "5300",
      name: "大吉利",
      unitPrice: 500,
      ticketsPerBook: 40,
      defaultRate: 92,
      status: "on_sale",
      color: null,
    });
    expect(
      await screen.findByText(
        "500 元 × 40 張 · 整本 20,000 · 預設批購金額率 92%",
      ),
    ).toBeInTheDocument();
  });

  it("代號重複:顯示原因、標在代號欄", async () => {
    const { user } = renderMasterData({
      path: "/master-data/game-create-page",
    });
    await user.type(
      await screen.findByRole("textbox", { name: /遊戲代號/ }),
      "5201",
    );
    await user.type(field(/遊戲名稱/), "重複");
    await user.type(price(), "100");
    await user.type(field(/預設批購金額率/), "90");
    await user.click(screen.getByRole("button", { name: "儲存" }));
    expect(await screen.findByText("遊戲代號已被使用")).toBeInTheDocument();
    expect(field(/遊戲代號/)).toHaveAttribute("aria-invalid", "true");
  });

  it("有庫存的遊戲:提示鎖定、代號 / 單張金額 / 整本張數唯讀、沒有 [刪除]", async () => {
    renderMasterData({ path: "/master-data/game-edit-page/g-5164" });
    expect(
      await screen.findByText("已有庫存:代號、單張金額、整本張數已鎖定。"),
    ).toBeInTheDocument();
    expect(field(/遊戲代號/)).toBeDisabled();
    expect(price()).toBeDisabled();
    expect(field(/整本張數/)).toBeDisabled();
    expect(field(/遊戲名稱/)).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "刪除" }),
    ).not.toBeInTheDocument();
  });

  it("沒有庫存:有 games.delete 才有 [刪除];確認後刪除", async () => {
    const { user } = renderMasterData({
      path: "/master-data/game-edit-page/g-5198",
    });
    await screen.findByRole("button", { name: "刪除" });
    // 動作列(REACT-16):[刪除] 在左側,[取消] → [儲存] 靠右
    expectButtonOrder(["刪除", "取消", "儲存"]);
    await user.click(screen.getByRole("button", { name: "刪除" }));
    await user.click(
      await screen.findByRole("button", { name: "刪除", hidden: false }),
    );
    expect(await screen.findByText("已刪除")).toBeInTheDocument();
  });

  it("沒有 games.delete → 編輯頁沒有 [刪除]", async () => {
    renderMasterData({
      path: "/master-data/game-edit-page/g-5198",
      permissions: [P.gamesCreate, P.gamesEdit],
    });
    expect(
      await screen.findByRole("textbox", { name: /遊戲名稱/ }),
    ).toHaveValue("鼠來寶");
    expect(
      screen.queryByRole("button", { name: "刪除" }),
    ).not.toBeInTheDocument();
  });

  it("詳情頁:有 games.edit 才有 [編輯]", async () => {
    renderMasterData({
      path: "/master-data/game-view-page/g-5164",
      permissions: [],
    });
    expect(await screen.findByText("5164 發大財")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "編輯" }),
    ).not.toBeInTheDocument();
  });

  it("詳情頁:有 games.edit → [編輯] 進編輯頁", async () => {
    const { user } = renderMasterData({
      path: "/master-data/game-view-page/g-5164",
    });
    await screen.findByRole("button", { name: "編輯" });
    // 檢視頁頂部列(REACT-16):左 [← 返回列表],右 [編輯](contained)
    expect(expectButtonOrder(["← 返回列表", "編輯"])[1]).toHaveClass(
      "MuiButton-contained",
    );
    await user.click(screen.getByRole("button", { name: "編輯" }));
    expect(
      await screen.findByRole("textbox", { name: /遊戲名稱/ }),
    ).toHaveValue("發大財");
  });
});
