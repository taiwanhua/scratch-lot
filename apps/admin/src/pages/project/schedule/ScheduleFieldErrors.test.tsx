import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import { graphqlError } from "@/test/msw/auth-handlers";
import { makeupPunchFormWorld } from "@/test/msw/project/schedule-makeup-punch-fixtures";
import { api, server } from "@/test/msw/server";
import { setupFakeViewport } from "@/test/viewport";

import { fastUser, findDialog } from "./manage/roster/roster-test-queries";
import {
  renderSchedulePage,
  typeDate,
  typeTime,
} from "./schedule-test-support";

setupFakeViewport();

/** GQL-04 的 `VALIDATION_FAILED`(HTTP 200 + `errors[].extensions`)。 */
const businessError = (extensions: Record<string, unknown>) =>
  graphqlError("VALIDATION_FAILED", "VALIDATION_FAILED", extensions);

/** REACT-18:排班的行事曆、畫休、出勤對話框,欄位錯了原因寫在欄位正下方。 */
describe("排班:欄位下寫原因", () => {
  it("行事曆:這一天已經有行事曆(api 帶 reason)→ 日期欄下寫原因", async () => {
    const { user } = renderSchedulePage({
      path: "/schedule/manage?tab=calendar&month=2026-11",
    });
    server.use(
      api.mutation("SaveScheduleCalendarDay", () =>
        businessError({
          fields: ["date"],
          reason: "CALENDAR_DAY_DUPLICATE",
        }),
      ),
    );
    await user.click(
      await screen.findByRole("button", { name: "+ 新增店休 / 特殊日" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "新增店休 / 特殊日",
    });
    await user.click(within(dialog).getByLabelText("店休"));
    await typeDate(user, dialog, "2026-11-20");
    const date = within(dialog).getByRole("group", { name: /日期/ });
    await user.click(within(dialog).getByRole("button", { name: "新增" }));
    expect(
      await within(dialog).findByText("這一天已經有行事曆了"),
    ).toBeInTheDocument();
    expect(date).toHaveAccessibleDescription("這一天已經有行事曆了");
  });

  it("代改畫休:沒選人 → 人員欄下寫「必填」;已有整天畫休(api 帶 reason)→ 類型下寫原因", async () => {
    const { user } = renderSchedulePage({
      path: "/schedule/manage?tab=day-offs",
    });
    server.use(
      api.mutation("AddScheduleDayOffsOnBehalf", () =>
        businessError({ fields: ["kind"], reason: "DAY_OFF_DUPLICATE" }),
      ),
    );
    await user.click(await screen.findByRole("button", { name: "代改" }));
    const dialog = await screen.findByRole("dialog", { name: "代改畫休" });
    await typeDate(user, dialog, "2026-12-18");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(within(dialog).getByText("必填")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("combobox", { name: /人員/ }));
    await user.click(await screen.findByRole("option", { name: "張小芳" }));
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(
      await within(dialog).findByText("這一天已經有整天的畫休"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("group", { name: "種類" }),
    ).toHaveAccessibleDescription("這一天已經有整天的畫休");
  });

  it("代改畫休:畫面沒有那天已登記的段落(例:選了總覽以外的月份),api 判斷連同已存的蓋滿整天(DAY_OFF_WHOLE_DAY)→ 時段下寫「整天請改選整天畫休」", async () => {
    const { user } = renderSchedulePage({
      path: "/schedule/manage?tab=day-offs",
    });
    server.use(
      api.mutation("AddScheduleDayOffsOnBehalf", () =>
        businessError({ fields: ["slots"], reason: "DAY_OFF_WHOLE_DAY" }),
      ),
    );
    await user.click(await screen.findByRole("button", { name: "代改" }));
    const dialog = await screen.findByRole("dialog", { name: "代改畫休" });
    await user.click(within(dialog).getByRole("combobox", { name: /人員/ }));
    await user.click(await screen.findByRole("option", { name: "張小芳" }));
    await typeDate(user, dialog, "2027-01-05");
    await user.click(within(dialog).getByLabelText("時段不可排"));
    await typeTime(
      user,
      within(dialog).getByRole("group", { name: /開始/ }),
      "09:00",
    );
    await typeTime(
      user,
      within(dialog).getByRole("group", { name: /結束/ }),
      "12:00",
    );
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(
      await within(dialog).findByText("整天請改選整天畫休"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("group", { name: "時段" }),
    ).toHaveAccessibleDescription("整天請改選整天畫休");
  });

  it("登記畫休:沒選日期 → 日期欄下寫「必填,請選擇日期」;時段重疊(api 帶 reason)→ 時段下寫原因", async () => {
    const { user } = renderSchedulePage({ path: "/schedule/my?tab=day-offs" });
    server.use(
      api.mutation("AddMyScheduleDayOffs", () =>
        businessError({ fields: ["slots"], reason: "TIME_RANGES_OVERLAP" }),
      ),
    );
    await user.click(await screen.findByRole("button", { name: "登記畫休" }));
    const dialog = await screen.findByRole("dialog", { name: "登記畫休" });
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    const date = within(dialog).getByRole("group", { name: /日期/ });
    expect(date).toHaveAccessibleDescription("必填,請選擇日期");

    await typeDate(user, dialog, "2026-12-03");
    await user.click(within(dialog).getByLabelText("時段不可排"));
    await typeTime(
      user,
      within(dialog).getByRole("group", { name: /開始/ }),
      "09:00",
    );
    await typeTime(
      user,
      within(dialog).getByRole("group", { name: /結束/ }),
      "12:00",
    );
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(
      await within(dialog).findByText("時段和這一天其他的畫休時段重疊"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("group", { name: "時段" }),
    ).toHaveAccessibleDescription("時段和這一天其他的畫休時段重疊");
  });

  it("改對應排班:沒選原因 → 原因欄下寫「必填,請選擇原因」", async () => {
    const user = fastUser();
    renderSchedulePage({
      path: "/schedule/attendance?tab=store&date=2026-11-04",
    });
    const line = await screen.findByText("張小芳 · 09:02 上班 · 15:10 下班");
    const row = line.parentElement;
    if (row === null) {
      throw new Error("找不到未對應排班那一行");
    }
    await user.click(within(row).getByRole("button", { name: "改對應排班" }));
    const dialog = await findDialog("修改這張打卡對應的排班");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(within(dialog).getByText("必填,請選擇原因")).toBeInTheDocument();
  });

  it("補打卡新增頁:沒選補打卡時間、沒選原因 → 各欄下寫格式要求", async () => {
    const user = fastUser();
    renderSchedulePage({
      path: "/schedule/attendance/create-page/makeup_punch?org=org-store&type=out",
      forms: makeupPunchFormWorld(),
    });
    await screen.findByRole("combobox", { name: /對應排班/ });
    await user.click(await screen.findByRole("button", { name: /^送出/ }));
    expect(
      screen.getByRole("group", { name: /補打卡時間/ }),
    ).toHaveAccessibleDescription("必填,請選擇日期與時間");
    expect(screen.getByText("必填,請選擇原因")).toBeInTheDocument();
  });
});
