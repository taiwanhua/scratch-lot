import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

import { MASTER_DATA_PERMISSIONS as P } from "@repo/domain/project/lottery-master-data";

import { expectButtonOrder } from "@/test/button-order";

import { renderMasterData } from "../master-data-test-support";

const field = (name: RegExp) => screen.getByRole("textbox", { name });
/** 單張金額是可輸入的下拉(datalist),角色是 combobox。 */
const price = () => screen.getByRole("combobox", { name: /單張金額/ });
/** 日期選擇器(`@repo/ui/date-picker`)是區段組:名稱 = 欄位標籤。 */
const datePicker = (name: RegExp) => screen.getByRole("group", { name });
const datePickerText = (name: RegExp) => datePicker(name).textContent;
const yearOf = (name: RegExp) =>
  within(datePicker(name)).getByRole("spinbutton", { name: "Year" });
/** 點年份區段後逐位打 `YYYYMMDD`。 */
const typeDate = async (user: UserEvent, name: RegExp, date: string) => {
  await user.click(yearOf(name));
  await user.keyboard(date.replaceAll("-", ""));
};

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
    await typeDate(user, /兌獎截止日/, "2027-07-01");
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
      claimDeadline: "2027-06-30T16:00:00.000Z",
    });
    expect(fake.inputs.createGame[0]).not.toHaveProperty("launchedAt");
    expect(fake.inputs.createGame[0]).not.toHaveProperty("discontinuedAt");
    expect(
      await screen.findByText(
        "500 元 × 40 張 · 整本 20,000 · 預設批購金額率 92%",
      ),
    ).toBeInTheDocument();
  });

  it("兌獎截止日必填;上市日 / 停售日唯讀,選了兌獎截止日就即時推算(月底取該月最後一天)", async () => {
    const { user, fake } = renderMasterData({
      path: "/master-data/game-create-page",
    });
    await user.type(
      await screen.findByRole("textbox", { name: /遊戲代號/ }),
      "5301",
    );
    await user.type(field(/遊戲名稱/), "月底");
    await user.type(price(), "100");
    await user.type(field(/預設批購金額率/), "92");
    expect(yearOf(/上市日/)).toHaveAttribute("aria-disabled", "true");
    expect(yearOf(/停售日/)).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("button", { name: "儲存" }));
    expect(
      datePicker(/兌獎截止日/).closest(".MuiFormControl-root"),
    ).toHaveTextContent("必填");
    expect(fake.inputs.createGame).toHaveLength(0);

    await typeDate(user, /兌獎截止日/, "2026-05-31");
    await waitFor(() => {
      expect(datePickerText(/停售日/)).toContain("2026-02-28");
    });
    expect(datePickerText(/上市日/)).toContain("2025-08-31");
    await user.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(fake.inputs.createGame).toHaveLength(1);
    });
    expect(fake.inputs.createGame[0]).toMatchObject({
      claimDeadline: "2026-05-30T16:00:00.000Z",
    });
  });

  it("編輯頁:上市日 / 停售日先顯示 api 回傳的值;改兌獎截止日即時重算", async () => {
    const { user } = renderMasterData({
      path: "/master-data/game-edit-page/g-5198",
    });
    await screen.findByRole("textbox", { name: /遊戲代號/ });
    expect(datePickerText(/兌獎截止日/)).toContain("2027-07-01");
    expect(datePickerText(/上市日/)).toContain("2026-10-01");
    expect(datePickerText(/停售日/)).toContain("2027-04-01");
    await typeDate(user, /兌獎截止日/, "2028-11-30");
    await waitFor(() => {
      expect(datePickerText(/上市日/)).toContain("2028-02-29");
    });
    expect(datePickerText(/停售日/)).toContain("2028-08-30");
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
    await typeDate(user, /兌獎截止日/, "2027-07-01");
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
