import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  restoreViewportAfterEach,
  setViewportWidth,
  setupFakeViewport,
} from "@/test/viewport";

import { renderSchedulePage } from "../../../schedule-test-support";
import { rosterPath, searchParam } from "./roster-views-test-support";

setupFakeViewport();
restoreViewportAfterEach();

const MONTH = rosterPath("view=month");

/** 月曆的一天(格子的無障礙名稱)。 */
const dayCell = (title: string) =>
  screen.findByRole("gridcell", {
    name: `${title}(點了切到那天的日檢視)`,
  });

/**
 * 排班表 → 月檢視(SC-43;規格 14.5 月):人數寫法(電腦 / 平板 / 手機)與點擊對照。
 * 假 api 見 `test/msw/project/schedule-roster-fixtures.ts`(2026-11 的 1–7 日,3 日店休)。
 */
describe("排班表:月檢視", () => {
  it("人數寫法(電腦):簡稱 + 時間,下一行「負x/y 協x/y」;只有一種職責時同一行", async () => {
    renderSchedulePage({ path: MONTH });
    const second = await dayCell("11/2(一)");
    expect(
      await within(second).findByRole("button", {
        name: "店內櫃台 人力需求 早 08:30–14:30 負1/1 協1/1",
      }),
    ).toBeInTheDocument();
    const first = await dayCell("11/1(日)");
    expect(
      within(first).getByRole("button", {
        name: "補貨 人力需求 補 13:00–17:00 協1/1",
      }),
    ).toBeInTheDocument();
    // 店休那天停用、寫「店休」,不放標籤
    const closed = await dayCell("11/3(二)");
    expect(closed).toHaveAttribute("aria-disabled", "true");
    expect(within(closed).getByText("店休")).toBeInTheDocument();
  });

  it("人數寫法(平板):有負責人且已滿只寫「早 2/2」;未滿、只有協同照電腦寫完整兩行", async () => {
    setViewportWidth(1024);
    renderSchedulePage({ path: MONTH });
    const second = await dayCell("11/2(一)");
    expect(
      await within(second).findByRole("button", {
        name: "店內櫃台 人力需求 早 2/2",
      }),
    ).toBeInTheDocument();
    expect(
      within(second).getByRole("button", {
        name: "店內櫃台 人力需求 晚 14:30–22:00 負1/1 協0/1",
      }),
    ).toBeInTheDocument();
    expect(
      within(second).getByRole("button", {
        name: "補貨 人力需求 補 13:00–17:00 協0/1",
      }),
    ).toBeInTheDocument();
  });

  it("人數寫法(手機):每筆人力需求一顆實心點、不寫人數;點日期 → 那天的日檢視", async () => {
    setViewportWidth(390);
    const { user } = renderSchedulePage({ path: MONTH });
    const first = await dayCell("11/1(日)");
    await waitFor(() => {
      // 11/1:早、晚、補貨三筆
      expect(first.querySelectorAll("[data-demand-dot]")).toHaveLength(3);
    });
    expect(within(first).queryByRole("button")).not.toBeInTheDocument();
    await user.click(first);
    await waitFor(() => {
      expect(searchParam("view")).toBe("day");
    });
    expect(searchParam("date")).toBe("2026-11-01");
  });

  it("點標籤 → 人力需求對話框(編輯那一筆)", async () => {
    const { user } = renderSchedulePage({ path: MONTH });
    const second = await dayCell("11/2(一)");
    await user.click(
      await within(second).findByRole("button", {
        name: "店內櫃台 人力需求 早 08:30–14:30 負1/1 協1/1",
      }),
    );
    expect(
      await screen.findByRole("dialog", { name: "人力需求 · 11/2(一)早班" }),
    ).toBeInTheDocument();
  });

  it("點空白處 → 新增人力需求(帶入那天的日期)", async () => {
    const { user } = renderSchedulePage({ path: MONTH });
    const fifth = await dayCell("11/5(四)");
    await user.click(
      await within(fifth).findByRole("button", {
        name: "新增 11/5 的人力需求",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "新增人力需求" });
    expect(
      within(dialog).getByRole("group", { name: /日期/ }),
    ).toHaveTextContent("2026-11-05");
  });

  it("點日期數字 → 切到那天的日檢視(網址帶 view=day 與日期)", async () => {
    const { user } = renderSchedulePage({ path: MONTH });
    const fourth = await dayCell("11/4(三)");
    await user.click(within(fourth).getByText("4"));
    await waitFor(() => {
      expect(searchParam("view")).toBe("day");
    });
    expect(searchParam("date")).toBe("2026-11-04");
    expect(
      await screen.findByRole("group", { name: "日檢視" }),
    ).toBeInTheDocument();
  });

  it("沒有 edit:空白處不能點(沒有新增按鈕),點標籤仍打開唯讀的人力需求對話框", async () => {
    const { user } = renderSchedulePage({
      path: MONTH,
      omit: ["schedule.manage.edit"],
      roster: { canEdit: false },
    });
    const second = await dayCell("11/2(一)");
    const tag = await within(second).findByRole("button", {
      name: "店內櫃台 人力需求 早 08:30–14:30 負1/1 協1/1",
    });
    expect(
      within(second).queryByRole("button", { name: "新增 11/2 的人力需求" }),
    ).not.toBeInTheDocument();
    await user.click(tag);
    const dialog = await screen.findByRole("dialog", {
      name: "人力需求 · 11/2(一)早班",
    });
    expect(
      within(dialog).getByRole("button", { name: "關閉" }),
    ).toBeInTheDocument();
  });
});
