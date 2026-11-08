import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse } from "msw";

import { api, server } from "@/test/msw/server";

import { renderAccounts } from "../accounts-test-support";

const openDialog = async () => {
  const rendered = renderAccounts({ path: "/accounts/view-page/ba-1" });
  // 提領「現金去向」可選的分店(帳戶使用組織包含的分店)
  server.use(
    api.query("LotteryBankAccountVaultStores", () =>
      HttpResponse.json({
        data: {
          lotteryBankAccountVaultStores: [
            {
              __typename: "LotteryAccountsRef",
              id: "org-store-a",
              name: "中山店",
            },
          ],
        },
      }),
    ),
  );
  await rendered.user.click(
    await screen.findByRole("button", { name: "登記交易" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "登記交易" });
  return { ...rendered, dialog };
};

const chooseType = async (
  user: Awaited<ReturnType<typeof openDialog>>["user"],
  dialog: HTMLElement,
  label: string,
) => {
  await user.click(within(dialog).getByRole("combobox", { name: /類型/ }));
  await user.click(await screen.findByRole("option", { name: label }));
};

/** 登記交易「提領」的現金去向(規格 10.1;選了分店 = 現金進那家店的小金庫)。 */
describe("登記交易:提領的現金去向", () => {
  it("只有提領才有「現金去向」;欄位下方註明沒選 = 從帳戶提領現金", async () => {
    const { user, dialog } = await openDialog();
    expect(
      within(dialog).queryByRole("combobox", { name: /現金去向/ }),
    ).not.toBeInTheDocument();
    await chooseType(user, dialog, "提領");
    const field = within(dialog).getByRole("combobox", { name: /現金去向/ });
    expect(field).toHaveAccessibleDescription(
      /沒選 = 從帳戶提領現金,只扣銀行、不進任何小金庫/,
    );
  });

  it("選了分店小金庫 → 送出帶 vaultOrgId、不帶歸屬分店;沒選 → 不帶 vaultOrgId", async () => {
    const { user, dialog, fake } = await openDialog();
    await chooseType(user, dialog, "提領");
    await user.click(
      within(dialog).getByRole("combobox", { name: /現金去向/ }),
    );
    await user.click(await screen.findByRole("option", { name: "中山店" }));
    await user.type(
      within(dialog).getByRole("textbox", { name: /金額/ }),
      "3000",
    );
    await user.click(within(dialog).getByRole("button", { name: "登記" }));
    await waitFor(() => {
      expect(fake.inputs.record).toHaveLength(1);
    });
    expect(fake.inputs.record[0]).toMatchObject({
      type: "withdrawal",
      amount: 3000,
      vaultOrgId: "org-store-a",
    });
    expect(fake.inputs.record[0]).not.toHaveProperty("branchOrgId");

    await user.click(await screen.findByRole("button", { name: "登記交易" }));
    const again = await screen.findByRole("dialog", { name: "登記交易" });
    await chooseType(user, again, "提領");
    await user.type(
      within(again).getByRole("textbox", { name: /金額/ }),
      "500",
    );
    await user.click(within(again).getByRole("button", { name: "登記" }));
    await waitFor(() => {
      expect(fake.inputs.record).toHaveLength(2);
    });
    expect(fake.inputs.record[1]).not.toHaveProperty("vaultOrgId");
  });
});
