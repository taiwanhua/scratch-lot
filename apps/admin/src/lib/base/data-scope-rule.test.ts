import { describe, expect, it } from "@jest/globals";

import { DataScopeCombineOp, DataScopeFieldType } from "@repo/graphql";

import { newAudienceDraft } from "./audience-draft";
import {
  type RuleIssue,
  issueFromRuleInvalid,
  validateEditorDraft,
} from "./data-scope-issues";
import {
  type DataScopeFieldLike,
  type GroupDraft,
  type RuleEditorDraft,
  emptyEditorDraft,
  newCondition,
  newRule,
  toEditorDraft,
  toRuleEntryInputs,
  withCondition,
} from "./data-scope-rule";

/** 欄位目錄(形狀同 `dataScopeTargets` 的 `fields[]`:業務欄位在前、基礎欄位殿後)。 */
const FIELDS: DataScopeFieldLike[] = [
  {
    name: "status",
    label: "狀態",
    type: DataScopeFieldType.Enum,
    options: [
      { value: "draft", label: "草稿" },
      { value: "published", label: "已發布" },
    ],
  },
  { name: "orgId", label: "組織", type: DataScopeFieldType.Org, options: [] },
  {
    name: "createdBy",
    label: "建立者",
    type: DataScopeFieldType.User,
    options: [],
  },
  {
    name: "createdAt",
    label: "建立時間",
    type: DataScopeFieldType.Date,
    options: [],
  },
];

const fieldOf = (name: string): DataScopeFieldLike =>
  FIELDS.find((field) => field.name === name) ?? FIELDS[0];

/** 正本 `docs/modules/data-scope.md`「`rules[].filter` 的 JSON 形狀」那份示例的骨架。 */
const SAVED_RULE = {
  combineOp: DataScopeCombineOp.Or,
  rules: [
    {
      audience: {
        mode: "match",
        filter: {
          op: "AND",
          children: [
            {
              field: "role",
              cond: "in",
              value: { kind: "static", values: ["role-support"] },
            },
            {
              field: "org",
              cond: "in",
              value: { kind: "static", values: ["org-store"] },
              range: "descendants",
            },
          ],
        },
      },
      filter: {
        op: "AND",
        children: [
          {
            field: "createdBy",
            cond: "in",
            value: { kind: "dynamic", ref: "current-user" },
          },
          {
            op: "OR",
            children: [
              {
                field: "orgId",
                cond: "not-in",
                value: { kind: "static", values: ["org-store"] },
              },
              {
                field: "createdAt",
                cond: "between",
                value: { kind: "static", values: ["2026-01-01", "2026-12-31"] },
              },
            ],
          },
        ],
      },
    },
  ],
};

describe("條件樹 ↔ api JSON", () => {
  it("尚無規則(rule = null)時是空的編輯器狀態,頂層合成預設 OR", () => {
    expect(emptyEditorDraft()).toEqual({
      combineOp: DataScopeCombineOp.Or,
      rules: [],
    });
    expect(toEditorDraft(null)).toEqual(emptyEditorDraft());
  });

  it("api JSON → 編輯器狀態 → api JSON 之後形狀不變(含巢狀群組與動態值)", () => {
    const draft = toEditorDraft(SAVED_RULE);

    expect(draft.rules[0]?.filter.op).toBe("AND");
    expect(draft.rules[0]?.filter.children).toHaveLength(2);
    expect(toRuleEntryInputs(draft)).toEqual(SAVED_RULE.rules);
  });

  it("根節點直接是條件列的舊資料,顯示時包一層 AND 群組(語意相同)", () => {
    const draft = toEditorDraft({
      combineOp: DataScopeCombineOp.And,
      rules: [
        {
          audience: { mode: "all" },
          filter: {
            field: "status",
            cond: "in",
            value: { kind: "static", values: ["draft"] },
          },
        },
      ],
    });

    expect(draft.rules[0]?.filter).toEqual({
      kind: "group",
      op: "AND",
      children: [
        {
          kind: "condition",
          field: "status",
          cond: "in",
          value: { kind: "static", values: ["draft"] },
        },
      ],
    });
  });
});

