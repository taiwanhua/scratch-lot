import {
  AUDIENCE_ORG_RANGES,
  type AudienceDynamicRef,
  type AudienceField,
  type AudienceOrgRange,
} from "@repo/domain/audience";

import {
  type ConditionTreeGroup,
  type ConditionTreeNode,
  childPathKey,
  groupOf,
  locateInTree,
} from "./condition-tree";

/**
 * 人員條件(AudiencePicker)的**編輯器狀態**與 JSON 互轉、本地驗證、錯誤定位。
 * 格式正本 `@repo/domain/audience`;這裡只管畫面的那一份狀態:
 *
 * - 「所有人」時條件樹**仍留在狀態裡**(畫面收起),切回「符合條件」原樣回來;送出時才丟掉。
 * - 根節點一律是群組(api 存的根若是單一條件列,讀進來包一層 AND,語意相同)。
 */

/** 所屬組織的值:指定組織(`static`)或使用處宣告的動態來源。 */
export type AudienceValueDraft =
  | { kind: "static"; values: string[] }
  | { kind: "dynamic"; ref: AudienceDynamicRef };

export interface AudienceConditionDraft {
  kind: "condition";
  field: AudienceField;
  value: AudienceValueDraft;
  /** 只有所屬組織欄有 */
  range?: AudienceOrgRange;
}

export type AudienceGroupDraft = ConditionTreeGroup<AudienceConditionDraft>;

export type AudienceNodeDraft = ConditionTreeNode<AudienceConditionDraft>;

export type AudienceMode = "all" | "match";

export interface AudienceDraft {
  mode: AudienceMode;
  filter: AudienceGroupDraft;
}

/** 所屬組織可選的來源(呼叫端依使用處宣告;dynamic 帶顯示名稱)。 */
export type AudienceOrgSourceOption =
  | { kind: "static" }
  | { kind: "dynamic"; ref: AudienceDynamicRef; label: string };

/** 新條件列:所屬組織預設「本身」,值先給第一個可用來源(指定組織 = 空清單,等使用者挑)。 */
export const newAudienceCondition = (
  field: AudienceField,
  orgSources: readonly AudienceOrgSourceOption[] = [{ kind: "static" }],
): AudienceConditionDraft => {
  if (field !== "org") {
    return { kind: "condition", field, value: { kind: "static", values: [] } };
  }
  const first = orgSources.at(0);
  return {
    kind: "condition",
    field,
    value:
      first?.kind === "dynamic"
        ? { kind: "dynamic", ref: first.ref }
        : { kind: "static", values: [] },
    range: "self",
  };
};

/** 起始狀態:`allowAll` 的使用處預設「所有人」(條件樹先備好一列,切過去就能填)。 */
export const newAudienceDraft = (
  field: AudienceField,
  {
    allowAll,
    orgSources,
  }: {
    allowAll: boolean;
    orgSources?: readonly AudienceOrgSourceOption[];
  },
): AudienceDraft => ({
  mode: allowAll ? "all" : "match",
  filter: groupOf(newAudienceCondition(field, orgSources)),
});

// ---- JSON → 編輯器狀態 ----

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toValueDraft = (value: unknown): AudienceValueDraft => {
  if (isRecord(value) && value.kind === "dynamic") {
    return { kind: "dynamic", ref: String(value.ref) as AudienceDynamicRef };
  }
  const values =
    isRecord(value) && Array.isArray(value.values) ? value.values : [];
  return { kind: "static", values: values.map(String) };
};

const toNodeDraft = (node: unknown): AudienceNodeDraft => {
  if (!isRecord(node)) {
    return { kind: "group", op: "AND", children: [] };
  }
  if ("children" in node || "op" in node) {
    const children = Array.isArray(node.children) ? node.children : [];
    return {
      kind: "group",
      op: node.op === "OR" ? "OR" : "AND",
      children: children.map((child) => toNodeDraft(child)),
    };
  }
  const range = (AUDIENCE_ORG_RANGES as readonly unknown[]).includes(node.range)
    ? (node.range as AudienceOrgRange)
    : undefined;
  return {
    kind: "condition",
    field: String(node.field) as AudienceField,
    value: toValueDraft(node.value),
    ...(range === undefined ? {} : { range }),
  };
};

