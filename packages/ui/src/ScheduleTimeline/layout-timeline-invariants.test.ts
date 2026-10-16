import { describe, expect, it } from "@jest/globals";

import {
  TIMELINE_MORE_WIDTH,
  type TimelineLayoutGroup,
  layoutTimeline,
  timelineGroupWidth,
} from "./layout-timeline";
import { ruleCase } from "./layout-timeline-rule-cases";

/** 固定 seed 的亂數(mulberry32),測試可重現。 */
const seededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

/** 依亂數逐一抽出,得到打亂後的新陣列(不改原陣列)。 */
const shuffled = <T>(items: readonly T[], random: () => number): T[] => {
  const rest = [...items];
  const result: T[] = [];
  while (rest.length > 0) {
    result.push(...rest.splice(Math.floor(random() * rest.length), 1));
  }
  return result;
};

/** 一天內的隨機容器:半小時為單位、1–6 條、排序鍵常撞(讓平手規則真的被用到)。 */
const randomGroups = (random: () => number): TimelineLayoutGroup[] => {
  const count = 1 + Math.floor(random() * 10);
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor(random() * 44) * 30;
    const length = (1 + Math.floor(random() * 16)) * 30;
    return {
      id: `g${String(index)}`,
      start,
      end: Math.min(start + length, 24 * 60),
      slots: Math.floor(random() * 6),
      sortKeys: [Math.floor(random() * 3), Math.floor(random() * 3)],
      createdAt: Math.floor(random() * 3),
    };
  });
};

const byId = (a: string, b: string) => a.localeCompare(b);

const idsOf = (layout: ReturnType<typeof layoutTimeline>) => ({
  placed: layout.placed.map(({ group, x, width }) => [group.id, x, width]),
  collapsed: layout.collapsed.map((group) => group.id),
});

describe("layoutTimeline 決定性與不變式", () => {
  it("同一批輸入打亂順序 100 次,結果都相同", () => {
    const random = seededRandom(20_261_016);
    const groups = ruleCase("T-09").groups;
    for (const dayWidth of [157, 125]) {
      const expected = idsOf(layoutTimeline(groups, dayWidth));
      for (let round = 0; round < 100; round += 1) {
        expect(
          idsOf(layoutTimeline(shuffled(groups, random), dayWidth)),
        ).toEqual(expected);
      }
    }
  });

  it("隨機 500 組資料:容器不重疊、不超出寬度、收起數 = 「+N」數字", () => {
    const random = seededRandom(42);
    for (let round = 0; round < 500; round += 1) {
      const groups = randomGroups(random);
      const dayWidth = 100 + Math.floor(random() * 120);
      const layout = layoutTimeline(groups, dayWidth);
      const { placed, collapsed } = layout;

      // 每個容器恰好出現一次:不是放好就是收起;收起的數量就是「+N」的 N。
      const seen = [
        ...placed.map((p) => p.group.id),
        ...collapsed.map((c) => c.id),
      ];
      expect(seen.toSorted(byId)).toEqual(
        groups.map((group) => group.id).toSorted(byId),
      );
      expect(placed.length + collapsed.length).toBe(groups.length);

      // 不超出寬度:有收起時扣掉「+N」保留寬。
      const available =
        dayWidth - (collapsed.length > 0 ? TIMELINE_MORE_WIDTH : 0);
      for (const p of placed) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.width).toBe(timelineGroupWidth(p.group.slots));
        expect(p.x + p.width).toBeLessThanOrEqual(available);
      }

      // 不重疊:時間重疊的兩個容器,左右範圍不相交。
      for (const [index, a] of placed.entries()) {
        for (const b of placed.slice(index + 1)) {
          const timeOverlap =
            a.group.start < b.group.end && b.group.start < a.group.end;
          if (timeOverlap) {
            expect(a.x + a.width <= b.x || b.x + b.width <= a.x).toBe(true);
          }
        }
      }

      // 決定性:同一組打亂順序結果相同。
      expect(idsOf(layoutTimeline(shuffled(groups, random), dayWidth))).toEqual(
        idsOf(layout),
      );
    }
  });
});