describe("目錄驅動的預設值", () => {
  it("新條件列取該型別的第一個運算子;日期型別預留一個空值格", () => {
    expect(newCondition(fieldOf("orgId"))).toEqual({
      kind: "condition",
      field: "orgId",
      cond: "in",
      value: { kind: "static", values: [] },
    });
    expect(newCondition(fieldOf("createdAt"))).toEqual({
      kind: "condition",
      field: "createdAt",
      cond: "between",
      value: { kind: "static", values: [""] },
    });
  });

  it("日期換成「之間」給兩格、換回「之後」只留第一格", () => {
    const between = withCondition(
      newCondition(fieldOf("createdAt")),
      "between",
      DataScopeFieldType.Date,
    );
    expect(between.value).toEqual({ kind: "static", values: ["", ""] });

    const filled = {
      ...between,
      value: { kind: "static" as const, values: ["2026-01-01", "2026-12-31"] },
    };
    expect(
      withCondition(filled, "after", DataScopeFieldType.Date).value,
    ).toEqual({ kind: "static", values: ["2026-01-01"] });
  });

  it("新規則預設套用對象「所有人」,條件樹是一個 AND 群組加一條條件列(不會是空群組)", () => {
    const rule = newRule(fieldOf("status"));

    expect(rule.audience.mode).toBe("all");
    expect(
      toRuleEntryInputs({ combineOp: DataScopeCombineOp.Or, rules: [rule] })[0]
        ?.audience,
    ).toEqual({ mode: "all" });
    expect(rule.filter.children).toHaveLength(1);
  });
});

const issuesOf = (rules: RuleEditorDraft["rules"]): RuleIssue[] =>
  validateEditorDraft({ combineOp: DataScopeCombineOp.Or, rules }, FIELDS);

/** 套用對象固定「全部」,只驗條件樹的那一半。 */
const ruleWith = (filter: GroupDraft): RuleEditorDraft["rules"] => [
  { audience: newAudienceDraft("role", { allowAll: true }), filter },
];

