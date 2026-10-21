import { describe, expect, it } from "@jest/globals";

import {
  listDatesOf,
  missingKeyOf,
  newChangeIdsOf,
  punchTimeOf,
  timeRangeOf,
} from "./schedule-my";

const TAIPEI = "Asia/Taipei";

describe("我的班表的純函式(規格 14.6)", () => {
  it("時間文字用租戶時區", () => {
    expect(
      timeRangeOf(
        {
          startAt: "2026-11-05T00:30:00.000Z",
          endAt: "2026-11-05T06:30:00.000Z",
        },
        TAIPEI,
      ),
    ).toBe("08:30–14:30");
    expect(punchTimeOf("2026-11-05T00:24:00.000Z", TAIPEI)).toBe("08:24");
    expect(punchTimeOf(null, TAIPEI)).toBeNull();
  });

  it.each([
    [["in", "out"], "missingBoth"],
    [["in"], "missingIn"],
    [["out"], "missingOut"],
    [[], null],
  ])("缺卡寫法 %j → %s", (missing, expected) => {
    expect(missingKeyOf(missing)).toBe(expected);
  });

  it("「新」的異動:晚於上次打開;第一次打開全部都是新的", () => {
    const changes = [
      { id: "a", createdAt: "2026-11-04T10:00:00.000Z" },
      { id: "b", createdAt: "2026-11-05T10:00:00.000Z" },
    ];
    expect(newChangeIdsOf(changes, "2026-11-05T00:00:00.000Z")).toEqual(
      new Set(["b"]),
    );
    expect(newChangeIdsOf(changes, null)).toEqual(new Set(["a", "b"]));
  });

  it("條列的日子:班、畫休、店休與今天(在這個月時),依日期", () => {
    expect(
      listDatesOf({
        month: "2026-11",
        today: "2026-11-05",
        entryDates: ["2026-11-08", "2026-11-02"],
        dayOffDates: ["2026-11-06"],
        closedDates: ["2026-11-03", "2026-12-01"],
      }),
    ).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-05",
      "2026-11-06",
      "2026-11-08",
    ]);
    expect(
      listDatesOf({
        month: "2026-12",
        today: "2026-11-05",
        entryDates: [],
        dayOffDates: [],
        closedDates: [],
      }),
    ).toEqual([]);
  });
});
