import { layoutTimeline } from "@repo/ui/schedule-timeline";

import {
  type TimelineDemandLike,
  type TimelineEntryLike,
  type TimelineGroupPlan,
  type TimelineSlotPlan,
  timelineGroupPlansOf,
  wallClockMs,
} from "./schedule-roster-views";

/**
 * 時間軸規則頁(Figma 401:805)T-01–T-18 的固定輸入 / 預期輸出,換成排班表資料的形狀
 * (人力需求 + 排班 + 填進紀錄)。測試資料(不是測試檔):`schedule-roster-timeline.test.ts` 用。
 */

const TZ = "Asia/Taipei";
const DAY = "2026-11-10";

// ---- 規則頁(Figma 401:805)T-01–T-18 的輸入寫法(同 `docs/tmp/figma-base-round/project/r6-timeline-cases.js`) ----

/** 小時(可帶 .5)→ 台北時間的 ISO。 */
export const at = (hours: number): string => {
  const hh = String(Math.floor(hours)).padStart(2, "0");
  const mm = hours % 1 === 0 ? "00" : "30";
  return new Date(`${DAY}T${hh}:${mm}:00+08:00`).toISOString();
};

interface PersonItem {
  person: string;
  lead: boolean;
  /** 上班(提早 / 只上一段);預設 = 容器開始 */
  start?: number;
  /** 下班(延後 / 只上一段);預設 = 容器結束 */
  end?: number;
  auto?: boolean;
  /** 同一筆排班的代號(一人掛兩筆);預設每個容器各自一筆 */
  entry?: string;
}
type Item = PersonItem | { vacancy: "leader" | "helper" };

export const P = (
  person: string,
  lead = false,
  extra: Omit<PersonItem, "person" | "lead"> = {},
): Item => ({ person, lead, ...extra });
export const Vc = (role: "leader" | "helper"): Item => ({ vacancy: role });

export interface CaseGroup {
  id: number;
  short: string;
  start: number;
  end: number;
  items: Item[];
  /** 崗位排序 */
  ord?: number;
  /** 範本排序;99 = 未套用範本(臨) */
  tmpl?: number;
}

export const G = (
  id: number,
  short: string,
  start: number,
  end: number,
  items: Item[],
  ord = 1,
  tmpl = 1,
): CaseGroup => ({ id, short, start, end, items, ord, tmpl });

export interface Expected {
  /** 「簡稱 左–右」 */
  placed: string[];
  collapsed: string[];
}

export interface RuleCase {
  code: string;
  title: string;
  groups: CaseGroup[];
  expected: { 157: Expected; 125: Expected };
  /** 平板欄是店休(不排容器) */
  closedOnTablet?: boolean;
}

const same = (expected: Expected) => ({ 157: expected, 125: expected });
export const early2 = () =>
  G(1, "早", 8.5, 14.5, [P("王小明", true), P("李小華")]);
const late2 = () => G(2, "晚", 14.5, 22, [P("陳大文", true), P("林美麗")]);
const five = () =>
  G(1, "早", 8.5, 14.5, [
    P("陳大文", true),
    P("李小華"),
    P("王小明"),
    P("黃志明"),
    P("吳佳玲"),
  ]);

