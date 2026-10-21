import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { ACCOUNTS_PERMISSIONS as P } from "@repo/domain/project/lottery-accounts";

import { renderAccounts } from "../accounts-test-support";

/**
 * 帳戶管理(規格 10.1「沒有權限時」;Figma AC-01、AC-02、AC-04、AC-05):
 * 分頁看 `view-*` 權限、[+ 新增帳戶] 看 `create-bank-account`、帳戶詳情的按鈕看 api 的 abilities。
 */
describe("帳戶管理:分頁與按鈕", () => {
  it("三個分頁都有:銀行帳戶列表(餘額、使用組織、狀態)與 [+ 新增帳戶]", async () => {
    renderAccounts();
    expect(
      await screen.findByRole("tab", { name: "銀行帳戶" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "即時現金帳" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "待結清款項" })).toBeInTheDocument();
    expect(await screen.findByText("好運彩券行新竹")).toBeInTheDocument();
    expect(screen.getByText("1,284,300")).toBeInTheDocument();
    expect(screen.getByText("-2,000")).toBeInTheDocument();
    expect(screen.getByText("好運彩券行、中山店")).toBeInTheDocument();
    expect(screen.getByText("停用")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "+ 新增帳戶" }),
    ).toBeInTheDocument();
  });

  it("沒有 view-bank-accounts / view-cash → 看不到那兩個分頁;只剩待結清款項時不顯示分頁籤", async () => {
    renderAccounts({ permissions: [P.viewOutstanding] });
    expect(await screen.findByText("P-0031 進貨")).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "銀行帳戶" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "即時現金帳" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "+ 新增帳戶" }),
    ).not.toBeInTheDocument();
  });

  it("沒有 view-outstanding → 看不到待結清款項分頁;沒有 create-bank-account → 沒有 [+ 新增帳戶]", async () => {
    renderAccounts({ permissions: [P.viewBankAccounts, P.viewCash] });
    expect(await screen.findByText("好運彩券行新竹")).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "待結清款項" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "+ 新增帳戶" }),
    ).not.toBeInTheDocument();
  });

  it("即時現金帳:小金庫與抽屜應有、流水(類型、從 → 到、收銀點)", async () => {
    const { user } = renderAccounts();
    await user.click(await screen.findByRole("tab", { name: "即時現金帳" }));
    expect(await screen.findByText("48,200")).toBeInTheDocument();
    // 開班中收銀點的抽屜應有(店面登記)
    expect(screen.getByText("店內櫃台 抽屜")).toBeInTheDocument();
    expect(screen.getByText("12,350")).toBeInTheDocument();
    expect(screen.getByText("投庫")).toBeInTheDocument();
    expect(screen.getByText("出庫(開班零用金)")).toBeInTheDocument();
    expect(screen.getByText("抽屜 → 外部(王小明)")).toBeInTheDocument();
  });

  it("待結清款項:差額標籤與每列按鈕;沒有那一邊的收付權限 → 沒有按鈕", async () => {
    const { user } = renderAccounts();
    await user.click(await screen.findByRole("tab", { name: "待結清款項" }));
    expect(await screen.findByText("待退 2,000")).toBeInTheDocument();
    expect(screen.getByText("待收 1,840")).toBeInTheDocument();
    expect(screen.getByText("待付 36,800")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "收到退款" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收款" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "付款" })).toBeInTheDocument();
  });

  it("待結清款項 [付款] → 付款視窗先填差額,選帳戶後確認送出", async () => {
    const { user, fake } = renderAccounts();
    await user.click(await screen.findByRole("tab", { name: "待結清款項" }));
    await user.click(await screen.findByRole("button", { name: "付款" }));
    const dialog = await screen.findByRole("dialog", { name: "付款" });
    expect(within(dialog).getByRole("textbox", { name: /金額/ })).toHaveValue(
      "36800",
    );
    await user.click(within(dialog).getByRole("combobox", { name: /帳戶/ }));
    await user.click(
      await screen.findByRole("option", { name: "好運彩券行 末 34521" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "確認" }));
    await waitFor(() => {
      expect(fake.inputs.settle).toEqual([
        expect.objectContaining({
          refId: "doc-p33",
          side: "hq",
          button: "out",
          method: "bank",
          accountId: "ba-1",
          amount: 36_800,
        }),
      ]);
    });
  });
});

describe("銀行帳戶詳情", () => {
  it("有登記 / 沖正 / 編輯權限:[登記交易]、每列 [沖正](已沖正的顯示已沖正)、帳戶設定;有交易時期初鎖定、不能刪除", async () => {
    renderAccounts({ path: "/accounts/view-page/ba-1" });
    expect(
      await screen.findByRole("button", { name: "登記交易" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "設定使用組織" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("日結存入 · C-0040")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "沖正" })).toHaveLength(3);
    expect(screen.getByText("已沖正")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "期初餘額" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "刪除帳戶" })).toBeDisabled();
  });

  it("沒有 record / reverse / edit 權限:看不到 [登記交易]、[沖正]、帳戶設定", async () => {
    renderAccounts({
      path: "/accounts/view-page/ba-1",
      permissions: [P.viewBankAccounts],
    });
    expect(await screen.findByText("日結存入 · C-0040")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "登記交易" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "沖正" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("帳戶設定")).not.toBeInTheDocument();
  });

  it("沖正:原因必填,送出後原交易顯示已沖正", async () => {
    const { user, fake } = renderAccounts({ path: "/accounts/view-page/ba-1" });
    await screen.findByText("日結存入 · C-0040");
    await user.click(screen.getAllByRole("button", { name: "沖正" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "沖正" });
    await user.click(within(dialog).getByRole("button", { name: "沖正" }));
    expect(fake.inputs.reverse).toEqual([]);
    await user.type(
      within(dialog).getByRole("textbox", { name: /原因/ }),
      "金額記錯",
    );
    await user.click(within(dialog).getByRole("button", { name: "沖正" }));
    await waitFor(() => {
      expect(fake.inputs.reverse).toEqual([{ id: "bt-4", reason: "金額記錯" }]);
    });
    const table = screen.getByRole("table", { name: "交易清單" });
    expect(await within(table).findAllByText("已沖正")).toHaveLength(2);
  });
});
