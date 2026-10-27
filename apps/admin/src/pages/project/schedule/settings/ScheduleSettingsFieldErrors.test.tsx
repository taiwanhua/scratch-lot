import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import { graphqlError } from "@/test/msw/auth-handlers";
import { api, server } from "@/test/msw/server";

import { renderSchedulePage } from "../schedule-test-support";

const SETTINGS = "/schedule/settings";

/** GQL-04 的 `VALIDATION_FAILED`(HTTP 200 + `errors[].extensions`)。 */
const businessError = (extensions: Record<string, unknown>) =>
  graphqlError("VALIDATION_FAILED", "VALIDATION_FAILED", extensions);

/** REACT-18:排班設定的對話框,欄位錯了原因寫在欄位正下方。 */
describe("排班設定:欄位下寫原因", () => {
  it("新增人力需求範本:沒填就儲存 → 名稱、簡稱、時間、崗位各自寫格式要求", async () => {
    const { user } = renderSchedulePage({ path: `${SETTINGS}?tab=templates` });
    await user.click(
      await screen.findByRole("button", { name: "+ 新增人力需求範本" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "新增人力需求範本",
    });
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));

    expect(
      within(dialog).getByRole("textbox", { name: /名稱/ }),
    ).toHaveAccessibleDescription("必填");
    expect(
      within(dialog).getByRole("textbox", { name: /簡稱/ }),
    ).toHaveAccessibleDescription("要填 1–2 個字");
    expect(within(dialog).getAllByText("必填,請填時間(時:分)")).toHaveLength(1);
    expect(
      within(dialog).getByText("必填,不能和開始時間相同"),
    ).toBeInTheDocument();
  });

  it("新增人力需求週範本:名稱沒填 → 名稱欄下寫「必填」", async () => {
    const { user } = renderSchedulePage({
      path: `${SETTINGS}?tab=week-templates`,
    });
    await user.click(
      await screen.findByRole("button", { name: "+ 新增人力需求週範本" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(
      within(dialog).getByRole("textbox", { name: /名稱/ }),
    ).toHaveAccessibleDescription("必填");
  });

  it("規則:值超出範圍 → 值欄下寫範圍", async () => {
    const { user } = renderSchedulePage({ path: `${SETTINGS}?tab=rules` });
    const label = await screen.findByText("每月最多畫休");
    const row = label.closest("[data-rule-key]");
    if (!(row instanceof HTMLElement)) {
      throw new TypeError("找不到規則列");
    }
    await user.click(within(row).getByRole("button", { name: "自訂" }));
    const dialog = await screen.findByRole("dialog", {
      name: "規則 · 每月最多畫休",
    });
    const value = within(dialog).getByLabelText("值(天)");
    await user.clear(value);
    await user.type(value, "999");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(value).toHaveAccessibleDescription(/^要填 \d+–\d+$/u);
  });

  it("規則:選的週範本已不在(api 帶 reason)→ 週範本欄下寫原因,不是「必填」", async () => {
    const { user } = renderSchedulePage({ path: `${SETTINGS}?tab=rules` });
    server.use(
      api.mutation("CustomizeScheduleRule", () =>
        businessError({
          fields: ["value.weekTemplateId"],
          reason: "REFERENCE_NOT_FOUND",
        }),
      ),
    );
    const label = await screen.findByText("預設人力需求週範本");
    const row = label.closest("[data-rule-key]");
    if (!(row instanceof HTMLElement)) {
      throw new TypeError("找不到規則列");
    }
    await user.click(within(row).getByRole("button", { name: /自訂|編輯/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(
      await within(dialog).findByText("選的資料已不存在或你看不到,請重新選擇"),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText("必填")).not.toBeInTheDocument();
  });

  it("排班人員設定:主要分店不是剛好一家(api 帶 reason)→ 分店清單下寫原因", async () => {
    const { user } = renderSchedulePage({ path: SETTINGS });
    server.use(
      api.mutation("UpdateScheduleStaff", () =>
        businessError({
          code: "VALIDATION_FAILED",
          fields: ["orgs"],
          reason: "PRIMARY_ORG_REQUIRED",
        }),
      ),
    );
    await user.click(await screen.findByText("王小明"));
    const dialog = await screen.findByRole("dialog", {
      name: "排班人員設定 · 王小明",
    });
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(
      await within(dialog).findByText("主要分店要剛好選一家"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("group", { name: "可以排的分店" }),
    ).toHaveAccessibleDescription("主要分店要剛好選一家");
  });
});