export const RULE_CASES: RuleCase[] = [
  {
    code: "T-01",
    title: "剛好放下",
    groups: [early2()],
    expected: same({ placed: ["早 0–76"], collapsed: [] }),
  },
  {
    code: "T-02",
    title: "共用位置(早接晚)",
    groups: [early2(), late2()],
    expected: same({ placed: ["早 0–76", "晚 0–76"], collapsed: [] }),
  },
  {
    code: "T-03",
    title: "缺額佔條",
    groups: [
      G(1, "早", 8.5, 14.5, [P("王小明", true), P("李小華"), Vc("helper")]),
      G(2, "晚", 14.5, 22, [Vc("leader"), P("林美麗")]),
    ],
    expected: same({ placed: ["早 0–104", "晚 0–76"], collapsed: [] }),
  },
  {
    code: "T-04",
    title: "加一筆協同任務(要多一人)",
    groups: [
      G(1, "早", 8.5, 14.5, [P("王小明", true), P("李小華"), P("張小芳")]),
    ],
    expected: same({ placed: ["早 0–104"], collapsed: [] }),
  },
  {
    code: "T-05",
    title: "單筆太寬收起",
    groups: [five()],
    expected: same({ placed: [], collapsed: ["早"] }),
  },
  {
    code: "T-06",
    title: "中途放不下收起",
    groups: [
      early2(),
      G(3, "補", 13, 17, [P("張小芳", false, { end: 18 })], 2),
      G(4, "臨", 13, 18, [Vc("leader"), P("黃志明")], 3, 99),
      late2(),
    ],
    expected: {
      157: { placed: ["早 0–76", "補 76–124", "晚 0–76"], collapsed: ["臨"] },
      125: { placed: ["早 0–76", "晚 0–76"], collapsed: ["補", "臨"] },
    },
  },
  {
    code: "T-07",
    title: "後續也放不下",
    groups: [
      five(),
      G(3, "補", 13, 17, [P("周家豪")], 2),
      G(2, "晚", 14.5, 22, [P("林美麗", true), P("張小芳")]),
    ],
    expected: {
      157: { placed: ["補 0–48", "晚 48–124"], collapsed: ["早"] },
      125: { placed: ["補 0–48"], collapsed: ["早", "晚"] },
    },
  },
  {
    code: "T-08",
    title: "同時開始的平手排序(輸入順序打亂)",
    groups: [
      G(3, "盤", 9, 12, [P("林美麗", true), P("黃志明")], 2, 2),
      G(2, "補", 9, 13, [P("張小芳")], 2, 1),
      G(1, "櫃", 9, 13, [P("王小明", true), P("李小華")], 1, 1),
    ],
    expected: {
      157: { placed: ["櫃 0–76", "補 76–124"], collapsed: ["盤"] },
      125: { placed: ["櫃 0–76"], collapsed: ["補", "盤"] },
    },
  },
  {
    code: "T-09",
    title: "同一天 7 筆需求",
    groups: [
      G(1, "櫃", 9, 17, [P("王小明", true), P("李小華")], 1),
      G(2, "補", 9, 13, [P("張小芳")], 2),
      G(3, "盤", 10, 12, [P("林美麗")], 3),
      G(4, "促", 11, 15, [P("陳大文"), Vc("helper")], 4),
      G(5, "臨", 13, 18, [Vc("leader")], 5, 99),
      G(6, "清", 14, 15, [P("黃志明")], 6),
      G(7, "教", 15, 17, [P("吳佳玲")], 7),
    ],
    expected: {
      157: {
        placed: ["櫃 0–76", "補 76–124", "臨 76–124"],
        collapsed: ["盤", "促", "清", "教"],
      },
      125: {
        placed: ["櫃 0–76"],
        collapsed: ["補", "盤", "促", "臨", "清", "教"],
      },
    },
  },
  {
    code: "T-10",
    title: "早到晚走:長條延伸出容器(排版不變)",
    groups: [
      G(1, "早", 8.5, 14.5, [
        P("林美麗", true, { start: 8 }),
        P("張小芳", false, { end: 15.5 }),
      ]),
    ],
    expected: same({ placed: ["早 0–76"], collapsed: [] }),
  },
  {
    code: "T-11",
    title: "一筆排班掛兩筆需求",
    groups: [
      G(1, "補", 13, 17, [P("張小芳", false, { end: 18, entry: "芳" })], 2),
      G(
        2,
        "臨",
        15,
        18,
        [P("張小芳", false, { start: 13, entry: "芳" })],
        3,
        99,
      ),
    ],
    expected: same({ placed: ["補 0–48", "臨 48–96"], collapsed: [] }),
  },
  {
    code: "T-12",
    title: "同一天兩段排班",
    groups: [
      G(1, "早", 8.5, 14.5, [P("王小明", true), P("張小芳")]),
      G(2, "晚", 14.5, 22, [
        P("林美麗", true),
        P("張小芳", false, { start: 17 }),
      ]),
    ],
    expected: same({ placed: ["早 0–76", "晚 0–76"], collapsed: [] }),
  },
  {
    code: "T-13",
    title: "休息、負責人、自動排入、臨",
    groups: [
      G(1, "晚", 14.5, 22, [P("李小華", true)]),
      G(2, "臨", 13, 18, [P("張小芳", false, { auto: true })], 3, 99),
    ],
    expected: same({ placed: ["臨 0–48", "晚 48–96"], collapsed: [] }),
  },
  {
    code: "T-14",
    title: "特殊日(電腦)/ 店休不排容器(平板)",
    groups: [G(1, "早", 8.5, 14.5, [P("王小明", true), Vc("helper")])],
    closedOnTablet: true,
    expected: {
      157: { placed: ["早 0–76"], collapsed: [] },
      125: { placed: [], collapsed: [] },
    },
  },
  {
    code: "T-15",
    title: "滑過 / 已選取(排版不變)",
    groups: [early2()],
    expected: same({ placed: ["早 0–76"], collapsed: [] }),
  },
  {
    code: "T-16",
    title: "滑過留白處",
    groups: [
      five(),
      G(3, "補", 13, 17, [P("周家豪")], 2),
      G(2, "晚", 14.5, 22, [P("林美麗", true), P("張小芳")]),
    ],
    expected: {
      157: { placed: ["補 0–48", "晚 48–124"], collapsed: ["早"] },
      125: { placed: ["補 0–48"], collapsed: ["早", "晚"] },
    },
  },
  {
    code: "T-17",
    title: "邊界:124 寬剛好放進平板 125",
    groups: [
      G(1, "早", 8.5, 14.5, [P("陳大文", true), P("李小華")]),
      G(3, "補", 13, 17, [P("張小芳")], 2),
      G(2, "晚", 14.5, 22, [P("林美麗", true), P("王小明")]),
    ],
    expected: same({
      placed: ["早 0–76", "補 76–124", "晚 0–76"],
      collapsed: [],
    }),
  },
  {
    code: "T-18",
    title: "一人顧兩個收銀點(同一筆排班、兩筆職責)",
    groups: [
      G(1, "A", 14, 22, [P("王小明", true, { entry: "王" })]),
      G(2, "B", 14, 22, [P("王小明", true, { entry: "王" })], 2),
    ],
    expected: same({ placed: ["A 0–48", "B 48–96"], collapsed: [] }),
  },
];

