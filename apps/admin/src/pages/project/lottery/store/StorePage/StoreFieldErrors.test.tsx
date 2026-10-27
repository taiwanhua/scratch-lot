import { beforeEach, describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import { writeLocalCashPoint } from "@/lib/project/lottery/local-cash-point";

import { fastUser } from "../../../schedule/manage/roster/roster-test-queries";
import { renderStore } from "../store-test-support";

const STORE_A = "org-store-a";
const WIZARD_PATH = `/store/create-page/checkout_confirm?org=${STORE_A}&type=daily`;

/** 收銀點標題列(以名稱找那一列;同一頁有三列)。 */
const headerOf = async (name: string): Promise<HTMLElement> => {
  const heading = await screen.findByRole("heading", { name });
  const card = heading.closest<HTMLElement>(".MuiCard-root");
  if (card === null) {
    throw new Error(`找不到收銀點標題列:${name}`);
  }
  return card;
};

/** REACT-18:店面的對話框與日結精靈,欄位錯了原因寫在欄位正下方。 */
describe("店面管理:欄位下寫原因", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("投庫:金額沒填 → 金額欄下寫「要填大於 0 的整數」;超過抽屜應有 → 金額欄下寫原因", async () => {
    writeLocalCashPoint(STORE_A, "cp-counter");
    const { user } = renderStore();
    const counter = await headerOf("店內櫃台");
    await user.click(within(counter).getByRole("button", { name: "投庫" }));
    const dialog = await screen.findByRole("dialog", {
      name: "投庫 · 抽屜 → 小金庫",
    });
    const amount = within(dialog).getByRole("textbox", { name: /金額/ });
    await user.click(within(dialog).getByRole("button", { name: "投庫" }));
    expect(amount).toHaveAccessibleDescription("要填大於 0 的整數");

    await user.type(amount, "20000");
    await user.click(within(dialog).getByRole("button", { name: "投庫" }));
    expect(
      await within(dialog).findByText("投庫金額不能超過抽屜目前的應有現金"),
    ).toBeInTheDocument();
  });

  it("出庫:沒選原因 → 原因欄下寫「必填,請選擇原因」", async () => {
    writeLocalCashPoint(STORE_A, "cp-counter");
    const { user } = renderStore();
    const counter = await headerOf("店內櫃台");
    await user.click(within(counter).getByRole("button", { name: "出庫" }));
    const dialog = await screen.findByRole("dialog", {
      name: "出庫 · 小金庫 → 抽屜",
    });
    await user.type(
      within(dialog).getByRole("textbox", { name: /金額/ }),
      "500",
    );
    await user.click(within(dialog).getByRole("button", { name: "出庫" }));
    expect(within(dialog).getByText("必填,請選擇原因")).toBeInTheDocument();
  });

  it("開班:領零用金不是整數 → 欄位下寫「要填 0 以上的整數」", async () => {
    const { user } = renderStore();
    const machine = await headerOf("彩券機旁");
    await user.click(within(machine).getByRole("button", { name: "開班" }));
    const dialog = await screen.findByRole("dialog", {
      name: "開班 · 彩券機旁",
    });
    await within(dialog).findByRole("combobox", { name: /對應排班/ });
    const float = within(dialog).getByRole("textbox", {
      name: "從小金庫領零用金",
    });
    await user.type(float, "1.5");
    await user.click(within(dialog).getByRole("button", { name: "仍要開班" }));
    expect(float).toHaveAccessibleDescription("要填 0 以上的整數");
  });

  it("班次資訊 → [改對應排班]:沒選原因 → 原因欄下寫「必填,請選擇原因」", async () => {
    const { user } = renderStore();
    const counter = await headerOf("店內櫃台");
    await user.click(within(counter).getByRole("button", { name: "班次資訊" }));
    const info = await screen.findByRole("dialog", {
      name: "班次資訊 · 店內櫃台",
    });
    await user.click(
      await within(info).findByRole("button", { name: "改對應排班" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "改對應排班" });
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(within(dialog).getByText("必填,請選擇原因")).toBeInTheDocument();
  });

  it("存銀行:金額沒填 → 金額欄下寫「要填大於 0 的整數」", async () => {
    const user = fastUser();
    renderStore();
    await user.click(await screen.findByRole("button", { name: "存銀行" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("中山店 · 小金庫目前應有 24,000");
    await user.click(within(dialog).getByRole("button", { name: "確認存入" }));
    expect(
      within(dialog).getByRole("textbox", { name: /金額/u }),
    ).toHaveAccessibleDescription("要填大於 0 的整數");
  });

  it("日結 ④ 存入銀行:金額不是整數 → 金額欄下寫「要填 0 以上的整數」", async () => {
    const user = fastUser();
    renderStore({
      path: WIZARD_PATH,
      dailyCloseOptions: { allApproved: true },
    });
    await screen.findByRole("heading", { name: "日結 · 中山店" });
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await screen.findByText("② 全店盤點");
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await screen.findByText("期初(10/13 日結清點)");
    await user.type(
      screen.getByRole("spinbutton", { name: "張 / 枚 1,000" }),
      "24",
    );
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await screen.findByText("④ 存入銀行");
    const amount = screen.getByRole("textbox", { name: "存入金額(0 = 不存)" });
    await user.type(amount, "1.5");
    expect(amount).toHaveAccessibleDescription("要填 0 以上的整數");
  });

  it("撤銷售出申請:沒選原因 → 原因欄下寫「必填,請選擇原因」", async () => {
    const { user } = renderStore({
      path: `/store/create-page/sale_reversal?org=${STORE_A}`,
    });
    await screen.findByRole("textbox", { name: "刷條碼加入張數" });
    await user.click(screen.getByRole("button", { name: /^送出/ }));
    expect(await screen.findByText("必填,請選擇原因")).toBeInTheDocument();
  });
});
