import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import { restoreViewportAfterEach, setupFakeViewport } from "@/test/viewport";

import { setViewportWidth } from "../manage/roster/views/roster-views-test-support";
import { renderSchedulePage } from "../schedule-test-support";

setupFakeViewport();
restoreViewportAfterEach();

const SCHEDULE = "/schedule/my?tab=schedule";

/** 圖例項目的文字(i18n `admin.schedule.legend.items.*`)。 */
const ITEM = {
  leader: "負責人(名字或範本簡稱套綠底)",
  temp: "沒有套用範本的班",
  punchTimes: "上班 / 下班打卡",
  breakMinutes: "休息(分鐘)",
  dayOff: "畫休(斜線)",
  missingDot: "缺卡",
  changedDot: "有異動",
  special: "特殊日(行事曆設定的顏色)",
} as const;

const legendTexts = async (): Promise<string[]> => {
  const legend = await screen.findByLabelText("圖例");
  return Object.values(ITEM).filter(
    (text) => within(legend).queryByText(text) !== null,
  );
};

const dayCell = (selector: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(selector);
  if (found === null) {
    throw new Error(`找不到 ${selector}`);
  }
  return found;
};

/**
 * 我的班表的圖例和畫面一致(規格 14.6;同 14.5「圖例」):各檢視只列畫得出來的記號;畫休一律灰色斜線底。
 * 夾具:11/6、11/22 畫休;11/2 缺卡;11/8、11/12 有異動;11/11 特殊日「店慶」。
 */
describe("我的班表 → 班表:圖例和畫面一致", () => {
  it("月曆(電腦):畫休整格斜線底;圖例 = 簡稱、臨、打卡時間、畫休、缺卡、有異動、特殊日", async () => {
    setViewportWidth(1440);
    renderSchedulePage({ path: `${SCHEDULE}&month=2026-11` });
    await screen.findAllByText("缺卡", { exact: false });
    const cell = dayCell('[data-my-day="2026-11-06"]');
    expect(within(cell).getByText("畫休")).toBeInTheDocument();
    expect(cell.querySelector("[data-day-off-hatch]")).not.toBeNull();
    expect(await legendTexts()).toEqual([
      ITEM.leader,
      ITEM.temp,
      ITEM.punchTimes,
      ITEM.dayOff,
      ITEM.missingDot,
      ITEM.changedDot,
      ITEM.special,
    ]);
  });

  it("月曆(手機):只放簡稱 → 圖例沒有打卡時間", async () => {
    setViewportWidth(390);
    renderSchedulePage({ path: `${SCHEDULE}&month=2026-11&view=calendar` });
    expect(await screen.findAllByText("畫休")).toHaveLength(2);
    const texts = await legendTexts();
    expect(texts).not.toContain(ITEM.punchTimes);
    expect(texts).toContain(ITEM.dayOff);
  });

  it("條列:畫休斜線底、休息「☕ 30」;圖例只列臨、打卡時間、休息、畫休(沒有點和特殊日底色)", async () => {
    setViewportWidth(1440);
    renderSchedulePage({ path: `${SCHEDULE}&month=2026-11&view=list` });
    await screen.findAllByText("☕ 30");
    const row = dayCell('[data-my-list-day="2026-11-06"]');
    expect(within(row).getByText("畫休")).toBeInTheDocument();
    expect(row.querySelector("[data-day-off-hatch]")).not.toBeNull();
    expect(await legendTexts()).toEqual([
      ITEM.temp,
      ITEM.punchTimes,
      ITEM.breakMinutes,
      ITEM.dayOff,
    ]);
  });
});
