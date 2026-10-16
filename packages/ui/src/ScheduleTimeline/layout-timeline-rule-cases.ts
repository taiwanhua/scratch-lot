import { type TimelineLayoutGroup, layoutTimeline } from "./layout-timeline";

/**
 * 規則頁「班表時間軸 · 各種情況」(Figma 401:805)每一格 = 一個固定輸入 / 預期輸出。
 * 測試資料(不是測試檔):`layout-timeline.test.ts` 與 `layout-timeline-invariants.test.ts` 共用。
 * 輸入與預期照 `docs/tmp/figma-base-round/project/r6-timeline-cases.js` 的 CASES(畫圖用同一套資料)。
 */
export interface CaseGroup extends TimelineLayoutGroup {
  /** 規則頁上的簡稱(早、晚、補…),預期輸出用它描述。 */
  label: string;
}

/** 規則頁的資料寫法:id、簡稱、開始 / 結束(小時)、條數、崗位排序、範本排序(預設 1;「臨」= 99)。 */
const g = (
  id: number,
  label: string,
  startHour: number,
  endHour: number,
  slots: number,
  ord = 1,
  tmpl = 1,
): CaseGroup => ({
  id: String(id),
  label,
  start: startHour * 60,
  end: endHour * 60,
  slots,
  sortKeys: [ord, tmpl],
  createdAt: 0,
});

/** 預期輸出:放好的「簡稱 x–x+寬」與收起的簡稱(順序 = 完整排序)。 */
export interface Expected {
  placed: [label: string, x: number, right: number][];
  collapsed: string[];
}

export interface RuleCase {
  code: string;
  title: string;
  groups: CaseGroup[];
  /** 平板欄另用的輸入(T-14 平板欄示範店休:不排容器)。 */
  tabletGroups?: CaseGroup[];
  expected: { 157: Expected; 125: Expected };
}

const same = (expected: Expected) => ({ 157: expected, 125: expected });
const early2 = () => g(1, "早", 8.5, 14.5, 2);
const late2 = () => g(2, "晚", 14.5, 22, 2);