const PEOPLE = [
  "王小明",
  "李小華",
  "陳大文",
  "林美麗",
  "張小芳",
  "黃志明",
  "吳佳玲",
  "周家豪",
];

export type CaseDemand = TimelineDemandLike & { short: string };

/** 規則頁的一格 → 排班表資料的形狀(人力需求 + 排班 + 填進紀錄)。 */
const rosterOf = (
  groups: readonly CaseGroup[],
): { demands: CaseDemand[]; entries: TimelineEntryLike[] } => {
  const entries = new Map<string, TimelineEntryLike>();
  const demands = groups.map((group): CaseDemand => {
    const demandId = `g${String(group.id)}`;
    const tasks = group.items.map((item, index) => {
      const taskId = `${demandId}-t${String(index + 1)}`;
      if ("vacancy" in item) {
        return { taskId, role: item.vacancy, entryId: null, userId: null };
      }
      const role = item.lead ? "leader" : "helper";
      const key = item.entry ?? `${item.person}-${demandId}`;
      const entryId = `e-${key}`;
      const existing = entries.get(entryId);
      const assignment = {
        demandId,
        taskId,
        role,
        source: item.auto === true ? "auto" : "manual",
      };
      entries.set(entryId, {
        id: entryId,
        userId: item.person,
        date: DAY,
        startAt: at(item.start ?? group.start),
        endAt: at(item.end ?? group.end),
        breakMinutes: 30,
        assignments: [...(existing?.assignments ?? []), assignment],
      });
      return { taskId, role, entryId, userId: item.person };
    });
    return {
      id: demandId,
      short: group.short,
      date: DAY,
      startAt: at(group.start),
      endAt: at(group.end),
      positionKey: `pos-${String(group.ord ?? 1)}`,
      templateId: group.tmpl === 99 ? null : `tpl-${String(group.tmpl ?? 1)}`,
      createdAt: "2026-10-01T00:00:00.000Z",
      tasks,
    };
  });
  return { demands, entries: [...entries.values()] };
};

const ORDERS = {
  positionOrder: (key: string) => Number(key.replace("pos-", "")),
  templateOrder: (id: string | null | undefined) =>
    id === null || id === undefined ? null : Number(id.replace("tpl-", "")),
  personOrder: (userId: string) => PEOPLE.indexOf(userId),
};

export const plansOf = (groups: readonly CaseGroup[]) => {
  const { demands, entries } = rosterOf(groups);
  return timelineGroupPlansOf(demands, entries, ORDERS);
};

/** 週檢視一天欄的排版(和畫面同一條路:計畫 → 底座 `layoutTimeline`)。 */
export const layoutOf = (
  plans: readonly TimelineGroupPlan<CaseDemand>[],
  dayWidth: number,
) => {
  const result = layoutTimeline(
    plans.map((plan) => ({
      id: plan.demand.id,
      plan,
      start: wallClockMs(plan.demand.startAt, TZ),
      end: wallClockMs(plan.demand.endAt, TZ),
      slots: plan.slots.length,
      sortKeys: plan.sortKeys,
      createdAt: plan.createdAt,
    })),
    dayWidth,
  );
  return {
    placed: result.placed.map(
      ({ group, x, width }) =>
        `${group.plan.demand.short} ${String(x)}–${String(x + width)}`,
    ),
    collapsed: result.collapsed.map((group) => group.plan.demand.short),
    collapsedPlans: result.collapsed.map((group) => group.plan),
  };
};

/** 一個容器的條,寫成「負:王小明」「缺協同」。 */
export const describeSlots = (slots: readonly TimelineSlotPlan[]): string[] =>
  slots.map((slot) => {
    const role = slot.role === "leader" ? "負" : "協";
    return slot.kind === "bar" ? `${role}:${slot.userId}` : `缺${role}`;
  });

export const planOf = (
  plans: readonly TimelineGroupPlan<CaseDemand>[],
  short: string,
) => {
  const found = plans.find((plan) => plan.demand.short === short);
  if (found === undefined) {
    throw new Error(`沒有 ${short}`);
  }
  return found;
};

export const barOf = (
  plan: TimelineGroupPlan<CaseDemand>,
  person: string,
): Extract<TimelineSlotPlan, { kind: "bar" }> => {
  const found = plan.slots.find(
    (slot) => slot.kind === "bar" && slot.userId === person,
  );
  if (found?.kind !== "bar") {
    throw new Error(`沒有 ${person}`);
  }
  return found;
};

/** 依編號取規則頁那一格的輸入。 */
export const ruleGroups = (code: string): CaseGroup[] => {
  const found = RULE_CASES.find((rule) => rule.code === code);
  if (found === undefined) {
    throw new Error(`沒有規則頁案例 ${code}`);
  }
  return found.groups;
};
