import { describe, expect, it } from "@jest/globals";

import {
  type SettingRow,
  effectiveRuleSettings,
  resolveRules,
} from "./rule-resolution";

const TENANT = "tenant";
const REGION = "region";
const BRANCH = "branch";
/** 分店的組織鏈:自己 → 區 → 最上層組織 */
const CHAIN = [BRANCH, REGION, TENANT];

function row(
  orgId: string,
  key: string,
  overrides: Partial<SettingRow> = {},
): SettingRow {
  return {
    orgId,
    key,
    enabled: true,
    value: {},
    level: null,
    order: 0,
    ...overrides,
  };
}

function maxDayOffs(orgId: string, amount: number): SettingRow {
  return row(orgId, "maxMonthlyDayOffs", {
    value: { amount },
    level: "limit",
    order: 1,
  });
}

function resolved(rows: SettingRow[], key: string, chain = CHAIN) {
  const found = resolveRules(chain, rows).find(
    (rule) => rule.definition.key === key,
  );
  if (!found) {
    throw new Error(`沒有規則 ${key}`);
  }
  return found;
}

describe("規則生效值:沿組織樹往上找,最後用程式預設(規格 14.2)", () => {
  it.each([
    {
      name: "整條鏈都沒設 → 程式預設",
      rows: [],
      amount: 8,
      source: "default",
      sourceOrgId: null,
      parentAmount: null,
    },
    {
      name: "最上層組織設 8、分店未設 → 分店 8,沿用最上層組織",
      rows: [maxDayOffs(TENANT, 8)],
      amount: 8,
      source: "inherited",
      sourceOrgId: TENANT,
      parentAmount: null,
    },
    {
      name: "最上層組織設 8、區設 7 → 沿用最接近的區 7",
      rows: [maxDayOffs(TENANT, 8), maxDayOffs(REGION, 7)],
      amount: 7,
      source: "inherited",
      sourceOrgId: REGION,
      parentAmount: null,
    },
    {
      name: "最上層組織設 8、分店自訂 6 → 6,上層 8",
      rows: [maxDayOffs(TENANT, 8), maxDayOffs(BRANCH, 6)],
      amount: 6,
      source: "own",
      sourceOrgId: BRANCH,
      parentAmount: 8,
    },
    {
      name: "只有分店自訂 6 → 6,上層是程式預設 8",
      rows: [maxDayOffs(BRANCH, 6)],
      amount: 6,
      source: "own",
      sourceOrgId: BRANCH,
      parentAmount: 8,
    },
    {
      name: "不在鏈上的組織(兄弟分店)的自訂不影響",
      rows: [maxDayOffs("sibling", 2)],
      amount: 8,
      source: "default",
      sourceOrgId: null,
      parentAmount: null,
    },
  ])("$name", ({ rows, amount, source, sourceOrgId, parentAmount }) => {
    const rule = resolved(rows, "maxMonthlyDayOffs");
    expect(rule.effective.value).toEqual({ amount });
    expect(rule.effective.source).toBe(source);
    expect(rule.effective.sourceOrgId).toBe(sourceOrgId);
    expect(rule.parent?.value ?? null).toEqual(
      parentAmount === null ? null : { amount: parentAmount },
    );
  });

  it("自訂的整筆(值、等級、排序、開關)一起覆寫", () => {
    const rule = resolved(
      [
        maxDayOffs(TENANT, 8),
        row(BRANCH, "maxMonthlyDayOffs", {
          value: { amount: 6 },
          level: "reminder",
          order: 9,
        }),
      ],
      "maxMonthlyDayOffs",
    );
    expect(rule.effective).toMatchObject({
      level: "reminder",
      order: 9,
      enabled: true,
    });
    expect(rule.parent).toMatchObject({ level: "limit", order: 1 });
  });

  it("最上層組織自己看:自訂就是本層,上層是程式預設", () => {
    const rule = resolved([maxDayOffs(TENANT, 10)], "maxMonthlyDayOffs", [
      TENANT,
    ]);
    expect(rule.effective.source).toBe("own");
    expect(rule.parent?.source).toBe("default");
  });
});

describe("自動排班條件整組繼承", () => {
  const AUTO_RUN = [
    "continuePreviousEntry",
    "leaderCountFirst",
    "monthlyShiftBalance",
    "allowOverlappingDemands",
  ];

  function group(rows: SettingRow[]) {
    return AUTO_RUN.map((key) => resolved(rows, key).effective);
  }

  it("上層自訂一條 → 整組沿用上層(沒寫到的用程式預設,但來源仍是那一層)", () => {
    const effective = group([
      row(TENANT, "monthlyShiftBalance", { enabled: true, order: 1 }),
    ]);
    expect(effective.map((item) => item.source)).toEqual([
      "inherited",
      "inherited",
      "inherited",
      "inherited",
    ]);
    expect(effective.map((item) => item.sourceOrgId)).toEqual([
      TENANT,
      TENANT,
      TENANT,
      TENANT,
    ]);
    expect(effective.map((item) => item.enabled)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("分店自訂一條 → 整組變本店自訂,上層的其他條件不再混進來", () => {
    const effective = group([
      row(TENANT, "continuePreviousEntry", { enabled: false, order: 1 }),
      row(TENANT, "leaderCountFirst", { enabled: false, order: 2 }),
      row(BRANCH, "monthlyShiftBalance", { enabled: true, order: 1 }),
    ]);
    expect(effective.every((item) => item.source === "own")).toBe(true);
    // 分店沒寫到的兩條用程式預設(勾),不是上層的「不勾」
    expect(effective.map((item) => item.enabled)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("[還原](分店那一組刪掉)→ 整組沿用上層", () => {
    const effective = group([
      row(TENANT, "continuePreviousEntry", { enabled: false, order: 1 }),
    ]);
    expect(effective.every((item) => item.source === "inherited")).toBe(true);
    expect(effective[0]?.enabled).toBe(false);
  });

  it("規則與自動排班條件互不影響", () => {
    const rows = [row(BRANCH, "leaderCountFirst", { enabled: false })];
    expect(resolved(rows, "maxMonthlyDayOffs").effective.source).toBe(
      "default",
    );
  });
});

describe("檢查用的生效設定", () => {
  it("每條規則都有一份(key → 設定)", () => {
    const settings = effectiveRuleSettings(CHAIN, [maxDayOffs(TENANT, 9)]);
    expect(settings.get("maxMonthlyDayOffs")).toEqual({
      key: "maxMonthlyDayOffs",
      enabled: true,
      value: { amount: 9 },
      level: "limit",
      order: 1,
    });
    expect(settings.get("entryMatchToleranceMinutes")?.value).toEqual({
      amount: 60,
    });
  });
});
