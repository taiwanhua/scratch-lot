import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { restoreViewportAfterEach, setupFakeViewport } from "@/test/viewport";

import { renderSchedulePage } from "../../../schedule-test-support";
import {
  rosterPath,
  searchParam,
  setViewportWidth,
} from "./roster-views-test-support";

setupFakeViewport();
restoreViewportAfterEach();

const dayPath = (date: string) => rosterPath(`view=day&date=${date}`);
const findTimeline = () => screen.findByRole("group", { name: "日檢視" });

/**
 * 排班表 → 日檢視(SC-45、SC-46;規格 14.5 日):容器標題、點擊對照、選日期月曆、網址參數、
 * 手機卡片清單(人數寫法、加註、缺額)。假 api 見 `test/msw/project/schedule-roster-fixtures.ts`。
 */
describe("排班表:日檢視", () => {
  it("人數寫法:容器標題「班名 · 崗位 時間 · 負責 x/y · 協同 x/y」", async () => {
    renderSchedulePage({ path: dayPath("2026-11-02") });
    const timeline = await findTimeline();
    expect(
      await within(timeline).findByRole("button", {
        name: "早班 · 店內櫃台 08:30–14:30 · 負責 1/1 · 協同 1/1",
      }),
    ).toHaveTextContent("早班 · 店內櫃台 08:30–14:30 · 負責 1/1 · 協同 1/1");
  });

  it("點容器標題 → 人力需求對話框", async () => {
    const { user } = renderSchedulePage({ path: dayPath("2026-11-02") });
    const timeline = await findTimeline();
    await user.click(
      await within(timeline).findByRole("button", {
        name: "早班 · 店內櫃台 08:30–14:30 · 負責 1/1 · 協同 1/1",
      }),
    );
    expect(
      await screen.findByRole("dialog", { name: "人力需求 · 11/2(一)早班" }),
    ).toBeInTheDocument();
  });

  it("點長條 → 排班對話框", async () => {
    const { user } = renderSchedulePage({ path: dayPath("2026-11-02") });
    const timeline = await findTimeline();
    await user.click(
      await within(timeline).findByRole("button", {
        name: "李小華 14:30–22:00",
      }),
    );
    expect(
      await screen.findByRole("dialog", { name: "排班 · 李小華 11/2(一)" }),
    ).toBeInTheDocument();
  });

  it("點缺額 → 新增排班(帶好那筆人力需求與執行任務)", async () => {
    const { user } = renderSchedulePage({ path: dayPath("2026-11-02") });
    const timeline = await findTimeline();
    await user.click(
      await within(timeline).findByRole("button", { name: "晚班 缺協同 1" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "新增排班 · 11/2(一)",
    });
    expect(
      within(dialog).getByRole("combobox", { name: "人力需求" }),
    ).toHaveTextContent("晚班 14:30–22:00 · 店內櫃台");
    expect(
      within(dialog).getByRole("combobox", { name: "職責 · 執行任務" }),
    ).toHaveTextContent("協同 · 店內事務");
  });

  it("點空白處 → 新增人力需求(帶入日期與時間)", async () => {
    const { user } = renderSchedulePage({ path: dayPath("2026-11-02") });
    const timeline = await findTimeline();
    await user.click(
      await within(timeline).findByRole("button", {
        name: "+ 人力需求 2026-11-02 05:00",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "新增人力需求" });
    expect(
      within(dialog).getByRole("group", { name: /日期/ }),
    ).toHaveTextContent("2026-11-02");
    expect(within(dialog).getByLabelText(/開始/)).toHaveValue("05:00");
  });

  it("工具列 ◀ ▶ 換前一天 / 後一天;點日期彈出月曆(缺人的日子有紅點),選一天 → 切到那天;重新整理保持", async () => {
    const first = renderSchedulePage({ path: dayPath("2026-11-02") });
    await findTimeline();
    await first.user.click(screen.getByRole("button", { name: "後一天" }));
    await waitFor(() => {
      expect(searchParam("date")).toBe("2026-11-03");
    });

    await first.user.click(
      screen.getByRole("button", { name: "11/3(二),選日期" }),
    );
    const picker = await screen.findByRole("dialog", { name: "選日期" });
    const fifth = within(picker).getByRole("gridcell", { name: "2026-11-05" });
    expect(
      within(fifth).getByRole("img", { name: "有人力需求還缺人" }),
    ).toBeInTheDocument();
    // 店休不能選
    expect(
      within(picker).getByRole("gridcell", { name: "2026-11-03" }),
    ).toHaveAttribute("aria-disabled", "true");
    await first.user.click(fifth);
    await waitFor(() => {
      expect(searchParam("date")).toBe("2026-11-05");
    });

    const reloadUrl = `${globalThis.location.pathname}${globalThis.location.search}`;
    first.unmount();
    renderSchedulePage({ path: reloadUrl });
    expect(
      await screen.findByRole("button", { name: "11/5(四),選日期" }),
    ).toBeInTheDocument();
    expect(searchParam("view")).toBe("day");
  });

  it("手機:人力需求卡片清單(標題、副標、已填 / 總筆數與缺幾人);上下班和需求不同時加註、×2", async () => {
    setViewportWidth(390);
    renderSchedulePage({ path: dayPath("2026-11-07") });
    expect(await screen.findByText("早班 08:30–14:30")).toBeInTheDocument();
    // 早班、晚班都是負責有人、協同空著
    expect(
      await screen.findAllByText("店內櫃台 · 負責 1/1 · 協同 0/1"),
    ).toHaveLength(2);
    expect(screen.getAllByText("1/2 缺 1").length).toBeGreaterThan(0);
    expect(screen.getByText("補貨 · 協同 1/1")).toBeInTheDocument();
    const chang = screen.getAllByRole("button", {
      name: "張小芳 13:00–18:00",
    });
    expect(chang.at(0)).toHaveTextContent("下班比需求晚 60 分");
    expect(chang.at(0)).toHaveTextContent("×2");
    // 臨時加開 15:00–18:00:張小芳 13:00 就到 → 比需求早 120 分
    expect(chang.at(1)).toHaveTextContent("比需求早 120 分");
  });

  it("手機:點卡片標題 → 人力需求對話框", async () => {
    setViewportWidth(390);
    const { user } = renderSchedulePage({ path: dayPath("2026-11-01") });
    await user.click(await screen.findByText("早班 08:30–14:30"));
    expect(
      await screen.findByRole("dialog", { name: "人力需求 · 11/1(日)早班" }),
    ).toBeInTheDocument();
  });

  it("手機:點人 → 排班對話框", async () => {
    setViewportWidth(390);
    const { user } = renderSchedulePage({ path: dayPath("2026-11-01") });
    await user.click(
      await screen.findByRole("button", { name: "王小明 08:30–14:30" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "排班 · 王小明 11/1(日)" }),
    ).toBeInTheDocument();
  });

  it("手機:點缺額 → 新增排班(帶好那筆人力需求與執行任務)", async () => {
    setViewportWidth(390);
    const { user } = renderSchedulePage({ path: dayPath("2026-11-01") });
    const missing = await screen.findAllByRole("button", {
      name: "缺協同 1",
    });
    await user.click(missing[0]);
    const dialog = await screen.findByRole("dialog", {
      name: "新增排班 · 11/1(日)",
    });
    expect(
      within(dialog).getByRole("combobox", { name: "人力需求" }),
    ).toHaveTextContent("早班 08:30–14:30 · 店內櫃台");
  });

  it("手機:[+ 人力需求] → 新增人力需求(帶入那天)", async () => {
    setViewportWidth(390);
    const { user } = renderSchedulePage({ path: dayPath("2026-11-01") });
    await user.click(await screen.findByRole("button", { name: "+ 人力需求" }));
    const dialog = await screen.findByRole("dialog", { name: "新增人力需求" });
    expect(
      within(dialog).getByRole("group", { name: /日期/ }),
    ).toHaveTextContent("2026-11-01");
  });
});
