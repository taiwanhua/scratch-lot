import { describe, expect, it } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { HttpResponse } from "msw";

import type { ScheduleDayOffFieldsFragment } from "@repo/graphql";

import {
  DAY_OFF_ME,
  sampleDayOffs,
} from "@/test/msw/project/schedule-day-offs-fixtures";
import { api, server } from "@/test/msw/server";

import { renderSchedulePage } from "../schedule-test-support";

const DAY_OFFS = "/schedule/my?tab=day-offs";

/** 過去月份(11 月)的一筆:我 11/20 整天畫休。 */
const NOVEMBER_DAY_OFF: ScheduleDayOffFieldsFragment = {
  id: "d-me-nov-20",
  userId: DAY_OFF_ME.userId,
  name: DAY_OFF_ME.name,
  date: "2026-11-20",
  kind: "full-day",
  startTime: null,
  endTime: null,
  note: null,
  isPrimary: true,
  byName: null,
  reason: null,
  reasonNote: null,
};

/**
 * 我的班表 → 我的畫休(SC-02 / SC-23 / SC-41a/b / SC-42;規格 14.6):
 * 目標月 12 月、開放期間 11/15–11/25;我畫了 7、14、21 號與 10 號早上;24 號主要分店 3 人畫休。
 */
describe("我的畫休", () => {
  it("查詢失敗:顯示載入失敗提示,不是整頁空白", async () => {
    renderSchedulePage({ path: DAY_OFFS });
    server.use(
      api.query("MyScheduleDayOffs", () =>
        HttpResponse.json({ errors: [{ message: "boom" }] }),
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "畫休資料載入失敗,請稍後再試",
    );
  });

  it("開放期間內:頂部期間與統計列、違規清單、[登記畫休]", async () => {
    renderSchedulePage({ path: DAY_OFFS });
    expect(
      await screen.findByText("登記 12 月的畫休 · 開放中 11/15–11/25(剩 6 天)"),
    ).toBeInTheDocument();
    expect(screen.getByText("已畫 4 天 · 上限 8 · 下限 4")).toBeInTheDocument();
    expect(screen.getByText("違反規則(2)")).toBeInTheDocument();
    expect(
      screen.getByText("12/24 同日最多畫休 2 人:已有 3 人"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("12/13–12/16 最多連續休假 3 天:這段連續休 4 天"),
    ).toBeInTheDocument();
    // 格子 + 圖例
    expect(screen.getAllByText("09:00–13:00 不可排")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "登記畫休" }),
    ).toBeInTheDocument();
  });

  it("[登記畫休] 時段不可排可以一次登記兩段", async () => {
    const { user, dayOffsFake } = renderSchedulePage({ path: DAY_OFFS });
    await user.click(await screen.findByRole("button", { name: "登記畫休" }));
    const dialog = await screen.findByRole("dialog", { name: "登記畫休" });
    await user.type(within(dialog).getByLabelText(/日期/), "2026-12-03");
    await user.click(within(dialog).getByLabelText("時段不可排"));
    await user.click(
      within(dialog).getByRole("button", { name: "+ 再加一段" }),
    );
    const starts = within(dialog).getAllByLabelText(/開始/);
    const ends = within(dialog).getAllByLabelText(/結束/);
    await user.type(starts[0], "09:00");
    await user.type(ends[0], "12:00");
    await user.type(starts[1], "18:00");
    await user.type(ends[1], "22:00");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(dayOffsFake.inputs.addMine).toEqual([
        {
          date: "2026-12-03",
          kind: "time-range",
          slots: [
            { startTime: "09:00", endTime: "12:00" },
            { startTime: "18:00", endTime: "22:00" },
          ],
        },
      ]);
    });
  });

  it("違反限制:不存,對話框列出原因", async () => {
    const { user } = renderSchedulePage({
      path: DAY_OFFS,
      dayOffs: { blockedDates: ["2026-12-24"] },
    });
    await user.click(await screen.findByRole("button", { name: "登記畫休" }));
    const dialog = await screen.findByRole("dialog", { name: "登記畫休" });
    await user.type(within(dialog).getByLabelText(/日期/), "2026-12-24");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(
      await within(dialog).findByText("違反限制,不能儲存:"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("12/24 同日最多畫休 2 人:已有 3 人"),
    ).toBeInTheDocument();
  });

  it("ⓘ 當天詳細:誰畫休、時段不可排、涉及的規則", async () => {
    const { user } = renderSchedulePage({ path: DAY_OFFS });
    await user.click(
      await screen.findByRole("button", { name: "看 12/24 誰畫休" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "12/24(四)" });
    expect(within(dialog).getByText("畫休(3/2 超過)")).toBeInTheDocument();
    expect(within(dialog).getByText("李小華、陳大文")).toBeInTheDocument();
    expect(within(dialog).getByText("王小明 18:00–22:00")).toBeInTheDocument();
    expect(within(dialog).getByText("同日最多畫休人數 2")).toBeInTheDocument();
  });

  it("開放期間外:提示不能自己修改,有代改權限的人看到「到畫休總覽代改」;沒有 [登記畫休]", async () => {
    renderSchedulePage({
      path: DAY_OFFS,
      dayOffs: { windowState: "closed" },
    });
    expect(
      await screen.findByText(
        "畫休登記期間(11/15–11/25)已結束,不能自己修改。要調整請聯絡店長或排班負責人。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "到畫休總覽代改" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "登記畫休" }),
    ).not.toBeInTheDocument();
  });

  it("開放期間外、沒有代改權限:沒有代改連結", async () => {
    renderSchedulePage({
      path: DAY_OFFS,
      dayOffs: { windowState: "closed", canOverride: false },
    });
    expect(await screen.findByText(/已結束,不能自己修改/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "到畫休總覽代改" }),
    ).not.toBeInTheDocument();
  });

  it("過去的月份:提示「只能查看」,沒有「到畫休總覽代改」(有代改權限也一樣)", async () => {
    renderSchedulePage({
      path: `${DAY_OFFS}&month=2026-11`,
      dayOffs: { windowState: "closed", canOverride: true },
    });
    expect(await screen.findByText("2026 年 11 月")).toBeInTheDocument();
    expect(
      screen.getByText("這是過去月份的紀錄,只能查看。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/不能自己修改/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "到畫休總覽代改" }),
    ).not.toBeInTheDocument();
  });

  it("◀ 換到過去的月份:那個月的畫休、唯讀(沒有 [登記畫休]);▶ 只到目標月", async () => {
    const { user } = renderSchedulePage({
      path: DAY_OFFS,
      dayOffs: { dayOffs: [...sampleDayOffs, NOVEMBER_DAY_OFF] },
    });
    expect(await screen.findByText("2026 年 12 月")).toBeInTheDocument();
    // 目標月:不能再往後
    expect(screen.getByRole("button", { name: "下一個月" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "上一個月" }));
    expect(await screen.findByText("2026 年 11 月")).toBeInTheDocument();
    expect(
      screen.getByText("11 月的畫休 · 登記期間 10/15–10/25 已結束"),
    ).toBeInTheDocument();
    expect(screen.getByText(/^已畫 1 天/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "登記畫休" }),
    ).not.toBeInTheDocument();
    // 點日期不開登記;ⓘ 照樣看得到當天詳細
    fireEvent.click(screen.getByRole("gridcell", { name: "2026-11-20" }));
    expect(
      screen.queryByRole("dialog", { name: /登記畫休/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "看 11/20 誰畫休" }));
    expect(
      await screen.findByRole("dialog", { name: "11/20(五)" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "關閉" }));

    await user.click(screen.getByRole("button", { name: "下一個月" }));
    expect(await screen.findByText("2026 年 12 月")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "登記畫休" }),
    ).toBeInTheDocument();
  });

  it("網址 ?month=:更早的月份照樣看(往前不限);晚於目標月不採用,顯示目標月", async () => {
    renderSchedulePage({ path: `${DAY_OFFS}&month=2025-03` });
    expect(await screen.findByText("2025 年 3 月")).toBeInTheDocument();
    expect(screen.getByText(/^已畫 0 天/)).toBeInTheDocument();
    cleanup();

    renderSchedulePage({ path: `${DAY_OFFS}&month=2027-03` });
    expect(await screen.findByText("2026 年 12 月")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "登記畫休" }),
    ).toBeInTheDocument();
  });

  it("沒有 schedule.my.edit-day-offs:看不到「我的畫休」分頁(只剩班表分頁)", async () => {
    renderSchedulePage({
      path: DAY_OFFS,
      omit: ["schedule.my.edit-day-offs"],
    });
    expect(
      await screen.findByText("今天 11/5(四)· 08:30–14:30"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "我的畫休" }),
    ).not.toBeInTheDocument();
  });
});

describe("班表管理頁殼的高度(STYLE-08)", () => {
  it("分頁殼的卡片不釘高:內容少時撐滿、多時跟著長(flex-grow 1、flex-shrink 0),交給 <main> 捲", async () => {
    renderSchedulePage({ path: DAY_OFFS });
    // 殼的頁籤列也是 tablist:取包在卡片裡的那一個(頁內分頁)
    const tablists = await screen.findAllByRole("tablist");
    const card = tablists
      .map((tabs) => tabs.closest<HTMLElement>(".MuiCard-root"))
      .find((found): found is HTMLElement => found !== null);
    if (card === undefined) {
      throw new Error("找不到分頁殼的卡片");
    }
    const style = globalThis.getComputedStyle(card);
    expect(style.flexGrow).toBe("1");
    expect(style.flexShrink).toBe("0");
  });
});
