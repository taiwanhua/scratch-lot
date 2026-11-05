import { describe, expect, it } from "@jest/globals";

import {
  type StoreBusy,
  isStocktakeSessionActive,
  storeBusyOf,
} from "../lottery/count-mode";
import {
  type CountModeChangeStore,
  canCancelConversion,
  countModeChangeOutcomesOf,
  countModeChangeProblemsOf,
} from "./count-mode-change";
import {
  LOTTERY_SETTING_DEFINITIONS,
  countModeSettingOf,
  lotterySettingOptionOf,
  renumberCycleOf,
  resolveLotterySettings,
} from "./settings";

const row = (orgId: string, key: string, option: unknown) => ({
  orgId,
  key,
  value: { option },
});

const CHAIN = ["store", "region", "tenant"];

describe("刮刮樂設定的定義(規格第 4 節第一批設定)", () => {
  it("四條設定、依表的順序,程式預設照規格", () => {
    expect(
      LOTTERY_SETTING_DEFINITIONS.map((definition) => [
        definition.key,
        definition.defaultOption,
        definition.options,
      ]),
    ).toEqual([
      ["count_mode", "numbered", ["numbered", "count"]],
      ["renumber_required", "remind", ["remind", "required"]],
      [
        "renumber_reminder",
        "monthly",
        ["none", "weekly", "biweekly", "monthly"],
      ],
      ["transfer_grid_pick", "on", ["on", "off"]],
    ]);
  });
});

describe("生效值沿組織樹往上找:分店 → 區域 → 最上層組織 → 程式預設(SET1)", () => {
  it.each([
    // [自訂, 生效值, 來源, 來源組織]
    [[], "numbered", "default", null],
    [[row("tenant", "count_mode", "count")], "count", "inherited", "tenant"],
    [
      [
        row("tenant", "count_mode", "count"),
        row("region", "count_mode", "numbered"),
      ],
      "numbered",
      "inherited",
      "region",
    ],
    [
      [
        row("tenant", "count_mode", "count"),
        row("store", "count_mode", "numbered"),
      ],
      "numbered",
      "own",
      "store",
    ],
    // 壞資料(不在選項裡)當作沒有這列
    [[row("store", "count_mode", "weird")], "numbered", "default", null],
    // 別的組織的列不影響
    [[row("other", "count_mode", "count")], "numbered", "default", null],
  ] as const)("%j → %s(%s)", (rows, option, source, sourceOrgId) => {
    const [countMode] = resolveLotterySettings(CHAIN, rows);
    expect(countMode?.effective).toEqual({ option, source, sourceOrgId });
    expect(countModeSettingOf(CHAIN, rows)).toBe(option);
  });

  it("本層自訂時附上層的生效值(畫面的「上層:…」);上層自訂也寫成沿用", () => {
    const [countMode] = resolveLotterySettings(CHAIN, [
      row("store", "count_mode", "count"),
      row("region", "count_mode", "numbered"),
    ]);
    expect(countMode?.parent).toEqual({
      option: "numbered",
      source: "inherited",
      sourceOrgId: "region",
    });
    const [onlyStore] = resolveLotterySettings(CHAIN, [
      row("store", "count_mode", "count"),
    ]);
    expect(onlyStore?.parent).toEqual({
      option: "numbered",
      source: "default",
      sourceOrgId: null,
    });
    const [inherited] = resolveLotterySettings(CHAIN, [
      row("tenant", "count_mode", "count"),
    ]);
    expect(inherited?.parent).toBeNull();
  });

  it("每條設定各自繼承", () => {
    const rows = [
      row("tenant", "renumber_reminder", "weekly"),
      row("store", "transfer_grid_pick", "off"),
    ];
    expect(renumberCycleOf(CHAIN, rows)).toBe("weekly");
    expect(lotterySettingOptionOf("transfer_grid_pick", CHAIN, rows)).toBe(
      "off",
    );
    expect(lotterySettingOptionOf("renumber_required", CHAIN, rows)).toBe(
      "remind",
    );
  });

  it("沒有這條設定 → 拋錯", () => {
    expect(() =>
      lotterySettingOptionOf("nope" as "count_mode", CHAIN, []),
    ).toThrow();
  });
});

const BUSY: StoreBusy = { stocktake: true, rescan: false, renumber: false };

const store = (
  overrides: Partial<CountModeChangeStore>,
): CountModeChangeStore => ({
  orgId: "store",
  before: "numbered",
  after: "count",
  current: "numbered",
  unmatchedCount: 0,
  pendingSkipBooks: 0,
  busy: null,
  ...overrides,
});

