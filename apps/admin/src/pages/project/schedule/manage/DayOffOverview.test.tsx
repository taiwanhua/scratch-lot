import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse } from "msw";

import type { ScheduleDayOffFieldsFragment } from "@repo/graphql";

import { graphqlError } from "@/test/msw/auth-handlers";
import { sampleDayOffs } from "@/test/msw/project/schedule-day-offs-fixtures";
import { api, server } from "@/test/msw/server";

import { renderSchedulePage } from "../schedule-test-support";

const OVERVIEW = "/schedule/manage?tab=day-offs";

/** 夾具:目標月 12 月、這個月 11 月、上個月 10 月(過去的月份)。 */
const dayOffOn = (date: string): ScheduleDayOffFieldsFragment => ({
  id: `d-li-${date}`,
  userId: "u-li",
  name: "李小華",
  date,
  kind: "full-day",
  startTime: null,
  endTime: null,
  note: null,
  isPrimary: true,
  byName: null,
  reason: null,
  reasonNote: null,
});

/**
 * 排班作業 → 畫休總覽(SC-06)與代改(SC-24;規格 14.5「畫休總覽」):
 * [代改] 只做新增;刪除在點日期打開的當天畫休裡,先確認、截止後在確認框選原因。
 * 點日期看得到總覽的人都能開;沒有代改權限是唯讀,過去的月份(早於這個月)沒有 [代改]。
 */