describe("本地驗證", () => {
  it("空的 rules 不是問題(整份覆蓋時代表刪掉這個目標的規則)", () => {
    expect(issuesOf([])).toEqual([]);
  });

  it("空群組標在群組上", () => {
    const issues = issuesOf(
      ruleWith({ kind: "group", op: "AND", children: [] }),
    );

    expect(issues).toEqual([
      {
        tree: "filter",
        ruleIndex: 0,
        childPath: [],
        target: "group",
        reason: "EMPTY_GROUP",
      },
    ]);
  });

  it("缺值標在值欄;日期「之間」只填一格也算缺值", () => {
    const issues = issuesOf(
      ruleWith({
        kind: "group",
        op: "AND",
        children: [
          newCondition(fieldOf("orgId")),
          {
            kind: "condition",
            field: "createdAt",
            cond: "between",
            value: { kind: "static", values: ["2026-01-01", ""] },
          },
        ],
      }),
    );

    expect(issues).toEqual([
      {
        tree: "filter",
        ruleIndex: 0,
        childPath: [0],
        target: "value",
        reason: "VALUE_INVALID",
      },
      {
        tree: "filter",
        ruleIndex: 0,
        childPath: [1],
        target: "value",
        reason: "VALUE_INVALID",
      },
    ]);
  });

  it("型別不符:日期不能用動態值、enum 值必須在宣告的選項內、運算子要合型別", () => {
    const issues = issuesOf(
      ruleWith({
        kind: "group",
        op: "OR",
        children: [
          {
            kind: "condition",
            field: "createdAt",
            cond: "after",
            value: { kind: "dynamic", ref: "current-user" },
          },
          {
            kind: "condition",
            field: "status",
            cond: "in",
            value: { kind: "static", values: ["archived"] },
          },
          {
            kind: "condition",
            field: "orgId",
            cond: "between",
            value: { kind: "static", values: ["org-a"] },
          },
          {
            kind: "condition",
            field: "gone",
            cond: "in",
            value: { kind: "static", values: ["x"] },
          },
        ],
      }),
    );

    expect(
      issues.map((issue) => [issue.childPath, issue.target, issue.reason]),
    ).toEqual([
      [[0], "value", "VALUE_SOURCE_NOT_ALLOWED"],
      [[1], "value", "VALUE_INVALID"],
      [[2], "cond", "CONDITION_NOT_ALLOWED"],
      [[3], "field", "UNKNOWN_FIELD"],
    ]);
  });

  it("套用對象「符合條件」:沒挑值的列標 AUDIENCE_INVALID、空群組標 EMPTY_GROUP", () => {
    const issues = validateEditorDraft(
      {
        combineOp: DataScopeCombineOp.Or,
        rules: [
          {
            audience: {
              mode: "match",
              filter: {
                kind: "group",
                op: "AND",
                children: [
                  {
                    kind: "condition",
                    field: "role",
                    value: { kind: "static", values: ["role-a"] },
                  },
                  {
                    kind: "condition",
                    field: "user",
                    value: { kind: "static", values: [] },
                  },
                  { kind: "group", op: "OR", children: [] },
                ],
              },
            },
            filter: {
              kind: "group",
              op: "AND",
              children: [
                {
                  kind: "condition",
                  field: "status",
                  cond: "in",
                  value: { kind: "static", values: ["draft"] },
                },
              ],
            },
          },
        ],
      },
      FIELDS,
    );

    expect(issues).toEqual([
      {
        tree: "audience",
        ruleIndex: 0,
        childPath: [1],
        target: "value",
        reason: "AUDIENCE_INVALID",
      },
      {
        tree: "audience",
        ruleIndex: 0,
        childPath: [2],
        target: "group",
        reason: "EMPTY_GROUP",
      },
    ]);
  });

  it("正本示例那份規則是合法的", () => {
    expect(validateEditorDraft(toEditorDraft(SAVED_RULE), FIELDS)).toEqual([]);
  });
});

describe("RULE_INVALID 的 path 對回節點", () => {
  it.each([
    [
      "rules[0].filter.children[1].value.values[0]",
      { tree: "filter", ruleIndex: 0, childPath: [1], target: "value" },
    ],
    [
      "rules[2].filter.children[0].children[3].cond",
      { tree: "filter", ruleIndex: 2, childPath: [0, 3], target: "cond" },
    ],
    [
      "rules[1].filter.children[0].field",
      { tree: "filter", ruleIndex: 1, childPath: [0], target: "field" },
    ],
    [
      "rules[0].filter.children",
      { tree: "filter", ruleIndex: 0, childPath: [], target: "group" },
    ],
    [
      "rules[3].audience.filter.children[1].value.values[0]",
      { tree: "audience", ruleIndex: 3, childPath: [1], target: "value" },
    ],
    [
      "rules[0].audience.filter.children[0].children[2].field",
      { tree: "audience", ruleIndex: 0, childPath: [0, 2], target: "field" },
    ],
    [
      "rules[0].audience.filter.children[1].range",
      { tree: "audience", ruleIndex: 0, childPath: [1], target: "range" },
    ],
    [
      "rules[1].audience.filter.children",
      { tree: "audience", ruleIndex: 1, childPath: [], target: "group" },
    ],
    [
      "rules[1].audience.mode",
      { tree: "audience", ruleIndex: 1, childPath: [], target: "mode" },
    ],
    [
      "rules[1].audience",
      { tree: "audience", ruleIndex: 1, childPath: [], target: "mode" },
    ],
  ])("%s", (path, expected) => {
    expect(issueFromRuleInvalid(path, "VALUE_INVALID")).toEqual({
      ...expected,
      reason: "VALUE_INVALID",
    });
  });

  it("不指向單一規則的 path(整份 rules 壞掉)沒有節點可標", () => {
    expect(issueFromRuleInvalid("rules", "MALFORMED_RULE")).toBeNull();
  });
});
