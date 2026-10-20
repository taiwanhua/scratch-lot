import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { renderSchedulePage } from "../schedule-test-support";

const OVERVIEW = "/schedule/manage?tab=day-offs";

/**
 * 排班作業 → 畫休總覽(SC-06)與代改(SC-24;規格 14.5「畫休總覽」)。
 */
describe("排班作業:畫休總覽與代改", () => {
  it("月曆顯示誰整天畫休、誰時段不可排;頂部開放期間與尚未畫休的人", async () => {
    renderSchedulePage({ path: OVERVIEW });
    expect(
      await screen.findByText("開放中:11/15–11/25,剩 6 天"),
    ).toBeInTheDocument();
    expect(screen.getByText("尚未畫休 1 人:張小芳")).toBeInTheDocument();
    expect(screen.getByText("畫休 李小華、陳大文、林新人")).toBeInTheDocument();
    expect(screen.getByText("不可排 王小明 18:00–22:00")).toBeInTheDocument();
    // 24 號:林新人的主要分店不是這家,同日人數只算 3 人
    expect(screen.getByText("3/2")).toBeInTheDocument();
  });

  it("[尚未畫休] 篩選列出還沒畫任何一天、主要分店是這家的人", async () => {
    const { user } = renderSchedulePage({ path: OVERVIEW });
    await user.click(await screen.findByRole("button", { name: "尚未畫休 1" }));
    expect(await screen.findByText("張小芳")).toBeInTheDocument();
    // 支援人員(主要分店不是這家)沒畫休也不算
    expect(screen.queryByText("趙支援")).not.toBeInTheDocument();
    expect(
      screen.queryByText("畫休 李小華、陳大文、林新人"),
    ).not.toBeInTheDocument();
  });

  it("[代改] 截止後:沒選原因不送;選了原因送出,帶分店與原因", async () => {
    const { user, dayOffsFake } = renderSchedulePage({
      path: OVERVIEW,
      dayOffs: { windowState: "closed" },
    });
    await user.click(await screen.findByRole("button", { name: "代改" }));
    const dialog = await screen.findByRole("dialog", { name: "代改畫休" });
    await user.click(within(dialog).getByRole("combobox", { name: /人員/ }));
    await user.click(await screen.findByRole("option", { name: "張小芳" }));
    await user.type(within(dialog).getByLabelText(/日期/), "2026-12-18");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(dayOffsFake.inputs.addOnBehalf).toEqual([]);

    await user.click(within(dialog).getByRole("combobox", { name: /原因/ }));
    await user.click(
      await screen.findByRole("option", { name: "員工臨時告知" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(dayOffsFake.inputs.addOnBehalf).toEqual([
        expect.objectContaining({
          orgId: "org-store",
          userId: "u-zhang",
          date: "2026-12-18",
          kind: "full-day",
          reason: "staff-late-notice",
        }),
      ]);
    });
  });

  it("選「其他」要填說明", async () => {
    const { user, dayOffsFake } = renderSchedulePage({
      path: OVERVIEW,
      dayOffs: { windowState: "closed" },
    });
    await user.click(await screen.findByRole("button", { name: "代改" }));
    const dialog = await screen.findByRole("dialog", { name: "代改畫休" });
    await user.click(within(dialog).getByRole("combobox", { name: /人員/ }));
    await user.click(await screen.findByRole("option", { name: "張小芳" }));
    await user.type(within(dialog).getByLabelText(/日期/), "2026-12-18");
    await user.click(within(dialog).getByRole("combobox", { name: /原因/ }));
    await user.click(await screen.findByRole("option", { name: "其他" }));
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(dayOffsFake.inputs.addOnBehalf).toEqual([]);
    await user.type(within(dialog).getByLabelText(/說明/), "家裡有事");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(dayOffsFake.inputs.addOnBehalf).toEqual([
        expect.objectContaining({ reason: "other", reasonNote: "家裡有事" }),
      ]);
    });
  });

  it("沒有 edit-day-offs:看不到 [代改]", async () => {
    renderSchedulePage({
      path: OVERVIEW,
      omit: ["schedule.manage.edit-day-offs"],
      dayOffs: { canEditOverview: false },
    });
    expect(await screen.findByText("尚未畫休 1 人:張小芳")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "代改" }),
    ).not.toBeInTheDocument();
  });

  it("沒有 view-day-offs:看不到「畫休總覽」分頁(只剩行事曆)", async () => {
    renderSchedulePage({
      path: `${OVERVIEW}&month=2026-11`,
      omit: ["schedule.manage.view-day-offs"],
    });
    expect(await screen.findByText("店休 · 盤點日")).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "畫休總覽" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/尚未畫休/)).not.toBeInTheDocument();
  });
});
