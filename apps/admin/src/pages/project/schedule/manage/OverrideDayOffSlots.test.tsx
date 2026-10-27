import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { graphqlError } from "@/test/msw/auth-handlers";
import {
  DAY_OFF_STAFF,
  dayOff,
  sampleDayOffs,
  taipeiAt,
} from "@/test/msw/project/schedule-day-offs-fixtures";
import { api, server } from "@/test/msw/server";

import {
  renderSchedulePage,
  typeDate,
  typeTime,
} from "../schedule-test-support";

const OVERVIEW = "/schedule/manage?tab=day-offs";

/**
 * 代改畫休(SC-24;規格 14.5「畫休總覽」)的時段不可排:先選人與日期,上方唯讀列出那人那天已登記的段落;
 * 一次可以多段;整天判斷連同已登記的段落(夾具:王小明 12/24 已有 18:00–22:00,李小華 12/24 整天畫休)。
 */
describe("排班作業:代改畫休的時段不可排", () => {
  it("[代改] 選好人與日期後,上方唯讀列出那人那天已登記的時段不可排;換人、換日期就更新", async () => {
    const { user } = renderSchedulePage({ path: OVERVIEW });
    await user.click(await screen.findByRole("button", { name: "代改" }));
    const dialog = await screen.findByRole("dialog", { name: "代改畫休" });
    await user.click(within(dialog).getByRole("combobox", { name: /人員/ }));
    await user.click(await screen.findByRole("option", { name: "王小明" }));
    // 還沒選日期:不列
    expect(
      within(dialog).queryByText("這天已登記的時段不可排"),
    ).not.toBeInTheDocument();
    await typeDate(user, dialog, "2026-12-24");
    expect(
      within(dialog).getByText("這天已登記的時段不可排"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("已登記 18:00–22:00")).toBeInTheDocument();

    // 換日期:那天沒有 → 整塊不顯示
    await typeDate(user, dialog, "2026-12-23");
    expect(
      within(dialog).queryByText("已登記 18:00–22:00"),
    ).not.toBeInTheDocument();

    // 換回那天、換人:李小華那天是整天畫休,沒有時段不可排 → 不顯示
    await typeDate(user, dialog, "2026-12-24");
    expect(within(dialog).getByText("已登記 18:00–22:00")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("combobox", { name: /人員/ }));
    await user.click(await screen.findByRole("option", { name: "李小華" }));
    expect(
      within(dialog).queryByText("這天已登記的時段不可排"),
    ).not.toBeInTheDocument();
  });

  it("[代改] 一次可以多段;連同那天已登記的段落剛好補滿整天 → 提示改選整天畫休,不能儲存", async () => {
    const { user, dayOffsFake } = renderSchedulePage({ path: OVERVIEW });
    await user.click(await screen.findByRole("button", { name: "代改" }));
    const dialog = await screen.findByRole("dialog", { name: "代改畫休" });
    await user.click(within(dialog).getByRole("combobox", { name: /人員/ }));
    await user.click(await screen.findByRole("option", { name: "王小明" }));
    // 王小明 12/24 已有 18:00–22:00
    await typeDate(user, dialog, "2026-12-24");
    await user.click(within(dialog).getByLabelText("時段不可排"));
    await user.click(
      within(dialog).getByRole("button", { name: "+ 再加一段" }),
    );
    const starts = within(dialog).getAllByRole("group", { name: /開始/ });
    const ends = within(dialog).getAllByRole("group", { name: /結束/ });
    await typeTime(user, starts[0], "00:00");
    await typeTime(user, ends[0], "18:00");
    await typeTime(user, starts[1], "22:00");
    await typeTime(user, ends[1], "00:00");
    const slots = within(dialog).getByRole("group", { name: "時段" });
    expect(slots).toHaveAccessibleDescription("整天請改選整天畫休");
    const save = within(dialog).getByRole("button", { name: "儲存" });
    expect(save).toBeDisabled();

    // 第二段只到 23:00 就不是整天:兩段一次送出
    await typeTime(user, ends[1], "23:00");
    expect(slots).not.toHaveAccessibleDescription("整天請改選整天畫休");
    await user.click(save);
    await waitFor(() => {
      expect(dayOffsFake.inputs.addOnBehalf).toEqual([
        expect.objectContaining({
          userId: "u-wang",
          kind: "time-range",
          slots: [
            {
              startAt: taipeiAt("2026-12-24"),
              endAt: taipeiAt("2026-12-24", "18:00"),
            },
            {
              startAt: taipeiAt("2026-12-24", "22:00"),
              endAt: taipeiAt("2026-12-24", "23:00"),
            },
          ],
        }),
      ]);
    });
  });

  it("[代改] 日期不限月份:選到總覽以外的月份 → 載入那個月(載入中顯示載入、不能儲存),再列出已登記的段落、照樣判斷整天", async () => {
    const wang = DAY_OFF_STAFF.find((person) => person.userId === "u-wang");
    if (wang === undefined) {
      throw new Error("夾具缺王小明");
    }
    const { user } = renderSchedulePage({
      path: OVERVIEW,
      dayOffs: {
        dayOffs: [
          ...sampleDayOffs,
          // 總覽顯示 12 月;王小明 1/5 已有 09:00–12:00
          dayOff("d-wang-0105", wang, "2027-01-05", ["09:00", "12:00"]),
        ],
      },
    });
    // 1 月的總覽先卡住,看得到載入狀態
    const gate = Promise.withResolvers<boolean>();
    // 沒有回應 = 交給原本的假 api 回那個月
    server.use(
      api.query("ScheduleDayOffOverview", async ({ variables }) => {
        const { input } = variables as { input?: { from?: string } };
        if (input?.from === taipeiAt("2027-01-01")) {
          await gate.promise;
        }
      }),
    );
    await user.click(await screen.findByRole("button", { name: "代改" }));
    const dialog = await screen.findByRole("dialog", { name: "代改畫休" });
    await user.click(within(dialog).getByRole("combobox", { name: /人員/ }));
    await user.click(await screen.findByRole("option", { name: "王小明" }));
    await typeDate(user, dialog, "2027-01-05");
    expect(
      await within(dialog).findByText("載入這天已登記的時段…"),
    ).toBeInTheDocument();
    const save = within(dialog).getByRole("button", { name: "儲存" });
    expect(save).toBeDisabled();

    gate.resolve(true);
    expect(
      await within(dialog).findByText("已登記 09:00–12:00"),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText("載入這天已登記的時段…"),
    ).not.toBeInTheDocument();
    expect(save).toBeEnabled();

    // 連同 1/5 已登記的 09:00–12:00 補滿整天 → 前端就擋下
    await user.click(within(dialog).getByLabelText("時段不可排"));
    await user.click(
      within(dialog).getByRole("button", { name: "+ 再加一段" }),
    );
    const starts = within(dialog).getAllByRole("group", { name: /開始/ });
    const ends = within(dialog).getAllByRole("group", { name: /結束/ });
    await typeTime(user, starts[0], "00:00");
    await typeTime(user, ends[0], "09:00");
    await typeTime(user, starts[1], "12:00");
    await typeTime(user, ends[1], "00:00");
    expect(
      within(dialog).getByRole("group", { name: "時段" }),
    ).toHaveAccessibleDescription("整天請改選整天畫休");
    expect(save).toBeDisabled();

    // 換回總覽的月份:用總覽已載入的資料(12/24 已有 18:00–22:00)
    await typeDate(user, dialog, "2026-12-24");
    expect(within(dialog).getByText("已登記 18:00–22:00")).toBeInTheDocument();
  });

  it("[代改] 選到已截止月份的日期 → 原因改成必填(看那個月的開放期間);換回開放中的總覽月份就不用", async () => {
    // 總覽 12 月開放中;11 月已截止
    const { user, dayOffsFake } = renderSchedulePage({ path: OVERVIEW });
    await user.click(await screen.findByRole("button", { name: "代改" }));
    const dialog = await screen.findByRole("dialog", { name: "代改畫休" });
    await user.click(within(dialog).getByRole("combobox", { name: /人員/ }));
    await user.click(await screen.findByRole("option", { name: "張小芳" }));
    await typeDate(user, dialog, "2026-11-10");
    const save = within(dialog).getByRole("button", { name: "儲存" });
    await waitFor(() => {
      expect(save).toBeEnabled();
    });
    await user.click(save);
    expect(
      await within(dialog).findByText("必填,請選擇原因"),
    ).toBeInTheDocument();
    expect(dayOffsFake.inputs.addOnBehalf).toEqual([]);

    await typeDate(user, dialog, "2026-12-18");
    await user.click(save);
    await waitFor(() => {
      expect(dayOffsFake.inputs.addOnBehalf).toEqual([
        expect.objectContaining({
          userId: "u-zhang",
          date: taipeiAt("2026-12-18"),
          reason: null,
        }),
      ]);
    });
  });

  it("[代改] 別的月份載入失敗 → 寫一句「載入失敗、儲存時仍會檢查」,照樣可以儲存(由 api 擋)", async () => {
    const { user, dayOffsFake } = renderSchedulePage({ path: OVERVIEW });
    server.use(
      api.query("ScheduleDayOffOverview", ({ variables }) => {
        const { input } = variables as { input?: { from?: string } };
        return input?.from === taipeiAt("2027-01-01")
          ? graphqlError("VALIDATION_FAILED")
          : undefined;
      }),
    );
    await user.click(await screen.findByRole("button", { name: "代改" }));
    const dialog = await screen.findByRole("dialog", { name: "代改畫休" });
    await user.click(within(dialog).getByRole("combobox", { name: /人員/ }));
    await user.click(await screen.findByRole("option", { name: "張小芳" }));
    await typeDate(user, dialog, "2027-01-05");
    expect(
      await within(dialog).findByText(
        "這天已登記的時段載入失敗;儲存時仍會檢查。",
      ),
    ).toBeInTheDocument();
    const save = within(dialog).getByRole("button", { name: "儲存" });
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => {
      expect(dayOffsFake.inputs.addOnBehalf).toEqual([
        expect.objectContaining({
          userId: "u-zhang",
          date: taipeiAt("2027-01-05"),
        }),
      ]);
    });
  });
});
