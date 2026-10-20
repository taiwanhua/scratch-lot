import { describe, expect, it } from "@jest/globals";

import { moreToneOf } from "./schedule-roster-views";
import {
  G,
  RULE_CASES,
  Vc,
  at,
  barOf,
  describeSlots,
  early2,
  layoutOf,
  planOf,
  plansOf,
  ruleGroups,
} from "./schedule-roster-views-test-support";

/**
 * 排班表週 / 日檢視的時間軸(規格 14.5「時間軸的人力需求容器」「週檢視排版」):
 * 規則頁 T-01–T-18 每格一個固定輸入 / 預期輸出(排序鍵、條數、收起「+N」、延伸段、×2)。
 * 排班表資料 → `timelineGroupPlansOf` → 底座 `layoutTimeline`(和畫面同一條路,不另寫排版)。
 */
/** 「+N」長條的框色:那一格收起的需求依 `moreToneOf`。 */
const toneAt = (code: string, width: 157 | 125) =>
  moreToneOf(
    layoutOf(plansOf(ruleGroups(code)), width).collapsedPlans.map(
      (plan) => plan.tone,
    ),
  );

describe("時間軸:規則頁 T-01–T-18(排班表資料 → 容器計畫 → 底座排版)", () => {
  for (const rule of RULE_CASES) {
    for (const dayWidth of [157, 125] as const) {
      const device = dayWidth === 157 ? "電腦" : "平板";
      it(`${rule.code} ${rule.title}(${device} ${String(dayWidth)})`, () => {
        const groups =
          dayWidth === 125 && rule.closedOnTablet === true ? [] : rule.groups;
        const { placed, collapsed } = layoutOf(plansOf(groups), dayWidth);
        expect({ placed, collapsed }).toEqual(rule.expected[dayWidth]);
      });
    }
  }

  it("T-01 / T-04:條數 = 執行任務筆數;排序鍵 = [崗位排序, 範本排序]", () => {
    const early = planOf(plansOf([early2()]), "早");
    expect(early.slots).toHaveLength(2);
    expect(early.sortKeys).toEqual([1, 1]);
    const three = planOf(plansOf(ruleGroups("T-04")), "早");
    expect(describeSlots(three.slots)).toEqual([
      "負:王小明",
      "協:李小華",
      "協:張小芳",
    ]);
  });

  it("T-03:依職責、同職責先人後缺額(負責 → 缺負責 → 協同 → 缺協同);容器框色缺負責紅、缺協同橘", () => {
    const plans = plansOf(ruleGroups("T-03"));
    expect(describeSlots(planOf(plans, "早").slots)).toEqual([
      "負:王小明",
      "協:李小華",
      "缺協",
    ]);
    expect(planOf(plans, "早").tone).toBe("warning");
    expect(describeSlots(planOf(plans, "晚").slots)).toEqual([
      "缺負",
      "協:林美麗",
    ]);
    expect(planOf(plans, "晚").tone).toBe("error");
  });

  it("T-05 / T-06 / T-09:「+N」長條的框色依收起的需求(有缺負責紅、有缺協同橘、否則灰)", () => {
    expect(toneAt("T-05", 157)).toBe("neutral");
    expect(toneAt("T-06", 157)).toBe("error");
    expect(toneAt("T-09", 157)).toBe("warning");
    expect(toneAt("T-09", 125)).toBe("error");
  });

  it("T-08:同時開始依崗位排序 → 範本排序;未套用範本(臨)的範本排序排最後", () => {
    const plans = plansOf(ruleGroups("T-08"));
    expect(plans.map((plan) => [plan.demand.short, plan.sortKeys])).toEqual([
      ["盤", [2, 2]],
      ["補", [2, 1]],
      ["櫃", [1, 1]],
    ]);
    const temp = planOf(
      plansOf([G(5, "臨", 13, 18, [Vc("leader")], 5, 99)]),
      "臨",
    );
    expect(temp.sortKeys[1]).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("T-10 / T-11:長條對齊上下班時間,超出容器的那一端延伸出去", () => {
    const early = planOf(plansOf(ruleGroups("T-10")), "早");
    expect(barOf(early, "林美麗")).toMatchObject({
      startAt: at(8),
      extendsBefore: true,
      extendsAfter: false,
    });
    expect(barOf(early, "張小芳")).toMatchObject({
      endAt: at(15.5),
      extendsBefore: false,
      extendsAfter: true,
    });
    const plans = plansOf(ruleGroups("T-11"));
    expect(barOf(planOf(plans, "補"), "張小芳")).toMatchObject({
      entryId: "e-芳",
      extendsBefore: false,
      extendsAfter: true,
    });
    expect(barOf(planOf(plans, "臨"), "張小芳")).toMatchObject({
      entryId: "e-芳",
      extendsBefore: true,
      extendsAfter: false,
    });
  });

  it("T-12:同一人同一天兩段排班各自畫在所屬容器,不延伸", () => {
    const plans = plansOf(ruleGroups("T-12"));
    const morning = barOf(planOf(plans, "早"), "張小芳");
    const evening = barOf(planOf(plans, "晚"), "張小芳");
    expect(morning.entryId).not.toBe(evening.entryId);
    expect([morning.extendsAfter, evening.extendsBefore]).toEqual([
      false,
      false,
    ]);
    expect(evening.startAt).toBe(at(17));
  });

  it("T-13:自動排入只標在自動填進的那一條", () => {
    const plans = plansOf(ruleGroups("T-13"));
    expect(barOf(planOf(plans, "臨"), "張小芳").isAuto).toBe(true);
    expect(barOf(planOf(plans, "晚"), "李小華").isAuto).toBe(false);
  });

  it("T-18:同一筆排班同一段時間填進兩筆 → 兩個容器都畫完整長條並加「×2」;T-11 的重疊時段同樣算兩筆", () => {
    const plans = plansOf(ruleGroups("T-18"));
    for (const short of ["A", "B"]) {
      expect(barOf(planOf(plans, short), "王小明")).toMatchObject({
        entryId: "e-王",
        multiCount: 2,
        extendsBefore: false,
        extendsAfter: false,
      });
    }
    const single = plansOf([early2()]);
    expect(barOf(planOf(single, "早"), "王小明").multiCount).toBe(1);
  });
});
