import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import { graphqlError } from "@/test/msw/auth-handlers";
import { api, server } from "@/test/msw/server";

import { renderAccounts } from "../accounts-test-support";

/** GQL-04 的 `VALIDATION_FAILED`(HTTP 200 + `errors[].extensions`)。 */
const businessError = (extensions: Record<string, unknown>) =>
  graphqlError("VALIDATION_FAILED", "VALIDATION_FAILED", extensions);

const GENERIC = "有欄位不正確,請檢查標示的欄位";

/** REACT-18:帳戶管理的對話框與帳戶設定,欄位錯了原因寫在欄位正下方,提示只放通用句。 */
describe("帳戶管理:欄位下寫原因", () => {
  it("新增帳戶:銀行代碼不是 3 碼、帳號沒填 → 各欄寫格式要求", async () => {
    const { user } = renderAccounts();
    await user.click(await screen.findByRole("button", { name: "+ 新增帳戶" }));
    const dialog = await screen.findByRole("dialog", { name: "新增帳戶" });
    const bankCode = within(dialog).getByRole("textbox", { name: /銀行代碼/ });
    await user.type(bankCode, "12");
    await user.click(within(dialog).getByRole("button", { name: "新增" }));

    expect(bankCode).toHaveAccessibleDescription("銀行代碼要 3 碼數字");
    expect(
      within(dialog).getByRole("textbox", { name: /^帳號/ }),
    ).toHaveAccessibleDescription("必填,最多 30 個字");
  });

  it("新增帳戶:同銀行代碼 + 帳號已有帳戶(api 帶 reason)→ 帳號欄下寫原因,上方只放通用句", async () => {
    const { user } = renderAccounts();
    server.use(
      api.mutation("CreateLotteryBankAccount", () =>
        businessError({
          code: "VALIDATION_FAILED",
          fields: ["accountNo"],
          reason: "BANK_ACCOUNT_DUPLICATE",
        }),
      ),
    );
    await user.click(await screen.findByRole("button", { name: "+ 新增帳戶" }));
    const dialog = await screen.findByRole("dialog", { name: "新增帳戶" });
    await user.type(
      within(dialog).getByRole("textbox", { name: /銀行代碼/ }),
      "012",
    );
    const accountNo = within(dialog).getByRole("textbox", { name: /^帳號/ });
    await user.type(accountNo, "123456789");
    await user.type(
      within(dialog).getByRole("textbox", { name: /戶名/ }),
      "好運彩券行",
    );
    await user.click(within(dialog).getByRole("button", { name: "新增" }));

    expect(
      await within(dialog).findByText("同一個銀行代碼與帳號已經有帳戶"),
    ).toBeInTheDocument();
    expect(accountNo).toHaveAccessibleDescription(
      "同一個銀行代碼與帳號已經有帳戶",
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent(GENERIC);
  });

  it("帳戶設定:api 只回欄位(格式錯)→ 銀行代碼欄下寫格式要求", async () => {
    const { user } = renderAccounts({ path: "/accounts/view-page/ba-1" });
    server.use(
      api.mutation("UpdateLotteryBankAccount", () =>
        businessError({
          code: "VALIDATION_FAILED",
          fields: ["bankCode"],
        }),
      ),
    );
    await screen.findByText("帳戶設定");
    await user.click(screen.getByRole("button", { name: "儲存" }));
    expect(await screen.findByText("銀行代碼要 3 碼數字")).toBeInTheDocument();
  });

  it("登記交易:金額沒填 → 金額欄下寫「要填大於 0 的整數」", async () => {
    const { user } = renderAccounts({ path: "/accounts/view-page/ba-1" });
    await user.click(await screen.findByRole("button", { name: "登記交易" }));
    const dialog = await screen.findByRole("dialog", { name: "登記交易" });
    await user.click(within(dialog).getByRole("button", { name: "登記" }));
    expect(
      within(dialog).getByRole("textbox", { name: /金額/ }),
    ).toHaveAccessibleDescription("要填大於 0 的整數");
  });

  it("沖正:原因沒填 → 原因欄下寫格式要求", async () => {
    const { user } = renderAccounts({ path: "/accounts/view-page/ba-1" });
    await screen.findByText("日結存入 · C-0040");
    await user.click(screen.getAllByRole("button", { name: "沖正" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "沖正" });
    await user.click(within(dialog).getByRole("button", { name: "沖正" }));
    expect(
      within(dialog).getByRole("textbox", { name: /原因/ }),
    ).toHaveAccessibleDescription("必填,最多 200 個字");
  });
});