const toNumbered = {
  before: "count",
  after: "numbered",
  current: "count",
} as const;

describe("改盤點制度:各分店怎麼變、哪些擋下(SW1、9.1、9.2)", () => {
  it.each([
    // [說明, 分店, 實際制度變成, 擋下原因]
    ["編號 → 張數:當下生效", store({}), "count", []],
    [
      "張數 → 編號,有未對號:進轉換中",
      store({ ...toNumbered, unmatchedCount: 3 }),
      "converting",
      [],
    ],
    ["張數 → 編號,沒有未對號:直接編號", store(toNumbered), "numbered", []],
    [
      "編號 → 張數,檯面上有待標註的本:擋",
      store({ pendingSkipBooks: 2 }),
      "count",
      ["pending_skip"],
    ],
    [
      "張數 → 編號不看待標註",
      store({ ...toNumbered, pendingSkipBooks: 2 }),
      "numbered",
      [],
    ],
    ["有進行中的盤點:兩個方向都擋", store({ busy: BUSY }), "count", ["busy"]],
    [
      "張數 → 編號,有進行中的重刷:擋",
      store({
        ...toNumbered,
        busy: { stocktake: false, rescan: true, renumber: false },
      }),
      "numbered",
      ["busy"],
    ],
    [
      "兩個原因同時有",
      store({ pendingSkipBooks: 1, busy: BUSY }),
      "count",
      ["pending_skip", "busy"],
    ],
    [
      "轉換中改回張數:不看待標註(本來就是張數店的畫面)",
      store({ current: "converting", pendingSkipBooks: 1 }),
      "count",
      [],
    ],
  ] as const)("%s", (_label, given, to, problems) => {
    const [outcome] = countModeChangeOutcomesOf([given]);
    expect(outcome).toEqual({
      orgId: "store",
      from: given.current,
      to,
      problems,
    });
  });

  it("生效設定沒變的分店(自訂了別的值)不會跟著改,也不檢查", () => {
    const unchanged = store({ after: "numbered", busy: BUSY });
    expect(countModeChangeOutcomesOf([unchanged])).toEqual([]);
    expect(countModeChangeProblemsOf(unchanged)).toEqual([]);
  });

  it("上層改預設:只列會跟著改的分店,依給的順序", () => {
    const outcomes = countModeChangeOutcomesOf([
      store({ orgId: "a" }),
      store({ orgId: "b", before: "count", current: "count" }),
      store({ orgId: "c", pendingSkipBooks: 1 }),
    ]);
    expect(
      outcomes.map((outcome) => [outcome.orgId, outcome.problems]),
    ).toEqual([
      ["a", []],
      ["c", ["pending_skip"]],
    ]);
  });

  it("[取消轉換] 只有轉換中的店可以按", () => {
    expect(canCancelConversion("converting")).toBe(true);
    expect(canCancelConversion("count")).toBe(false);
    expect(canCancelConversion("numbered")).toBe(false);
  });
});

describe("進行中的工作(9.1 擋改盤點制度;8.5a 盤點中登記 1 小時失效)", () => {
  const now = new Date("2026-11-03T10:00:00Z");
  const minutesAgo = (minutes: number) =>
    new Date(now.getTime() - minutes * 60_000);

  it.each([
    ["沒有", { movePauses: [], stocktakeSessions: [] }, null],
    [
      "59 分鐘前操作過的盤點中登記",
      { movePauses: [], stocktakeSessions: [{ lastActiveAt: minutesAgo(59) }] },
      { stocktake: true, rescan: false, renumber: false },
    ],
    [
      "滿 1 小時沒操作:失效、不算",
      { movePauses: [], stocktakeSessions: [{ lastActiveAt: minutesAgo(60) }] },
      null,
    ],
    [
      "全店重刷",
      { movePauses: [{ gameId: "game-x" }], stocktakeSessions: [] },
      { stocktake: false, rescan: true, renumber: false },
    ],
    [
      "補點編號",
      { movePauses: [{ gameId: null }], stocktakeSessions: [] },
      { stocktake: false, rescan: false, renumber: true },
    ],
  ] as const)("%s", (_label, work, expected) => {
    expect(storeBusyOf(work, now)).toEqual(expected);
  });

  it("盤點中登記的失效時間以最後一次操作算", () => {
    expect(isStocktakeSessionActive(minutesAgo(30), now)).toBe(true);
    expect(isStocktakeSessionActive(minutesAgo(61), now)).toBe(false);
  });
});
