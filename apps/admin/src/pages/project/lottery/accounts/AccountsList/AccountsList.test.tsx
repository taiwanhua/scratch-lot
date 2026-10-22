import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import { PURCHASE_PERMISSIONS } from "@repo/domain/project/lottery";
import { ACCOUNTS_PERMISSIONS as P } from "@repo/domain/project/lottery-accounts";

import { ALL_ACCOUNTS_PERMISSIONS } from "@/test/msw/project/lottery/accounts-fixtures";
import { restoreViewportAfterEach, setMobileViewport } from "@/test/viewport";

import { renderAccounts } from "../accounts-test-support";

restoreViewportAfterEach();

/** 手機卡片:以含這段文字的那一張卡片為範圍。 */
const cardOf = async (text: string) => {
  const node = await screen.findByText(text);
  const card = node.closest<HTMLElement>('[role="listitem"]');
  if (card === null) {
    throw new Error(`找不到含「${text}」的卡片`);
  }
  return within(card);
};

/** 這個名稱的清單是卡片(手機),沒有同名表格。 */
const expectCards = async (name: string) => {
  expect(await screen.findByRole("list", { name })).toBeInTheDocument();
  expect(screen.queryByRole("table", { name })).not.toBeInTheDocument();
};

/** 這個名稱的清單是表格(平板以上),沒有同名卡片清單。 */
const expectTable = async (name: string) => {
  expect(await screen.findByRole("table", { name })).toBeInTheDocument();
  expect(screen.queryByRole("list", { name })).not.toBeInTheDocument();
};

/**
 * 帳戶管理各清單的平板 / 手機規則(規格 16.0「列表的表格在手機改成卡片」;Figma RW-01 131:1815):
 * 手機(< sm)每列一張卡片 —— 標題列(重點欄位 + 狀態標籤)、其餘欄位「名稱 … 值」、原有按鈕在卡片底部;
 * 平板以上照舊表格。按鈕仍看 api 的 abilities / `canSettle` / `canClose`。
 */
describe("帳戶管理:手機卡片", () => {
  it("銀行帳戶:手機是卡片(戶名、狀態、餘額),點卡片進帳戶詳情", async () => {
    setMobileViewport();
    const { user } = renderAccounts();
    await expectCards("銀行帳戶列表");
    const card = await cardOf("好運彩券行新竹");
    expect(card.getByText("使用中")).toBeInTheDocument();
    expect(card.getByText("餘額")).toBeInTheDocument();
    expect(card.getByText("-2,000")).toBeInTheDocument();
    const inactive = await cardOf("舊帳戶");
    expect(inactive.getByText("停用")).toBeInTheDocument();
    expect(screen.getByText("1,284,300")).toBeInTheDocument();
    await user.click(screen.getByText("好運彩券行新竹"));
    expect(
      await screen.findByRole("button", { name: "登記交易" }),
    ).toBeInTheDocument();
  });

  it("銀行帳戶:平板以上照舊表格", async () => {
    renderAccounts();
    await expectTable("銀行帳戶列表");
  });

  it("交易清單:手機是卡片,[沖正] 照 abilities(掛在單據上的要收付權限)", async () => {
    setMobileViewport();
    renderAccounts({
      path: "/accounts/view-page/ba-1",
      permissions: [...ALL_ACCOUNTS_PERMISSIONS, PURCHASE_PERMISSIONS.settle],
    });
    await expectCards("交易清單");
    const linked = await cardOf("進貨單 P-0031 · 批購 10/12");
    expect(linked.getByRole("button", { name: "沖正" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "沖正" })).toHaveLength(3);
    expect(screen.getByText("已沖正")).toBeInTheDocument();
  });

  it("交易清單:沒有沖正權限 → 卡片沒有 [沖正]", async () => {
    setMobileViewport();
    renderAccounts({
      path: "/accounts/view-page/ba-1",
      permissions: [P.viewBankAccounts],
    });
    await expectCards("交易清單");
    await screen.findByText("日結存入 · C-0040");
    expect(
      screen.queryByRole("button", { name: "沖正" }),
    ).not.toBeInTheDocument();
  });

  it("交易清單:平板以上照舊表格", async () => {
    renderAccounts({ path: "/accounts/view-page/ba-1" });
    await expectTable("交易清單");
  });

  it("即時現金帳:手機的流水是卡片(類型、從 → 到、金額)", async () => {
    setMobileViewport();
    renderAccounts({ path: "/accounts?tab=cash" });
    await expectCards("現金流水");
    const card = await cardOf("抽屜 → 外部(王小明)");
    expect(card.getByText("金額")).toBeInTheDocument();
    expect(screen.getByText("投庫")).toBeInTheDocument();
    expect(screen.getByText("出庫(開班零用金)")).toBeInTheDocument();
  });

  it("即時現金帳:平板以上照舊表格", async () => {
    renderAccounts({ path: "/accounts?tab=cash" });
    await expectTable("現金流水");
  });

  it("待結清款項:手機是卡片(單據、差額標籤),每張卡片的按鈕照 canSettle,按下開付款視窗", async () => {
    setMobileViewport();
    const { user } = renderAccounts({ path: "/accounts?tab=outstanding" });
    await expectCards("待結清款項");
    const refund = await cardOf("P-0031 進貨");
    expect(refund.getByText("待退 2,000")).toBeInTheDocument();
    const card = await cardOf("P-0033 進貨");
    expect(card.getByText("待付 36,800")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "收到退款" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收款" })).toBeInTheDocument();
    await user.click(card.getByRole("button", { name: "付款" }));
    expect(
      await screen.findByRole("dialog", { name: "付款" }),
    ).toBeInTheDocument();
  });

  it("待結清款項:平板以上照舊表格", async () => {
    renderAccounts({ path: "/accounts?tab=outstanding" });
    await expectTable("待結清款項");
  });
});
