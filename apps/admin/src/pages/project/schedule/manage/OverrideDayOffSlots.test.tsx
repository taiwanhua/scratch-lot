import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { taipeiAt } from "@/test/msw/project/schedule-day-offs-fixtures";

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
});