export const RULE_CASES: RuleCase[] = [
  {
    code: "T-01",
    title: "剛好放下",
    groups: [early2()],
    expected: same({ placed: [["早", 0, 76]], collapsed: [] }),
  },
  {
    code: "T-02",
    title: "共用位置(早接晚)",
    groups: [early2(), late2()],
    expected: same({
      placed: [
        ["早", 0, 76],
        ["晚", 0, 76],
      ],
      collapsed: [],
    }),
  },
  {
    code: "T-03",
    title: "缺額佔條",
    groups: [g(1, "早", 8.5, 14.5, 3), late2()],
    expected: same({
      placed: [
        ["早", 0, 104],
        ["晚", 0, 76],
      ],
      collapsed: [],
    }),
  },
  {
    code: "T-04",
    title: "加一筆協同任務(要多一人)",
    groups: [g(1, "早", 8.5, 14.5, 3)],
    expected: same({ placed: [["早", 0, 104]], collapsed: [] }),
  },
  {
    code: "T-05",
    title: "單筆太寬收起",
    groups: [g(1, "早", 8.5, 14.5, 5)],
    expected: same({ placed: [], collapsed: ["早"] }),
  },
  {
    code: "T-06",
    title: "中途放不下收起",
    groups: [
      early2(),
      g(3, "補", 13, 17, 1, 2),
      g(4, "臨", 13, 18, 2, 3, 99),
      late2(),
    ],
    expected: {
      157: {
        placed: [
          ["早", 0, 76],
          ["補", 76, 124],
          ["晚", 0, 76],
        ],
        collapsed: ["臨"],
      },
      125: {
        placed: [
          ["早", 0, 76],
          ["晚", 0, 76],
        ],
        collapsed: ["補", "臨"],
      },
    },
  },
  {
    code: "T-07",
    title: "後續也放不下",
    groups: [g(1, "早", 8.5, 14.5, 5), g(3, "補", 13, 17, 1, 2), late2()],
    expected: {
      157: {
        placed: [
          ["補", 0, 48],
          ["晚", 48, 124],
        ],
        collapsed: ["早"],
      },
      125: { placed: [["補", 0, 48]], collapsed: ["早", "晚"] },
    },
  },
  {
    code: "T-08",
    title: "同時開始的平手排序",
    groups: [
      g(3, "盤", 9, 12, 2, 2, 2),
      g(2, "補", 9, 13, 1, 2, 1),
      g(1, "櫃", 9, 13, 2, 1, 1),
    ],
    expected: {
      157: {
        placed: [
          ["櫃", 0, 76],
          ["補", 76, 124],
        ],
        collapsed: ["盤"],
      },
      125: { placed: [["櫃", 0, 76]], collapsed: ["補", "盤"] },
    },
  },
  {
    code: "T-09",
    title: "同一天 7 筆需求",
    groups: [
      g(1, "櫃", 9, 17, 2, 1),
      g(2, "補", 9, 13, 1, 2),
      g(3, "盤", 10, 12, 1, 3),
      g(4, "促", 11, 15, 2, 4),
      g(5, "臨", 13, 18, 1, 5, 99),
      g(6, "清", 14, 15, 1, 6),
      g(7, "教", 15, 17, 1, 7),
    ],
    expected: {
      157: {
        placed: [
          ["櫃", 0, 76],
          ["補", 76, 124],
          ["臨", 76, 124],
        ],
        collapsed: ["盤", "促", "清", "教"],
      },
      125: {
        placed: [["櫃", 0, 76]],
        collapsed: ["補", "盤", "促", "臨", "清", "教"],
      },
    },
  },
  {
    code: "T-10",
    title: "早到晚走:長條延伸出容器(排版不變)",
    groups: [early2()],
    expected: same({ placed: [["早", 0, 76]], collapsed: [] }),
  },
  {
    code: "T-11",
    title: "一人一筆排班掛兩筆需求",
    groups: [g(1, "補", 13, 17, 1, 2), g(2, "臨", 15, 18, 1, 3, 99)],
    expected: same({
      placed: [
        ["補", 0, 48],
        ["臨", 48, 96],
      ],
      collapsed: [],
    }),
  },
  {
    code: "T-12",
    title: "同一天兩段排班",
    groups: [early2(), late2()],
    expected: same({
      placed: [
        ["早", 0, 76],
        ["晚", 0, 76],
      ],
      collapsed: [],
    }),
  },
  {
    code: "T-13",
    title: "休息、負責人、自動排入、臨",
    groups: [g(1, "晚", 14.5, 22, 1), g(2, "臨", 13, 18, 1, 3, 99)],
    expected: same({
      placed: [
        ["臨", 0, 48],
        ["晚", 48, 96],
      ],
      collapsed: [],
    }),
  },
  {
    code: "T-14",
    title: "特殊日(電腦)/ 店休不排容器(平板)",
    groups: [early2()],
    tabletGroups: [],
    expected: {
      157: { placed: [["早", 0, 76]], collapsed: [] },
      125: { placed: [], collapsed: [] },
    },
  },
  {
    code: "T-15",
    title: "滑過 / 已選取(排版不變)",
    groups: [early2()],
    expected: same({ placed: [["早", 0, 76]], collapsed: [] }),
  },
  {
    code: "T-16",
    title: "滑過留白處",
    groups: [g(1, "早", 8.5, 14.5, 5), g(3, "補", 13, 17, 1, 2), late2()],
    expected: {
      157: {
        placed: [
          ["補", 0, 48],
          ["晚", 48, 124],
        ],
        collapsed: ["早"],
      },
      125: { placed: [["補", 0, 48]], collapsed: ["早", "晚"] },
    },
  },
  {
    code: "T-17",
    title: "邊界:124 寬剛好放進平板 125",
    groups: [early2(), g(3, "補", 13, 17, 1, 2), late2()],
    expected: same({
      placed: [
        ["早", 0, 76],
        ["補", 76, 124],
        ["晚", 0, 76],
      ],
      collapsed: [],
    }),
  },
  {
    code: "T-18",
    title: "一人顧兩個收銀點",
    groups: [g(1, "A", 14, 22, 1), g(2, "B", 14, 22, 1, 2)],
    expected: same({
      placed: [
        ["A", 0, 48],
        ["B", 48, 96],
      ],
      collapsed: [],
    }),
  },
];

export const describeLayout = (
  groups: CaseGroup[],
  dayWidth: number,
): Expected => {
  const result = layoutTimeline(groups, dayWidth);
  return {
    placed: result.placed.map(({ group, x, width }) => [
      group.label,
      x,
      x + width,
    ]),
    collapsed: result.collapsed.map((group) => group.label),
  };
};

/** 依編號取規則頁案例。 */
export const ruleCase = (code: string): RuleCase => {
  const found = RULE_CASES.find((c) => c.code === code);
  if (!found) {
    throw new Error(`沒有規則頁案例 ${code}`);
  }
  return found;
};
