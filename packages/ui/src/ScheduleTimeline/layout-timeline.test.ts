import { describe, expect, it } from "@jest/globals";

import { layoutTimeline, timelineGroupWidth } from "./layout-timeline";
import {
  RULE_CASES,
  describeLayout,
  ruleCase,
} from "./layout-timeline-test-support";

describe("layoutTimeline 規則頁案例", () => {
  for (const rule of RULE_CASES) {
    for (const dayWidth of [157, 125] as const) {
      const device = dayWidth === 157 ? "電腦" : "平板";
      it(`${rule.code} ${rule.title}(${device} ${String(dayWidth)})`, () => {
        const groups =
          dayWidth === 125 && rule.tabletGroups
            ? rule.tabletGroups
            : rule.groups;
        expect(describeLayout(groups, dayWidth)).toEqual(
          rule.expected[dayWidth],
        );
      });
    }
  }
});

describe("layoutTimeline 寬度與排序", () => {
  it("容器寬 = 20 + 28 × 條數", () => {
    expect([0, 1, 2, 3, 5].map((slots) => timelineGroupWidth(slots))).toEqual([
      20, 48, 76, 104, 160,
    ]);
  });

  it("欄寬取整數 px:125.9 與 125 排法相同,跨過整數條才改變(T-17 平板若是 120,加開場收起)", () => {
    const groups = ruleCase("T-17").groups;
    expect(describeLayout(groups, 125.9)).toEqual(describeLayout(groups, 125));
    expect(describeLayout(groups, 124)).toEqual(describeLayout(groups, 125));
    expect(describeLayout(groups, 120)).toEqual({
      placed: [
        ["早", 0, 76],
        ["晚", 0, 76],
      ],
      collapsed: ["補"],
    });
  });

  it("開始時間、排序鍵相同時依建立時間,再依 id", () => {
    const base = { start: 0, end: 60, slots: 3, sortKeys: [1] };
    const groups = [
      { ...base, id: "b", createdAt: 1 },
      { ...base, id: "c", createdAt: 0 },
      { ...base, id: "a", createdAt: 1 },
    ];
    const result = layoutTimeline(groups, 157);
    expect(result.placed.map((p) => p.group.id)).toEqual(["c"]);
    expect(result.collapsed.map((group) => group.id)).toEqual(["a", "b"]);
  });

  it("缺少的排序鍵當 0:[1] 與 [1, 0] 平手,交給建立時間", () => {
    const base = { start: 0, end: 60, slots: 3 };
    const groups = [
      { ...base, id: "a", sortKeys: [1, 0], createdAt: 1 },
      { ...base, id: "b", sortKeys: [1], createdAt: 0 },
      { ...base, id: "c", sortKeys: [1, -1], createdAt: 2 },
    ];
    const result = layoutTimeline(groups, 157);
    expect(result.placed.map((p) => p.group.id)).toEqual(["c"]);
    expect(result.collapsed.map((group) => group.id)).toEqual(["b", "a"]);
  });
});
