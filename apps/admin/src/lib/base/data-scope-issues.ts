import { DataScopeFieldType } from "@repo/graphql";

import {
  type AudienceDraft,
  type AudienceIssueTarget,
  audienceIssueFromPath,
  validateAudienceDraft,
} from "./audience-draft";
import {
  CONDITIONS_BY_TYPE,
  type ConditionDraft,
  DYNAMIC_REFS_BY_TYPE,
  type DataScopeFieldLike,
  type GroupDraft,
  type RuleEditorDraft,
  nodeKey,
} from "./data-scope-rule";

/**
 * 條件樹的問題定位:**本地驗證**與 api 的 `RULE_INVALID` 走同一種 `RuleIssue`,
 * 所以「送出前先擋」與「送出後標紅」是同一條顯示路徑,元件只認 `RuleIssue`。
 *
 * `reason` 的清單與語意正本:`docs/modules/data-scope.md`「`RULE_INVALID` 的 `extensions`」。
 * 本地只驗**編輯器產得出來的**那幾種(空群組、缺值、型別不符、套用對象的條件列沒挑值);
 * `MALFORMED_*` 是資料本身壞掉,編輯器做不出來,只可能從 api 回來。
 */
export const RULE_INVALID_REASONS = [
  "MALFORMED_RULE",
  "MALFORMED_NODE",
  "EMPTY_GROUP",
  "UNKNOWN_FIELD",
  "CONDITION_NOT_ALLOWED",
  "VALUE_SOURCE_NOT_ALLOWED",
  "VALUE_INVALID",
  "AUDIENCE_INVALID",
] as const;

export type RuleInvalidReason = (typeof RULE_INVALID_REASONS)[number];

/** 條件組合(`filter`)的問題標在節點的哪一格;`group` 的 `childPath` 指的是群組本身。 */
export type RuleIssueTarget = "group" | "field" | "cond" | "value";

/**
 * 一個問題在哪一棵樹:`filter` = 條件組合,`audience` = 套用對象(人員條件,格子見
 * `AudienceIssueTarget`;座標也是從它的根群組往下的 `childPath`)。
 */
export type RuleIssue =
  | {
      tree: "filter";
      ruleIndex: number;
      /** 從規則的根群組往下的 children 索引;根群組是空陣列。 */
      childPath: readonly number[];
      target: RuleIssueTarget;
      reason: RuleInvalidReason;
    }
  | {
      tree: "audience";
      ruleIndex: number;
      childPath: readonly number[];
      target: AudienceIssueTarget;
      reason: RuleInvalidReason;
      /**
       * 本地驗證才有:畫面用 AudiencePicker 自己的文案(`admin.audiencePicker.emptyValue` /
       * `emptyGroup`)講清楚缺什麼;api 回來的 `AUDIENCE_INVALID` 原因不只一種,用通用說法。
       */
      localReason?: "emptyValue" | "emptyGroup";
    };

export const issueKey = (
  ruleIndex: number,
  childPath: readonly number[],
  target: RuleIssueTarget,
): string => `filter:${nodeKey(ruleIndex, childPath)}:${target}`;

/** 條件組合的問題:`issueKey` → 問題(套用對象的問題另走 `audienceIssuesOf`)。 */
export const issuesByKey = (
  issues: readonly RuleIssue[],
): ReadonlyMap<string, RuleIssue> =>
  new Map(
    issues.flatMap((issue) =>
      issue.tree === "filter"
        ? [
            [
              issueKey(issue.ruleIndex, issue.childPath, issue.target),
              issue,
            ] as const,
          ]
        : [],
    ),
  );

/** 某條規則套用對象的問題(交給 AudiencePicker 換成它自己的 `issues` 表)。 */
export const audienceIssuesOf = (
  issues: readonly RuleIssue[],
  ruleIndex: number,
): Extract<RuleIssue, { tree: "audience" }>[] =>
  issues.flatMap((issue) =>
    issue.tree === "audience" && issue.ruleIndex === ruleIndex ? [issue] : [],
  );

// ---- 本地驗證(送出前) ----

/** 套用對象:空群組標 `EMPTY_GROUP`、沒挑值標 `AUDIENCE_INVALID`;文案由 `localReason` 決定。 */
const audienceIssues = (
  audience: AudienceDraft,
  ruleIndex: number,
): RuleIssue[] =>
  validateAudienceDraft(audience).map((location) => ({
    tree: "audience",
    ruleIndex,
    childPath: location.childPath,
    target: location.target,
    reason: location.target === "group" ? "EMPTY_GROUP" : "AUDIENCE_INVALID",
    localReason: location.target === "group" ? "emptyGroup" : "emptyValue",
  }));

