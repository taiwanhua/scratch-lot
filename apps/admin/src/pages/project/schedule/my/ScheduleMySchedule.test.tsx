import { afterEach, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  fastUser,
  findButton,
  findDialog,
  findLabelled,
  queryButton,
} from "../manage/roster/roster-test-queries";
import { renderSchedulePage } from "../schedule-test-support";

const SCHEDULE = "/schedule/my?tab=schedule";

/**
 * 我的班表 → 班表分頁(SC-01 / SC-25 / SC-32 / SC-38 / SC-39 / SC-40;規格 14.6):
 * 今天 2026-11-05(四);11/2 缺下班卡、11/4 晚班還沒打下班卡;11/8、11/12 有異動(api 夾具)。
 * 整頁 DOM 大(月曆),查法沿用排班表的便宜查法(`roster-test-queries.ts`)。
 */
describe("我的班表 → 班表", () => {
  afterEach(() => {
    globalThis.localStorage.clear();
  });

  it("打卡區:今天的班 + 昨天未打下班卡的班;打卡不完整提醒列出缺卡的班", async () => {
    renderSchedulePage({ path: SCHEDULE });
    expect(
      await screen.findByText("今天 11/5(四)· 08:30–14:30"),
    ).toBeInTheDocument();
    expect(screen.getByText("昨天 11/4(三)未打下班卡")).toBeInTheDocument();
    expect(screen.getByText("最近 7 天有 2 班打卡不完整")).toBeInTheDocument();
    expect(screen.getAllByText("缺下班卡").length).toBeGreaterThanOrEqual(2);
    // 補打卡申請還沒做:不顯示 [申請補卡]
    expect(queryButton("申請補卡")).toBeNull();
    // 今天有班:「沒有排班」收合成一行
    expect(screen.getByText("沒有排到班但臨時來上班?")).toBeInTheDocument();
  });

  it("在今天的卡片打上班卡:送出那一筆排班,卡片顯示已打卡", async () => {
    const user = fastUser();
    const { myFake } = renderSchedulePage({ path: SCHEDULE });
    const card = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        '[data-punch-card="my-entry-2026-11-05"]',
      );
      if (found === null) {
        throw new Error("找不到今天的卡片");
      }
      return found;
    });
    await user.click(within(card).getByText("打上班卡"));
    await waitFor(() => {
      expect(myFake.punches).toEqual([
        { type: "in", entryId: "my-entry-2026-11-05" },
      ]);
    });
    expect(await within(card).findByText("上班 10:00 已打卡")).toBeVisible();
  });

  it("沒有 schedule.my.punch:卡片與提醒照常顯示,沒有打卡按鈕、沒有「沒有排班」", async () => {
    renderSchedulePage({
      path: SCHEDULE,
      omit: ["schedule.my.punch"],
      my: { canPunch: false },
    });
    expect(
      await screen.findByText("今天 11/5(四)· 08:30–14:30"),
    ).toBeInTheDocument();
    // 昨天未打下班卡的卡片照常顯示(含上班打卡紀錄),只是沒有按鈕
    expect(screen.getByText("昨天 11/4(三)未打下班卡")).toBeInTheDocument();
    expect(screen.getByText("上班 14:24 已打卡")).toBeInTheDocument();
    expect(screen.getByText("最近 7 天有 2 班打卡不完整")).toBeInTheDocument();
    expect(queryButton("打上班卡")).toBeNull();
    expect(queryButton("打下班卡")).toBeNull();
    expect(screen.queryByText("沒有排班")).toBeNull();
  });

  it("沒有排班:今天沒班時展開,打的卡不帶排班", async () => {
    const user = fastUser();
    const { myFake } = renderSchedulePage({
      path: SCHEDULE,
      my: { entries: [] },
    });
    expect(await screen.findByText("分店:A-2 台北分店")).toBeVisible();
    const block = document.querySelector<HTMLElement>("[data-no-schedule]");
    if (block === null) {
      throw new Error("找不到「沒有排班」");
    }
    await user.click(within(block).getByText("打上班卡"));
    await waitFor(() => {
      expect(myFake.punches).toEqual([{ type: "in", entryId: null }]);
    });
    expect(
      await within(block).findByText("你在 10:00 打了上班卡,還沒打下班卡"),
    ).toBeVisible();
  });

  it("最近異動:展開列出原本 → 現在與原因,第一次打開都標「新」", async () => {
    const user = fastUser();
    renderSchedulePage({ path: SCHEDULE });
    expect(await screen.findByText("你的班表有 2 項異動")).toBeInTheDocument();
    await user.click(await findButton("展開"));
    expect(
      await screen.findByText("A-2 台北分店 14:30–22:00 → 08:30–14:30"),
    ).toBeVisible();
    expect(screen.getByText("原因:換班")).toBeVisible();
    expect(screen.getByText("原因:其他 · 臨時請假 · 補人")).toBeVisible();
    expect(screen.getAllByText("新")).toHaveLength(2);
  });

  it("月曆:缺卡紅點、有異動橘點;點一天 → 當天詳情說明缺了哪張卡", async () => {
    const user = fastUser();
    renderSchedulePage({ path: `${SCHEDULE}&view=calendar` });
    const nov2 = await findLabelled("2026-11-02");
    expect(within(nov2).getByLabelText("缺卡")).toBeInTheDocument();
    expect(
      within(await findLabelled("2026-11-08")).getByLabelText("有異動"),
    ).toBeInTheDocument();
    // 特殊日整格淡藍底(底座 MonthCalendar 的 tone)並寫名稱
    const special = await findLabelled("2026-11-11");
    expect(special).toHaveAttribute("data-tone", "special");
    expect(within(special).getByText("店慶")).toBeInTheDocument();
    await user.click(nov2);
    const dialog = await findDialog("11/2(一)當天詳情");
    expect(within(dialog).getByText("07:56")).toBeInTheDocument();
    expect(within(dialog).getByText("缺下班卡")).toBeInTheDocument();
    expect(
      within(dialog).getByText("缺下班卡沒有打。可以申請補卡,由店長審核。"),
    ).toBeInTheDocument();
  });

  it("條列:依日期列出班、店休、畫休,今天標「今天」", async () => {
    renderSchedulePage({ path: `${SCHEDULE}&view=list` });
    expect(await screen.findByText("11/5(四)今天")).toBeInTheDocument();
    const closed = document.querySelector('[data-my-list-day="2026-11-03"]');
    expect(closed?.textContent).toContain("店休");
    const dayOff = document.querySelector('[data-my-list-day="2026-11-06"]');
    expect(dayOff?.textContent).toContain("畫休");
    const support = document.querySelector('[data-my-list-day="2026-11-10"]');
    expect(support?.textContent).toContain("B 分店");
  });

  it("換月:網址記月份,沒有已發布的班就是空的", async () => {
    const user = fastUser();
    renderSchedulePage({ path: `${SCHEDULE}&view=list` });
    await user.click(await findLabelled("下個月"));
    expect(await screen.findByText("2026 年 12 月")).toBeInTheDocument();
    expect(await screen.findByText("這個月沒有班")).toBeInTheDocument();
  });
});
