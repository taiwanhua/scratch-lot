import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import { renderMasterData } from "../master-data-test-support";

const GENERIC = "有欄位不正確,請檢查標示的欄位";

/** REACT-18:檔案管理的遊戲頁與收銀點對話框,欄位錯了原因寫在欄位正下方,提示只放通用句。 */
describe("檔案管理:欄位下寫原因", () => {
  it("新增遊戲:沒填就送出 → 代號、名稱、預設批購金額率各自寫格式要求", async () => {
    const { user } = renderMasterData({
      path: "/master-data/game-create-page",
    });
    const gameCode = await screen.findByRole("textbox", { name: /遊戲代號/ });
    await user.click(screen.getByRole("button", { name: "儲存" }));

    expect(gameCode).toHaveAccessibleDescription("遊戲代號要 4 碼數字");
    expect(
      screen.getByRole("textbox", { name: /遊戲名稱/ }),
    ).toHaveAccessibleDescription("必填,最多 30 個字");
    expect(
      screen.getByRole("textbox", { name: /預設批購金額率/ }),
    ).toHaveAccessibleDescription("要填 0–100 的整數");
  });

  it("新增遊戲:代號重複(api 帶 reason)→ 代號欄下寫原因,頁面提示只放通用句", async () => {
    const { user } = renderMasterData({
      path: "/master-data/game-create-page",
    });
    const gameCode = await screen.findByRole("textbox", { name: /遊戲代號/ });
    await user.type(gameCode, "5201");
    await user.type(screen.getByRole("textbox", { name: /遊戲名稱/ }), "重複");
    await user.type(screen.getByRole("combobox", { name: /單張金額/ }), "100");
    await user.type(
      screen.getByRole("textbox", { name: /預設批購金額率/ }),
      "90",
    );
    await user.click(screen.getByRole("button", { name: "儲存" }));

    expect(await screen.findByText("遊戲代號已被使用")).toBeInTheDocument();
    expect(gameCode).toHaveAccessibleDescription("遊戲代號已被使用");
    // 頁面上方的提示與 Snackbar 都只放通用句
    for (const alert of screen.getAllByRole("alert")) {
      expect(alert).toHaveTextContent(GENERIC);
    }
  });

  it("新增收銀點:同分店崗位重複 → 對應崗位欄下寫原因;名稱清空 → 名稱欄下寫格式要求", async () => {
    const { user } = renderMasterData();
    await user.click(await screen.findByRole("tab", { name: "收銀點" }));
    await user.click(
      await screen.findByRole("button", { name: "+ 新增收銀點" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "新增收銀點" });
    await user.click(
      within(dialog).getByRole("combobox", { name: /對應崗位/ }),
    );
    await user.click(await screen.findByRole("option", { name: "店外攤位" }));
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));

    expect(
      await within(dialog).findByText("這家分店已有這個崗位的收銀點"),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(GENERIC);

    await user.clear(within(dialog).getByRole("textbox", { name: /名稱/ }));
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(
      within(dialog).getByRole("textbox", { name: /名稱/ }),
    ).toHaveAccessibleDescription("必填,最多 30 個字");
  });
});