const staticValueIssue = (
  condition: ConditionDraft,
  field: DataScopeFieldLike,
  values: readonly string[],
): boolean => {
  const filled = values.filter((value) => value !== "");
  if (field.type === DataScopeFieldType.Date) {
    return filled.length !== (condition.cond === "between" ? 2 : 1);
  }
  if (filled.length === 0) {
    return true;
  }
  if (field.type !== DataScopeFieldType.Enum) {
    return false;
  }
  const allowed = new Set(field.options.map((option) => option.value));
  return filled.some((value) => !allowed.has(value));
};

const conditionIssues = (
  condition: ConditionDraft,
  ruleIndex: number,
  childPath: readonly number[],
  byName: ReadonlyMap<string, DataScopeFieldLike>,
): RuleIssue[] => {
  const at = (
    target: RuleIssueTarget,
    reason: RuleInvalidReason,
  ): RuleIssue[] => [{ tree: "filter", ruleIndex, childPath, target, reason }];

  const field = byName.get(condition.field);
  if (field === undefined) {
    return at("field", "UNKNOWN_FIELD");
  }
  if (!CONDITIONS_BY_TYPE[field.type].includes(condition.cond)) {
    return at("cond", "CONDITION_NOT_ALLOWED");
  }
  if (condition.value.kind === "dynamic") {
    return DYNAMIC_REFS_BY_TYPE[field.type].includes(condition.value.ref)
      ? []
      : at("value", "VALUE_SOURCE_NOT_ALLOWED");
  }
  return staticValueIssue(condition, field, condition.value.values)
    ? at("value", "VALUE_INVALID")
    : [];
};

const groupIssues = (
  group: GroupDraft,
  ruleIndex: number,
  childPath: readonly number[],
  byName: ReadonlyMap<string, DataScopeFieldLike>,
): RuleIssue[] => {
  if (group.children.length === 0) {
    return [
      {
        tree: "filter",
        ruleIndex,
        childPath,
        target: "group",
        reason: "EMPTY_GROUP",
      },
    ];
  }
  return group.children.flatMap((child, index) => {
    const path = [...childPath, index];
    return child.kind === "group"
      ? groupIssues(child, ruleIndex, path, byName)
      : conditionIssues(child, ruleIndex, path, byName);
  });
};

/**
 * 送出前的本地驗證:回傳全部問題(api 一次只回第一個,本地一次標完比較好修)。
 * 空的 `rules` 不是問題 — 整份覆蓋時它代表「刪掉這個目標的規則」。
 */
export const validateEditorDraft = (
  draft: RuleEditorDraft,
  fields: readonly DataScopeFieldLike[],
): RuleIssue[] => {
  const byName = new Map(fields.map((field) => [field.name, field]));
  return draft.rules.flatMap((rule, ruleIndex) => [
    ...audienceIssues(rule.audience, ruleIndex),
    ...groupIssues(rule.filter, ruleIndex, [], byName),
  ]);
};

// ---- api 的 `RULE_INVALID` → 標在哪一格 ----

const RULE_INDEX = /^rules\[(\d+)]/;
const CHILD_INDEX = /\.children\[(\d+)]/g;

/**
 * `extensions.path`(如 `rules[0].filter.children[1].value.values[0]`)對回編輯器座標。
 * 不帶 `rules[n]` 的路徑(整份 `rules` 壞掉)回 `null` — 沒有單一節點可標,由頁面顯示整體錯誤。
 */
export const issueFromRuleInvalid = (
  path: string,
  reason: RuleInvalidReason,
): RuleIssue | null => {
  const matched = RULE_INDEX.exec(path);
  if (matched === null) {
    return null;
  }
  const ruleIndex = Number(matched[1]);
  const rest = path.slice(matched[0].length);
  if (rest.startsWith(".audience")) {
    // 人員條件自己的路徑(`filter.children[1].value`、`mode`)交給 audience-draft 定位
    const location = audienceIssueFromPath(
      rest.slice(".audience".length).replace(/^./, ""),
    );
    return { tree: "audience", ruleIndex, ...location, reason };
  }
  const childPath = [...rest.matchAll(CHILD_INDEX)].map((child) =>
    Number(child[1]),
  );
  return {
    tree: "filter",
    ruleIndex,
    childPath,
    target: targetOf(rest),
    reason,
  };
};

const targetOf = (rest: string): RuleIssueTarget => {
  if (rest.includes(".value")) {
    return "value";
  }
  if (rest.endsWith(".cond")) {
    return "cond";
  }
  if (rest.endsWith(".field")) {
    return "field";
  }
  return "group";
};
