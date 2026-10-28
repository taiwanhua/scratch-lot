import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { tagPaletteColorOf } from "@/lib/project/tag-palettes";

import { renderSchedulePage, typeDate } from "../schedule-test-support";

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

  it("店休整格店休灰(格子仍可點)、特殊日整格鋪色票底色(底座淡化);標籤保留", async () => {
    const { user } = renderSchedulePage({ path: CALENDAR });
    const closedTag = await screen.findByText("店休 · 盤點日");
    const closed = closedTag.closest<HTMLElement>("[data-date]");
    expect(closed).toHaveAttribute("data-date", "2026-11-03");
    expect(closed?.querySelector("[data-closed-layer]")).not.toBeNull();
    expect(closed).not.toHaveAttribute("data-background");
    const special = screen
      .getByText("特殊日 · 店慶")
      .closest<HTMLElement>("[data-date]");
    expect(special).toHaveAttribute("data-date", "2026-11-11");
    expect(special).toHaveAttribute(
      "data-background",
      tagPaletteColorOf("cyan"),
    );
    expect(special?.querySelector("[data-closed-layer]")).toBeNull();
    await user.click(closedTag);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
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
    await user.click(
      await screen.findByRole("button", { name: "+ 新增店休 / 特殊日" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "新增店休 / 特殊日",
    });
    await user.click(within(dialog).getByLabelText("店休"));
    await typeDate(user, dialog, "2026-11-20");
    await user.click(within(dialog).getByRole("button", { name: "新增" }));
    await waitFor(() => {
      expect(calendarFake.inputs).toEqual([
        expect.objectContaining({
          orgId: "org-store",
          // 日期送台北那天 00:00 的時點
          date: new Date("2026-11-20T00:00:00+08:00").toISOString(),
          type: "closed",
          category: null,
        }),
      ]);
    });
  });

  it("[新增] 特殊日:顏色必選(沒選 → 顏色下寫「必填」);面板沒有灰色與「不設定」", async () => {
    const { user, calendarFake } = renderSchedulePage({ path: CALENDAR });
    await user.click(
      await screen.findByRole("button", { name: "+ 新增店休 / 特殊日" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "新增店休 / 特殊日",
    });
    await typeDate(user, dialog, "2026-11-21");
    await user.click(within(dialog).getByRole("combobox", { name: /類別/ }));
    await user.click(await screen.findByRole("option", { name: "活動日" }));
    await user.type(
      within(dialog).getByRole("textbox", { name: /名稱/ }),
      "活動",
    );
    await user.click(within(dialog).getByRole("button", { name: "新增" }));
    expect(
      within(dialog).getByRole("group", { name: "顏色" }),
    ).toHaveAccessibleDescription("必填");
    expect(calendarFake.inputs).toEqual([]);

    await user.click(
      within(dialog).getByRole("button", { name: "特殊日的顏色" }),
    );
    const panel = await screen.findByRole("dialog", { name: "選擇顏色" });
    expect(within(panel).queryByRole("button", { name: "灰" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: "不設定" })).toBeNull();
    await user.click(within(panel).getByRole("button", { name: "藍" }));
    await user.click(within(dialog).getByRole("button", { name: "新增" }));
    await waitFor(() => {
      expect(calendarFake.inputs).toEqual([
        expect.objectContaining({ type: "special", paletteKey: "blue" }),
      ]);
    });
  });

  it("[新增] 店休:那天已經有人力需求 / 排班 → 照樣存,存檔後提醒到排班表刪除(上層設的列出下層各店)", async () => {
    const { user } = renderSchedulePage({
      path: CALENDAR,
      calendar: {
        closedConflicts: [
          {
            orgId: "org-store",
            orgName: "中山店",
            demandCount: 2,
            entryCount: 1,
          },
          {
            orgId: "org-other",
            orgName: "新竹店",
            demandCount: 1,
            entryCount: 0,
          },
        ],
      },
    });
    await user.click(
      await screen.findByRole("button", { name: "+ 新增店休 / 特殊日" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "新增店休 / 特殊日",
    });
    await user.click(within(dialog).getByLabelText("店休"));
    await typeDate(user, dialog, "2026-11-21");
    await user.click(within(dialog).getByRole("button", { name: "新增" }));
    expect(
      await screen.findByText(
        "這天已經有人力需求或排班(中山店 人力需求 2 筆、排班 1 筆;新竹店 人力需求 1 筆、排班 0 筆),店休那天不能排,請到排班表的週 / 日檢視刪除",
      ),
    ).toBeInTheDocument();
  });

  it("沒有 edit-calendar:看不到 [新增]", async () => {
    renderSchedulePage({
      path: CALENDAR,
      omit: ["schedule.manage.edit-calendar"],
      calendar: { canEditCalendar: false },
    });
    expect(await screen.findByText("店休 · 盤點日")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "+ 新增店休 / 特殊日" }),
    ).not.toBeInTheDocument();
  });
});
