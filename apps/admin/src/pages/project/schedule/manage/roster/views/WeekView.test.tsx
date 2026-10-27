import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { restoreViewportAfterEach, setupFakeViewport } from "@/test/viewport";

import { renderSchedulePage } from "../../../schedule-test-support";
import { timeValue } from "../roster-test-queries";
import {
  rosterPath,
  searchParam,
  setViewportWidth,
} from "./roster-views-test-support";

setupFakeViewport();
restoreViewportAfterEach();

const WEEK = rosterPath("view=week&date=2026-11-04");

const findTimeline = () => screen.findByRole("group", { name: "週檢視" });

/**
 * 排班表 → 週檢視(SC-44、SC-60、SC-60b、SC-62;規格 14.5 週):容器標題直排簡寫、點擊對照、
 * 「+N」清單浮層、×2、網址參數、跨月多讀、手機 7 天清單。
 * 假 api 見 `test/msw/project/schedule-roster-fixtures.ts`(2026-11 的 1–7 日;7 日補貨 + 臨時加開收進「+1」)。
 */
describe("排班表:週檢視", () => {
  it("容器標題直排簡寫「早 2/2」,滑過 / 無障礙名稱是完整標題;工具列寫那一週", async () => {
    renderSchedulePage({ path: WEEK });
    const timeline = await findTimeline();
    const early = await within(timeline).findByRole("button", {
      name: "早班 · 店內櫃台 08:30–14:30 · 負1/1 協1/1",
    });
    expect(early).toHaveTextContent("早2/2");
    expect(screen.getByText("11/1–11/7")).toBeInTheDocument();
  });

  it("點容器標題 → 人力需求對話框", async () => {
    const { user } = renderSchedulePage({ path: WEEK });
    const timeline = await findTimeline();
    await user.click(
      await within(timeline).findByRole("button", {
        name: "早班 · 店內櫃台 08:30–14:30 · 負1/1 協1/1",
      }),
    );
    expect(
      await screen.findByRole("dialog", { name: "人力需求 · 11/2(一)早班" }),
    ).toBeInTheDocument();
  });

  it("點長條 → 排班對話框", async () => {
    const { user } = renderSchedulePage({ path: WEEK });
    const timeline = await findTimeline();
    await user.click(
      await within(timeline).findByRole("button", {
        name: "林美麗 08:30–14:30",
      }),
    );
    expect(
      await screen.findByRole("dialog", { name: "排班 · 林美麗 11/2(一)" }),
    ).toBeInTheDocument();
  });

  it("點缺額 → 新增排班(帶好那筆人力需求與那筆執行任務)", async () => {
    const { user } = renderSchedulePage({ path: WEEK });
    const timeline = await findTimeline();
    await user.click(
      await within(timeline).findByRole("button", {
        name: "早班 缺負責 1",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "新增排班 · 11/5(四)",
    });
    expect(
      within(dialog).getByRole("combobox", { name: "人力需求" }),
    ).toHaveTextContent("早班 08:30–14:30 · 店內櫃台");
    expect(
      within(dialog).getByRole("combobox", { name: "職責 · 執行任務" }),
    ).toHaveTextContent("負責 · 店內事務與帳目負責");
  });

  it("點空白處 → 新增人力需求(帶入日期與時間)", async () => {
    const { user } = renderSchedulePage({ path: WEEK });
    const timeline = await findTimeline();
    await user.click(
      await within(timeline).findByRole("button", {
        name: "+ 人力需求 2026-11-06 03:00",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "新增人力需求" });
    expect(
      within(dialog).getByRole("group", { name: /日期/ }),
    ).toHaveTextContent("2026-11-06");
    expect(timeValue(dialog, /開始/)).toBe("03:00");
  });

  it("「+N」長條 → 清單浮層(簡稱、時間、人數);點一列 → 人力需求對話框;[看整天] → 日檢視", async () => {
    const { user } = renderSchedulePage({ path: WEEK });
    const timeline = await findTimeline();
    await user.click(
      await within(timeline).findByRole("button", { name: "2026-11-07 +1" }),
    );
    const list = await screen.findByRole("dialog", {
      name: "11/7(六)收起的人力需求",
    });
    await user.click(
      within(list).getByRole("button", { name: "臨 15:00–18:00 負0/1 協1/1" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "人力需求 · 11/7(六)臨" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消" }));

    await user.click(
      within(timeline).getByRole("button", { name: "2026-11-07 +1" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "看整天(日檢視) ›" }),
    );
    await waitFor(() => {
      expect(searchParam("view")).toBe("day");
    });
    expect(searchParam("date")).toBe("2026-11-07");
  });

  it("一筆排班同一段時間填進兩筆人力需求 → 長條加「×2」;沒有 edit 時缺額與空白處不能點", async () => {
    renderSchedulePage({
      path: WEEK,
      omit: ["schedule.manage.edit"],
      roster: { canEdit: false },
    });
    const timeline = await findTimeline();
    expect(
      await within(timeline).findByRole("button", {
        name: "張小芳 13:00–18:00",
      }),
    ).toHaveTextContent("×2");
    expect(
      within(timeline).queryByRole("button", { name: "早班 缺負責 1" }),
    ).not.toBeInTheDocument();
    expect(
      within(timeline).queryByRole("button", {
        name: "+ 人力需求 2026-11-06 03:00",
      }),
    ).not.toBeInTheDocument();
  });

  it("檢視與日期放網址:換下一週 → ?date= 跟著改;重新整理後仍是那一週", async () => {
    const first = renderSchedulePage({ path: WEEK });
    await findTimeline();
    await first.user.click(screen.getByRole("button", { name: "下一週" }));
    await waitFor(() => {
      expect(searchParam("date")).toBe("2026-11-11");
    });
    expect(screen.getByText("11/8–11/14")).toBeInTheDocument();
    const reloadUrl = `${globalThis.location.pathname}${globalThis.location.search}`;
    first.unmount();

    renderSchedulePage({ path: reloadUrl });
    expect(await screen.findByText("11/8–11/14")).toBeInTheDocument();
    expect(searchParam("view")).toBe("week");
  });

  it("跨月的週:排班表查詢多讀那幾天(from / to)", async () => {
    const { rosterFake } = renderSchedulePage({
      path: rosterPath("view=week&date=2026-11-30"),
    });
    expect(await screen.findByText("11/29–12/5")).toBeInTheDocument();
    await waitFor(() => {
      expect(rosterFake.inputs.queries).toContainEqual(
        expect.objectContaining({
          month: "2026-11",
          // 11/29–12/5(含頭尾)= 台北的 `[11/29 00:00, 12/6 00:00)`
          from: "2026-11-28T16:00:00.000Z",
          to: "2026-12-05T16:00:00.000Z",
        }),
      );
    });
  });

  it("手機:7 天清單,每天一列「早 1/2 · 補 1/1 · 晚 1/2」;點一天 → 那天的日檢視", async () => {
    setViewportWidth(390);
    const { user } = renderSchedulePage({ path: WEEK });
    const row = await screen.findByRole("button", {
      name: "11/1(日) 早 1/2 · 補 1/1 · 晚 1/2,看這天的日檢視",
    });
    await user.click(row);
    await waitFor(() => {
      expect(searchParam("view")).toBe("day");
    });
    expect(searchParam("date")).toBe("2026-11-01");
  });
});