/**
 * 人員條件 JSON → 編輯器狀態。`fallbackField` 給「所有人」時預備的那一列用(使用處的第一個欄位)。
 * 認不得的 `mode` 一律當「符合條件」讀(畫面照樣顯示,送出時由 api 的 `AUDIENCE_INVALID` 擋)。
 */
export const toAudienceDraft = (
  audience: unknown,
  fallbackField: AudienceField,
  orgSources?: readonly AudienceOrgSourceOption[],
): AudienceDraft => {
  if (isRecord(audience) && audience.mode === "all") {
    return {
      mode: "all",
      filter: groupOf(newAudienceCondition(fallbackField, orgSources)),
    };
  }
  const node = toNodeDraft(isRecord(audience) ? audience.filter : undefined);
  return {
    mode: "match",
    filter:
      node.kind === "group"
        ? node
        : { kind: "group", op: "AND", children: [node] },
  };
};

// ---- 編輯器狀態 → JSON ----

const toNodeJson = (node: AudienceNodeDraft): Record<string, unknown> => {
  if (node.kind === "group") {
    return {
      op: node.op,
      children: node.children.map((child) => toNodeJson(child)),
    };
  }
  return {
    field: node.field,
    cond: "in",
    value:
      node.value.kind === "dynamic"
        ? { kind: "dynamic", ref: node.value.ref }
        : { kind: "static", values: [...node.value.values] },
    ...(node.field === "org" ? { range: node.range ?? "self" } : {}),
  };
};

/** 「所有人」送出時不帶條件樹(畫面上收起的那一份只是暫存)。 */
export const toAudienceJson = (
  draft: AudienceDraft,
): Record<string, unknown> =>
  draft.mode === "all"
    ? { mode: "all" }
    : { mode: "match", filter: toNodeJson(draft.filter) };

// ---- 本地驗證與錯誤定位 ----

/**
 * 問題標在哪一格:`mode`(二選一本身)、`group`(群組)、條件列的 `field` / `value` / `range`,
 * 或 `node`(路徑只指到節點本身,條件列與群組都會看這一格)。
 */
export type AudienceIssueTarget =
  "mode" | "group" | "node" | "field" | "value" | "range";

export interface AudienceIssueLocation {
  childPath: readonly number[];
  target: AudienceIssueTarget;
}

export const audienceIssueKey = (
  childPath: readonly number[],
  target: AudienceIssueTarget,
): string => `${childPathKey(childPath)}:${target}`;

const groupIssues = (
  group: AudienceGroupDraft,
  childPath: readonly number[],
): AudienceIssueLocation[] => {
  if (group.children.length === 0) {
    return [{ childPath, target: "group" }];
  }
  return group.children.flatMap((child, index) => {
    const path = [...childPath, index];
    if (child.kind === "group") {
      return groupIssues(child, path);
    }
    return child.value.kind === "static" && child.value.values.length === 0
      ? [{ childPath: path, target: "value" as const }]
      : [];
  });
};

/**
 * 送出前的本地驗證(編輯器做得出來的那幾種):空群組、條件列沒挑值。
 * 「所有人」不檢查條件樹(送出時不帶它)。
 */
export const validateAudienceDraft = (
  draft: AudienceDraft,
): AudienceIssueLocation[] =>
  draft.mode === "all" ? [] : groupIssues(draft.filter, []);

const ROW_TARGETS: ReadonlySet<string> = new Set(["field", "value", "range"]);

/**
 * api 錯誤的路徑(從人員條件根算起,如 `filter.children[1].value.values[0]`、`mode`)→ 標在哪一格。
 * `cond` 畫面上只有一種(屬於 / 持有),錯在它時標在整列(`node`)。
 */
export const audienceIssueFromPath = (path: string): AudienceIssueLocation => {
  if (!path.startsWith("filter")) {
    return { childPath: [], target: "mode" };
  }
  const { childPath, rest } = locateInTree(path.slice("filter".length));
  const head = rest.split(/[.[]/, 1)[0] ?? "";
  if (ROW_TARGETS.has(head)) {
    return { childPath, target: head as AudienceIssueTarget };
  }
  if (head === "op" || head === "children") {
    return { childPath, target: "group" };
  }
  return { childPath, target: "node" };
};
