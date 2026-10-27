import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import { graphqlError } from "@/test/msw/auth-handlers";
import { api, server } from "@/test/msw/server";

import {
  findDesigner,
  preloadFormsPage,
  renderFormsPage,
} from "./forms-page-test-support";

preloadFormsPage();

/** GQL-04 的 `VALIDATION_FAILED`(HTTP 200 + `errors[].extensions`)。 */
const validationFailed = (extensions: Record<string, unknown>) =>
  graphqlError("VALIDATION_FAILED", "VALIDATION_FAILED", extensions);

/** REACT-18:表單管理的欄位錯了,原因寫在欄位正下方,提示只放通用句。 */
describe("表單管理:欄位下寫原因", () => {
  it("建立表單:key 已被用過(api 帶 reason)→ key 欄下寫原因", async () => {
    const { user } = renderFormsPage();
    server.use(
      api.mutation("CreateForm", () =>
        validationFailed({ fields: ["key"], reason: "FORM_KEY_DUPLICATE" }),
      ),
    );
    await screen.findByRole("heading", { name: "購物單" });
    await user.click(screen.getByRole("button", { name: "+ 建立表單" }));
    const dialog = await screen.findByRole("dialog", { name: "建立表單" });
    const key = within(dialog).getByLabelText(/表單 key/);
    await user.type(key, "trip");
    await user.type(within(dialog).getByLabelText(/名稱/), "出差單");
    await user.click(within(dialog).getByLabelText(/所屬模組/));
    await user.click(
      await screen.findByRole("option", { name: "示範表單(頂層)" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "建立" }));
    expect(
      await within(dialog).findByText("這個 key 已經有表單使用,請換一個"),
    ).toBeInTheDocument();
    expect(key).toHaveAccessibleDescription("這個 key 已經有表單使用,請換一個");
  });

  it("單號格式:位數超出範圍 → 位數欄下寫範圍", async () => {
    const { user } = renderFormsPage();
    const group = await screen.findByRole("group", { name: "單號" });
    await user.click(
      within(group).getByRole("switch", { name: "第一次送出時給單號" }),
    );
    const digits = within(group).getByLabelText("位數");
    await user.clear(digits);
    await user.type(digits, "99");
    expect(digits).toHaveAccessibleDescription(/^位數要填 \d+–\d+ 的整數$/u);
  });

  it("列表欄位配置:同一欄列了兩次(api 帶 reason)→ 那一列下寫原因,並連到那一列", async () => {
    const { user } = renderFormsPage();
    await findDesigner();
    server.use(
      api.mutation("SetModuleListColumns", () =>
        validationFailed({
          fields: ["columns.0"],
          reason: "LIST_COLUMN_DUPLICATE",
        }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "列表欄位配置" }));
    const dialog = await screen.findByRole("dialog", {
      name: "列表欄位配置 — 示範表單(頂層)",
    });
    await user.click(within(dialog).getByRole("button", { name: "+ 摘要槽" }));
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(
      await within(dialog).findByRole("group", { name: "第 1 欄" }),
    ).toHaveAccessibleDescription("這一欄重複了,請移除其中一欄");
  });
});
