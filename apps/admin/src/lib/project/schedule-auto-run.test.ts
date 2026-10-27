import { describe, expect, it } from "@jest/globals";

import {
  datesOfPreset,
  movedItem,
  templateHeadcountOf,
  weekTemplateSummary,
} from "./schedule-auto-run";

// 2026-11-01 是星期日
const NOVEMBER_WEEK = ["2026-11-01", "2026-11-02", "2026-11-04", "2026-11-07"];

describe("套用到的日子快選", () => {
  it("全選 / 全不選 / 平日 / 週末(只在可以選的日子裡挑)", () => {
    expect(datesOfPreset(NOVEMBER_WEEK, "all")).toEqual(NOVEMBER_WEEK);
    expect(datesOfPreset(NOVEMBER_WEEK, "none")).toEqual([]);
    expect(datesOfPreset(NOVEMBER_WEEK, "weekdays")).toEqual([
      "2026-11-02",
      "2026-11-04",
    ]);
    expect(datesOfPreset(NOVEMBER_WEEK, "weekends")).toEqual([
      "2026-11-01",
      "2026-11-07",
    ]);
  });
});

describe("範本與週範本的說明", () => {
  it("人數寫「負責 + 協同」", () => {
    expect(templateHeadcountOf([{ role: "leader" }, { role: "helper" }])).toBe(
      "1+1",
    );
    expect(templateHeadcountOf([{ role: "helper" }])).toBe("0+1");
  });

  it("週範本:一到日依序,相同的相鄰幾天併一段;3 天以上寫範圍", () => {
    const labels = ["日", "一", "二", "三", "四", "五", "六"];
    const names: Record<string, string> = { a: "早", p: "晚", r: "補" };
    const days = [
      ["a"],
      ["a", "p"],
      ["a", "p"],
      ["a", "p", "r"],
      ["a", "p"],
      ["a", "p"],
      ["a"],
    ];
    expect(weekTemplateSummary(days, (id) => names[id] ?? id, labels)).toBe(
      "一、二 早、晚;三 早、晚、補;四、五 早、晚;六、日 早",
    );
    expect(
      weekTemplateSummary(
        [[], ["a"], ["a"], ["a"], ["a"], ["a"], []],
        (id) => names[id] ?? id,
        labels,
      ),
    ).toBe("一–五 早");
  });
});

describe("條件排序", () => {
  it("搬一項;超出範圍不動", () => {
    expect(movedItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(movedItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(movedItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });
});
