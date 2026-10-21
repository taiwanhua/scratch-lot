import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { renderSchedulePage } from "../schedule-test-support";

const CALENDAR = "/schedule/manage?tab=calendar&month=2026-11";

/**
 * 排班作業 → 行事曆(SC-07 / SC-28;規格 14.5「行事曆」):上層設的店休往下沿用,本店設的特殊日以本店為準。
 */
describe("排班作業:行事曆", () => {
  it("月曆標出沿用上層的店休與本店的特殊日", async () => {
    renderSchedulePage({ path: CALENDAR });
    expect(await screen.findByText("店休 · 盤點日")).toBeInTheDocument();
    expect(screen.getByText("特殊日 · 店慶")).toBeInTheDocument();
  });

  it("點上層設的那天:唯讀說明,沒有 [儲存]", async () => {
    const { user } = renderSchedulePage({ path: CALENDAR });
    await user.click(await screen.findByText("店休 · 盤點日"));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("這天沿用「租戶 A」的設定,只有「租戶 A」能改。"),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "儲存" }),
    ).not.toBeInTheDocument();
  });

  it("[新增] 店休:送出這家店那一層", async () => {
    const { user, calendarFake } = renderSchedulePage({ path: CALENDAR });
    await user.click(await screen.findByRole("button", { name: "新增" }));
    const dialog = await screen.findByRole("dialog", {
      name: "新增店休 / 特殊日",
    });
    await user.click(within(dialog).getByLabelText("店休"));
    await user.type(within(dialog).getByLabelText(/日期/), "2026-11-20");
    await user.click(within(dialog).getByRole("button", { name: "新增" }));
    await waitFor(() => {
      expect(calendarFake.inputs).toEqual([
        expect.objectContaining({
          orgId: "org-store",
          date: "2026-11-20",
          type: "closed",
          category: null,
        }),
      ]);
    });
  });

  it("沒有 edit-calendar:看不到 [新增]", async () => {
    renderSchedulePage({
      path: CALENDAR,
      omit: ["schedule.manage.edit-calendar"],
      calendar: { canEditCalendar: false },
    });
    expect(await screen.findByText("店休 · 盤點日")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "新增" }),
    ).not.toBeInTheDocument();
  });
});