describe("排班作業:畫休總覽與代改", () => {
  it("查詢失敗:顯示載入失敗提示,不是整頁空白", async () => {
    renderSchedulePage({ path: OVERVIEW });
    server.use(
      api.query("ScheduleDayOffOverview", () =>
        HttpResponse.json({ errors: [{ message: "boom" }] }),
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "畫休資料載入失敗,請稍後再試",
    );
  });

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

  it("分店選擇器是可見範圍模式:候選是整棵租戶樹裡看得到的組織", async () => {
    // 假 api 只回 `TenantOrgTree`(可見範圍 / 租戶模式查的);管理範圍模式查的 `OrgTree` 沒有資料
    const { user } = renderSchedulePage({ path: OVERVIEW });
    await user.click(await screen.findByRole("combobox", { name: "分店" }));
    expect(await screen.findByText("A-1 內容組")).toBeInTheDocument();
    expect(screen.getByText("租戶 A")).toBeInTheDocument();
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

  it("點日期 → 當天畫休:每筆旁邊 [刪除],先確認才刪;開放中不用選原因", async () => {
    const { user, dayOffsFake } = renderSchedulePage({ path: OVERVIEW });
    await user.click(
      await screen.findByRole("gridcell", { name: "2026-12-24" }),
    );
    const day = await screen.findByRole("dialog", { name: "12/24(四)" });
    expect(within(day).getByText("畫休(3/2 超過)")).toBeInTheDocument();
    for (const name of ["李小華", "陳大文", "林新人"]) {
      expect(
        within(day).getByRole("button", { name: `刪除 ${name}` }),
      ).toBeInTheDocument();
    }
    // 總覽沒有個人規則:不顯示「涉及的規則」
    expect(within(day).queryByText("涉及的規則")).not.toBeInTheDocument();

    await user.click(
      within(day).getByRole("button", { name: "刪除 王小明 18:00–22:00" }),
    );
    const confirm = await screen.findByRole("dialog", { name: "刪除畫休" });
    expect(
      within(confirm).getByText("刪除 王小明 12/24 18:00–22:00 的時段不可排?"),
    ).toBeInTheDocument();
    expect(
      within(confirm).queryByRole("combobox", { name: /原因/ }),
    ).not.toBeInTheDocument();
    // 還沒按確認:不送
    expect(dayOffsFake.inputs.deleteOnBehalf).toEqual([]);
    await user.click(within(confirm).getByRole("button", { name: "刪除" }));
    await waitFor(() => {
      expect(dayOffsFake.inputs.deleteOnBehalf).toEqual([
        {
          orgId: "org-store",
          id: "d-wang-24",
          reason: null,
          reasonNote: null,
        },
      ]);
    });
    // 確認框關掉,當天畫休跟著更新
    await waitFor(() => {
      expect(
        within(day).queryByText("王小明 18:00–22:00"),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.queryByRole("dialog", { name: "刪除畫休" }),
    ).not.toBeInTheDocument();
  });

  it("截止後刪除:在確認框裡選原因,沒選不送", async () => {
    const { user, dayOffsFake } = renderSchedulePage({
      path: OVERVIEW,
      dayOffs: { windowState: "closed" },
    });
    await user.click(
      await screen.findByRole("gridcell", { name: "2026-12-24" }),
    );
    const day = await screen.findByRole("dialog", { name: "12/24(四)" });
    await user.click(within(day).getByRole("button", { name: "刪除 李小華" }));
    const confirm = await screen.findByRole("dialog", { name: "刪除畫休" });
    expect(
      within(confirm).getByText("刪除 李小華 12/24 的整天畫休?"),
    ).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "刪除" }));
    expect(dayOffsFake.inputs.deleteOnBehalf).toEqual([]);

    await user.click(within(confirm).getByRole("combobox", { name: /原因/ }));
    await user.click(
      await screen.findByRole("option", { name: "員工臨時告知" }),
    );
    await user.click(within(confirm).getByRole("button", { name: "刪除" }));
    await waitFor(() => {
      expect(dayOffsFake.inputs.deleteOnBehalf).toEqual([
        expect.objectContaining({ id: "d-li-24", reason: "staff-late-notice" }),
      ]);
    });
  });

  it("畫面判斷開放中、api 回原因必填:確認框打開原因欄並標在欄位下,不關閉", async () => {
    const { user } = renderSchedulePage({ path: OVERVIEW });
    // renderSchedulePage 會裝預設的假 api,覆寫要在它之後
    server.use(
      api.mutation("DeleteScheduleDayOffOnBehalf", () =>
        graphqlError("VALIDATION_FAILED", "VALIDATION_FAILED", {
          fields: ["reason"],
        }),
      ),
    );
    await user.click(
      await screen.findByRole("gridcell", { name: "2026-12-24" }),
    );
    const day = await screen.findByRole("dialog", { name: "12/24(四)" });
    await user.click(within(day).getByRole("button", { name: "刪除 李小華" }));
    const confirm = await screen.findByRole("dialog", { name: "刪除畫休" });
    expect(
      within(confirm).queryByRole("combobox", { name: /原因/ }),
    ).not.toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "刪除" }));
    expect(
      await within(confirm).findByText("必填,請選擇原因"),
    ).toBeInTheDocument();
    expect(
      within(confirm).getByRole("combobox", { name: /原因/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "刪除畫休" }),
    ).toBeInTheDocument();
  });

  it("當天畫休的 [代改]:打開代改(只有新增),帶入那天", async () => {
    const { user } = renderSchedulePage({ path: OVERVIEW });
    await user.click(
      await screen.findByRole("gridcell", { name: "2026-12-24" }),
    );
    const day = await screen.findByRole("dialog", { name: "12/24(四)" });
    await user.click(within(day).getByRole("button", { name: "代改" }));
    const dialog = await screen.findByRole("dialog", { name: "代改畫休" });
    expect(within(dialog).getByLabelText(/日期/)).toHaveValue("2026-12-24");
    expect(
      within(dialog).queryByRole("button", { name: "刪除" }),
    ).not.toBeInTheDocument();
  });

  it("沒有 edit-day-offs:看不到 [代改];點日期打開唯讀的當天畫休(沒有 [刪除]、[代改])", async () => {
    const { user } = renderSchedulePage({
      path: OVERVIEW,
      omit: ["schedule.manage.edit-day-offs"],
      dayOffs: { canEditOverview: false },
    });
    expect(await screen.findByText("尚未畫休 1 人:張小芳")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "代改" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("gridcell", { name: "2026-12-24" }));
    const day = await screen.findByRole("dialog", { name: "12/24(四)" });
    // 當天所有人的畫休照樣看得到
    expect(within(day).getByText("李小華、陳大文、林新人")).toBeInTheDocument();
    expect(within(day).getByText("王小明 18:00–22:00")).toBeInTheDocument();
    expect(
      within(day).queryByRole("button", { name: /^刪除/ }),
    ).not.toBeInTheDocument();
    expect(
      within(day).queryByRole("button", { name: "代改" }),
    ).not.toBeInTheDocument();
    expect(
      within(day).getByRole("button", { name: "關閉" }),
    ).toBeInTheDocument();
  });

  it("過去的月份(上個月 10 月):上方與當天畫休都沒有 [代改];有代改權限照樣有 [刪除](刪不刪得掉由 api 判斷)", async () => {
    const { user } = renderSchedulePage({
      path: `${OVERVIEW}&month=2026-10`,
      dayOffs: { dayOffs: [...sampleDayOffs, dayOffOn("2026-10-20")] },
    });
    const cell = await screen.findByRole("gridcell", { name: "2026-10-20" });
    // 上方要在打開對話框前看(打開後背景是 aria-hidden,查不到不代表沒有)
    expect(
      screen.queryByRole("button", { name: "代改" }),
    ).not.toBeInTheDocument();
    await user.click(cell);
    const day = await screen.findByRole("dialog", { name: "10/20(二)" });
    expect(
      within(day).getByRole("button", { name: "刪除 李小華" }),
    ).toBeInTheDocument();
    expect(
      within(day).queryByRole("button", { name: "代改" }),
    ).not.toBeInTheDocument();
  });

  it("這個月(11 月)不算過去:上方與當天畫休都有 [代改]", async () => {
    const { user } = renderSchedulePage({
      path: `${OVERVIEW}&month=2026-11`,
      dayOffs: { dayOffs: [...sampleDayOffs, dayOffOn("2026-11-20")] },
    });
    await user.click(
      await screen.findByRole("gridcell", { name: "2026-11-20" }),
    );
    const day = await screen.findByRole("dialog", { name: "11/20(五)" });
    expect(
      within(day).getByRole("button", { name: "代改" }),
    ).toBeInTheDocument();
    await user.click(within(day).getByRole("button", { name: "關閉" }));
    expect(screen.getByRole("button", { name: "代改" })).toBeInTheDocument();
  });

  it("沒有 view-day-offs:看不到「畫休總覽」分頁(排班表、行事曆照常)", async () => {
    renderSchedulePage({
      path: `${OVERVIEW}&month=2026-11`,
      omit: ["schedule.manage.view-day-offs"],
    });
    expect(
      await screen.findByRole("tab", { name: "行事曆" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "排班表" })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "畫休總覽" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/尚未畫休/)).not.toBeInTheDocument();
  });
});
