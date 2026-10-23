import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  NotificationScheduleKind,
  NotificationSettingPart,
} from "@repo/graphql";

import {
  monthlyType,
  notificationTypes,
  partyScheduledType,
} from "@/test/msw/notification-settings-handlers";

import {
  renderPage,
  rowOf,
  waitForRows,
} from "./notification-settings-test-support";

const allTypes = (expirySchedule?: number[]) => [
  ...notificationTypes(
    expirySchedule === undefined
      ? {}
      : {
          "demo.expiry-reminder": {
            schedule: {
              kind: NotificationScheduleKind.DaysBefore,
              daysBefore: expirySchedule,
              time: "09:00",
            },
          },
        },
  ),
  monthlyType(),
  partyScheduledType(),
];

const openEdit = async (
  user: ReturnType<typeof renderPage>["user"],
  name: string,
) => {
  await user.click(within(rowOf(name)).getByRole("button", { name: "編輯" }));
  return screen.findByRole("dialog");
};

/**
 * 通知設定頁的「提醒時間」(規格 3.5):清單欄位、編輯框依類型顯示幾塊、各自還原預設、範圍檢查。
 */
describe("通知設定頁:提醒時間", () => {
  it("清單多一欄提醒時間:宣告了的顯示目前的值,沒宣告的顯示「—(發生時)」;當事人通知的收件人唯讀「由事件決定」", async () => {
    renderPage({ world: { types: allTypes() } });
    await waitForRows();

    const expiry = rowOf("到期提醒");
    expect(
      within(expiry).getByText("到期前 30、7 天及當天 09:00"),
    ).toBeVisible();
    expect(within(expiry).getAllByText("預設")).toHaveLength(2);
    expect(
      within(rowOf("列印代理程式離線")).getByText("—(發生時)"),
    ).toBeVisible();
    expect(
      within(rowOf("月報提醒")).getByText("每月 3 號 09:00"),
    ).toBeVisible();
    const party = rowOf("截止提醒");
    expect(within(party).getByText("由事件決定(表單的填寫人)")).toBeVisible();
    expect(within(party).getByText("截止日前 1 天 09:00")).toBeVisible();
  });

  it("編輯「到期提醒」,把 30 改成 60、儲存:只送提醒時間;清單顯示「到期前 60、7 天及當天 09:00」", async () => {
    const { user, fake } = renderPage({ world: { types: allTypes() } });
    await waitForRows();

    const dialog = await openEdit(user, "到期提醒");
    expect(
      within(dialog).getByRole("heading", { name: "編輯通知設定:到期提醒" }),
    ).toBeVisible();
    expect(
      within(dialog).getAllByRole("region", { name: "收件人" })[0],
    ).toBeVisible();
    const schedule = within(dialog).getByRole("region", { name: "提醒時間" });

    const first = within(schedule).getByRole("textbox", { name: "提前天數 1" });
    await user.clear(first);
    await user.type(first, "60");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(fake.inputs.update).toEqual([
      {
        type: "demo.expiry-reminder",
        schedule: {
          kind: NotificationScheduleKind.DaysBefore,
          daysBefore: [60, 7, 0],
          time: "09:00",
        },
      },
    ]);
    await waitFor(() => {
      expect(
        within(rowOf("到期提醒")).getByText("到期前 60、7 天及當天 09:00"),
      ).toBeVisible();
    });
  });

  it("編輯「到期提醒」按提醒時間的 [還原預設]:只還原提醒時間,回到 30 / 7 / 0;收件人那塊不動", async () => {
    const { user, fake } = renderPage({
      world: { types: allTypes([60, 7, 0]) },
    });
    await waitForRows();
    expect(
      within(rowOf("到期提醒")).getByText("到期前 60、7 天及當天 09:00"),
    ).toBeVisible();

    const dialog = await openEdit(user, "到期提醒");
    const audience = within(dialog).getAllByRole("region", {
      name: "收件人",
    })[0];
    // 收件人沒調整過:它那塊的 [還原預設] 不能按
    expect(
      within(audience).getByRole("button", { name: "還原預設" }),
    ).toBeDisabled();
    const schedule = within(dialog).getByRole("region", { name: "提醒時間" });
    await user.click(
      within(schedule).getByRole("button", { name: "還原預設" }),
    );

    await waitFor(() => {
      expect(fake.inputs.reset).toEqual([
        {
          type: "demo.expiry-reminder",
          part: NotificationSettingPart.Schedule,
        },
      ]);
    });
    await waitFor(() => {
      expect(
        within(schedule).getByRole("textbox", { name: "提前天數 1" }),
      ).toHaveValue("30");
    });
    expect(screen.getByRole("dialog")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => {
      expect(
        within(rowOf("到期提醒")).getByText("到期前 30、7 天及當天 09:00"),
      ).toBeVisible();
    });
  });

  it("編輯「截止提醒」(當事人通知):只有提醒時間一塊", async () => {
    const { user } = renderPage({ world: { types: allTypes() } });
    await waitForRows();

    const dialog = await openEdit(user, "截止提醒");
    expect(
      within(dialog).getByRole("heading", { name: "編輯提醒時間:截止提醒" }),
    ).toBeVisible();
    expect(within(dialog).queryByRole("region", { name: "收件人" })).toBeNull();
    expect(
      within(dialog).getByRole("region", { name: "提醒時間" }),
    ).toBeVisible();
  });

  it("編輯「列印代理程式離線」(沒宣告提醒時間):只有收件人一塊", async () => {
    const { user } = renderPage({ world: { types: allTypes() } });
    await waitForRows();

    const dialog = await openEdit(user, "列印代理程式離線");
    expect(
      within(dialog).getByRole("heading", {
        name: "編輯收件人:列印代理程式離線",
      }),
    ).toBeVisible();
    expect(
      within(dialog).getAllByRole("region", { name: "收件人" })[0],
    ).toBeVisible();
    expect(
      within(dialog).queryByRole("region", { name: "提醒時間" }),
    ).toBeNull();
  });

  it("提前天數填 366、填重複的天數 → 擋下並提示範圍,不送出;最多 5 個", async () => {
    const { user, fake } = renderPage({ world: { types: allTypes() } });
    await waitForRows();

    const dialog = await openEdit(user, "到期提醒");
    const schedule = within(dialog).getByRole("region", { name: "提醒時間" });
    const first = within(schedule).getByRole("textbox", { name: "提前天數 1" });
    await user.clear(first);
    await user.type(first, "366");
    const second = within(schedule).getByRole("textbox", {
      name: "提前天數 2",
    });
    await user.clear(second);
    await user.type(second, "0");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));

    expect(within(schedule).getByText("請填 0–365 的整數")).toBeVisible();
    expect(within(schedule).getByText("天數不能重複")).toBeVisible();
    expect(fake.inputs.update).toEqual([]);

    const add = within(schedule).getByRole("button", { name: "+ 加一個" });
    await user.click(add);
    await user.click(add);
    expect(
      within(schedule).getByRole("textbox", { name: "提前天數 5" }),
    ).toBeVisible();
    expect(add).toBeDisabled();
  });

  it("寄送時間的選單只列 15 分鐘一格(沒有 09:10);挑 08:00 儲存送出 08:00", async () => {
    const { user, fake } = renderPage({ world: { types: allTypes() } });
    await waitForRows();

    const dialog = await openEdit(user, "到期提醒");
    await user.click(
      within(dialog).getByRole("button", { name: /choose time/i }),
    );
    // 時、分各一個選單
    const [hours, minutes] = screen.getAllByRole("listbox");
    expect(
      within(minutes)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["00", "15", "30", "45"]);
    await user.click(within(hours).getByRole("option", { name: "8 hours" }));
    await user.click(
      within(minutes).getByRole("option", { name: "0 minutes" }),
    );
    await user.keyboard("{Escape}");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.update).toEqual([
        {
          type: "demo.expiry-reminder",
          schedule: {
            kind: NotificationScheduleKind.DaysBefore,
            daysBefore: [30, 7, 0],
            time: "08:00",
          },
        },
      ]);
    });
  });

  it("寄送時間用鍵盤打成 09:10(不在 15 分鐘格子上)→ 擋下", async () => {
    const { user, fake } = renderPage({ world: { types: allTypes() } });
    await waitForRows();

    const dialog = await openEdit(user, "到期提醒");
    await user.click(
      within(dialog).getByRole("spinbutton", { name: "Minutes" }),
    );
    await user.keyboard("10");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));

    expect(
      within(dialog).getByText("請選 15 分鐘一格的時間(例 09:00、09:15)"),
    ).toBeVisible();
    expect(fake.inputs.update).toEqual([]);
  });

  it("每月第 N 天填 32 → 擋下;填 31 → 送出", async () => {
    const { user, fake } = renderPage({ world: { types: allTypes() } });
    await waitForRows();

    const dialog = await openEdit(user, "月報提醒");
    const day = within(dialog).getByRole("textbox", { name: "每月第幾天" });
    await user.clear(day);
    await user.type(day, "32");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(within(dialog).getByText("請填 1–31 的整數")).toBeVisible();
    expect(fake.inputs.update).toEqual([]);

    await user.clear(day);
    await user.type(day, "31");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(fake.inputs.update).toEqual([
        {
          type: "demo.monthly-report",
          schedule: {
            kind: NotificationScheduleKind.Monthly,
            dayOfMonth: 31,
            time: "09:00",
          },
        },
      ]);
    });
  });

  it("api 擋下 SCHEDULE_INVALID → 標在那一格,不關閉", async () => {
    const { user } = renderPage({
      world: {
        types: allTypes(),
        failures: {
          UpdateNotificationSetting: {
            code: "VALIDATION_FAILED",
            extensions: {
              reason: "SCHEDULE_INVALID",
              type: "demo.expiry-reminder",
              path: "daysBefore[1]",
            },
          },
        },
      },
    });
    await waitForRows();

    const dialog = await openEdit(user, "到期提醒");
    const schedule = within(dialog).getByRole("region", { name: "提醒時間" });
    const first = within(schedule).getByRole("textbox", { name: "提前天數 1" });
    await user.clear(first);
    await user.type(first, "60");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));

    expect(await within(schedule).findByText("超出可以填的範圍")).toBeVisible();
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("api 擋下 SCHEDULE_INVALID(path=time)→ 標在寄送時間欄", async () => {
    const { user } = renderPage({
      world: {
        types: allTypes(),
        failures: {
          UpdateNotificationSetting: {
            code: "VALIDATION_FAILED",
            extensions: {
              reason: "SCHEDULE_INVALID",
              type: "demo.expiry-reminder",
              path: "time",
            },
          },
        },
      },
    });
    await waitForRows();

    const dialog = await openEdit(user, "到期提醒");
    const schedule = within(dialog).getByRole("region", { name: "提醒時間" });
    const first = within(schedule).getByRole("textbox", { name: "提前天數 1" });
    await user.clear(first);
    await user.type(first, "60");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));

    // 錯誤文字取代寄送時間的說明,欄位標紅
    expect(await within(schedule).findByText("超出可以填的範圍")).toBeVisible();
    expect(
      within(schedule)
        .getByRole("group", { name: "寄送時間" })
        .closest(".Mui-error"),
    ).not.toBeNull();
  });

  it("清單的 [還原預設]:確認框寫出收件人與提醒時間的預設,兩塊一起還原", async () => {
    const { user, fake } = renderPage({
      world: { types: allTypes([60, 7, 0]) },
    });
    await waitForRows();

    await user.click(
      within(rowOf("到期提醒")).getByRole("button", { name: "還原預設" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "還原預設:到期提醒",
    });
    expect(
      within(dialog).getByText(
        "提醒時間會改回預設:到期前 30、7 天及當天 09:00。",
      ),
    ).toBeVisible();
    expect(within(dialog).getByText(/收件人會改回預設/)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "還原預設" }));
    await waitFor(() => {
      expect(fake.inputs.reset).toEqual([{ type: "demo.expiry-reminder" }]);
    });
  });
});
