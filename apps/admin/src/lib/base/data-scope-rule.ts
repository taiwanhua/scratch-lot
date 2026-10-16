import {
  DataScopeAudienceType,
  DataScopeCombineOp,
  DataScopeFieldType,
} from "@repo/graphql";

/**
 * 資料範圍規則編輯器的**純模型**(#210):型別目錄、編輯器狀態 ↔ api JSON、條件樹的增刪改。
 * 本地驗證與 `RULE_INVALID` 的定位在 `data-scope-issues.ts`(同一份模型,分檔是為了 max-lines)。
 *
 * 規則形狀的正本是 `docs/modules/data-scope.md`「`rules[].filter` 的 JSON 形狀」
 * (執行期正本 `apps/api/src/data-scope/data-scope-rule.ts`)。admin 不能 import api(STRUCT-01),
 * 所以「型別 → 運算子 → 值來源」這張表在這裡重寫一份;**改動時兩邊一起改**。
 *
 * 節點不帶自產的 id:位置(`ruleIndex` + 從規則根群組往下的 `childPath`)就是身分 —
 * 與 api 回的 `path` 同一套座標,錯誤標記不必再配對,也免得在 render 期動模組層計數器(REACT-06)。
 */

/** 條件樹群組節點的運算子(JSON 值,每層可切)。 */
export type DataScopeGroupOp = "AND" | "OR";

export const DATA_SCOPE_GROUP_OPS: readonly DataScopeGroupOp[] = ["AND", "OR"];

/** 運算子的 wire 值(`docs/modules/data-scope.md` 的表)。 */
export const DATA_SCOPE_CONDITIONS = [
  "in",
  "not-in",
  "between",
  "before",
  "after",
] as const;

export type DataScopeCondition = (typeof DATA_SCOPE_CONDITIONS)[number];

/** 型別 → 允許的運算子(ADR-0008 的表;UI 的「條件」下拉依此出選項)。 */
export const CONDITIONS_BY_TYPE: Record<
  DataScopeFieldType,
  readonly DataScopeCondition[]
> = {
  [DataScopeFieldType.Org]: ["in", "not-in"],
  [DataScopeFieldType.User]: ["in", "not-in"],
  [DataScopeFieldType.Date]: ["between", "before", "after"],
  [DataScopeFieldType.Enum]: ["in", "not-in"],
};

/** 動態值佔位符(查詢當下才代入正在查的人)。 */
export const DATA_SCOPE_DYNAMIC_REFS = [
  "current-user",
  "current-user-orgs",
] as const;

export type DataScopeDynamicRef = (typeof DATA_SCOPE_DYNAMIC_REFS)[number];

/** 型別 → 允許的動態值;date / enum 沒有動態值。 */
export const DYNAMIC_REFS_BY_TYPE: Record<
  DataScopeFieldType,
  readonly DataScopeDynamicRef[]
> = {
  [DataScopeFieldType.Org]: ["current-user-orgs"],
  [DataScopeFieldType.User]: ["current-user"],
  [DataScopeFieldType.Date]: [],
  [DataScopeFieldType.Enum]: [],
};

/** 欄位目錄的一欄(`dataScopeTargets` 的 `fields[]`,結構相容即可)。 */
export interface DataScopeFieldLike {
  name: string;
  label: string;
  type: DataScopeFieldType;
  options: readonly { value: string; label: string }[];
}

export type DataScopeValueDraft =
  | { kind: "static"; values: string[] }
  | { kind: "dynamic"; ref: DataScopeDynamicRef };

export interface ConditionDraft {
  kind: "condition";
  field: string;
  cond: DataScopeCondition;
  value: DataScopeValueDraft;
}

export interface GroupDraft {
  kind: "group";
  op: DataScopeGroupOp;
  children: NodeDraft[];
}

export type NodeDraft = GroupDraft | ConditionDraft;

export interface AudienceDraft {
  type: DataScopeAudienceType;
  ids: string[];
}

export interface RuleDraft {
  audience: AudienceDraft;
  /** 規則的根群組 = api 的 `filter`(編輯器一律以群組為根,「條件組合」就是它的 `op`)。 */
  filter: GroupDraft;
}

export interface RuleEditorDraft {
  combineOp: DataScopeCombineOp;
  rules: RuleDraft[];
}

/** 送出時的一筆規則(對應 `DataScopeRuleEntryInput`)。 */
export interface RuleEntryInput {
  audience: { type: DataScopeAudienceType; ids: string[] };
  filter: Record<string, unknown>;
}

/** 尚無規則時的起始狀態(頂層合成預設 OR,與 `SaveDataScopeRuleInput` 的預設一致)。 */
export const emptyEditorDraft = (): RuleEditorDraft => ({
  combineOp: DataScopeCombineOp.Or,
  rules: [],
});

// ---- api JSON → 編輯器狀態 ----

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toValueDraft = (value: unknown): DataScopeValueDraft => {
  if (isRecord(value) && value.kind === "dynamic") {
    return { kind: "dynamic", ref: value.ref as DataScopeDynamicRef };
  }
  const values =
    isRecord(value) && Array.isArray(value.values) ? value.values : [];
  return { kind: "static", values: values.map(String) };
};

const toNodeDraft = (node: unknown): NodeDraft => {
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
  return {
    kind: "condition",
    field: typeof node.field === "string" ? node.field : "",
    cond: node.cond as DataScopeCondition,
    value: toValueDraft(node.value),
  };
};

/**
 * api 的 `filter` 轉成規則的根群組。JSON 形狀沒有禁止根節點直接是條件列,而編輯器的根一律是群組,
 * 所以這種資料**包一層 AND 群組**再顯示(單一條件的 AND,語意相同)。
 */
const toFilterDraft = (filter: unknown): GroupDraft => {
  const node = toNodeDraft(filter);
  return node.kind === "group"
    ? node
    : { kind: "group", op: "AND", children: [node] };
};

/** `dataScopeRule` 的回傳(`rule = null` → 尚無規則)轉成編輯器狀態。 */
export const toEditorDraft = (
  rule:
    | {
        combineOp: DataScopeCombineOp;
        rules: readonly {
          audience: { type: DataScopeAudienceType; ids: readonly string[] };
          filter: Record<string, unknown>;
        }[];
      }
    | null
    | undefined,
): RuleEditorDraft =>
  rule === null || rule === undefined
    ? emptyEditorDraft()
    : {
        combineOp: rule.combineOp,
        rules: rule.rules.map((entry) => ({
          audience: { type: entry.audience.type, ids: [...entry.audience.ids] },
          filter: toFilterDraft(entry.filter),
        })),
      };

// ---- 編輯器狀態 → api JSON ----

const toFilterJson = (node: NodeDraft): Record<string, unknown> => {
  if (node.kind === "group") {
    return {
      op: node.op,
      children: node.children.map((child) => toFilterJson(child)),
    };
  }
  return {
    field: node.field,
    cond: node.cond,
    value:
      node.value.kind === "dynamic"
        ? { kind: "dynamic", ref: node.value.ref }
        : { kind: "static", values: [...node.value.values] },
  };
};

/** 整份覆蓋:畫面上留著的就是之後生效的全部(`rules: []` = 刪掉這個目標的規則)。 */
export const toRuleEntryInputs = (draft: RuleEditorDraft): RuleEntryInput[] =>
  draft.rules.map((rule) => ({
    audience: {
      type: rule.audience.type,
      ids:
        rule.audience.type === DataScopeAudienceType.All
          ? []
          : [...rule.audience.ids],
    },
    filter: toFilterJson(rule.filter),
  }));

// ---- 節點的建立與樹操作(位置 = 身分) ----

/** 新條件列的預設:給定欄位、該型別的第一個運算子、空的靜態值。 */
export const newCondition = (field: DataScopeFieldLike): ConditionDraft => ({
  kind: "condition",
  field: field.name,
  cond: CONDITIONS_BY_TYPE[field.type][0] ?? "in",
  value: {
    kind: "static",
    values: field.type === DataScopeFieldType.Date ? [""] : [],
  },
});

/** 新群組帶一條條件列:空群組不合法(`EMPTY_GROUP`),不讓它先出現在畫面上。 */
export const newGroup = (field: DataScopeFieldLike): GroupDraft => ({
  kind: "group",
  op: "AND",
  children: [newCondition(field)],
});

/** 新規則:套用對象預設「全部」,條件樹是一個 AND 群組加一條條件列。 */
export const newRule = (field: DataScopeFieldLike): RuleDraft => ({
  audience: { type: DataScopeAudienceType.All, ids: [] },
  filter: newGroup(field),
});

/**
 * 換運算子:`between` 要兩個日期、其餘一個,靜態值依此裁切 / 補位;
 * 非日期型別的 in / not-in 值都是清單,不需要調整。
 */
export const withCondition = (
  condition: ConditionDraft,
  cond: DataScopeCondition,
  type: DataScopeFieldType,
): ConditionDraft => {
  if (type !== DataScopeFieldType.Date) {
    return { ...condition, cond };
  }
  const size = cond === "between" ? 2 : 1;
  const values =
    condition.value.kind === "static" ? condition.value.values : [];
  return {
    ...condition,
    cond,
    value: {
      kind: "static",
      values: Array.from({ length: size }, (_, index) => values[index] ?? ""),
    },
  };
};

const replaceAt = <T>(items: readonly T[], index: number, next: T): T[] =>
  items.map((item, position) => (position === index ? next : item));

/** 依 `childPath` 取節點;空路徑就是根群組,路徑走不到回 `undefined`。 */
export const nodeAt = (
  group: GroupDraft,
  childPath: readonly number[],
): NodeDraft | undefined => {
  let current: NodeDraft = group;
  for (const index of childPath) {
    if (current.kind !== "group" || index >= current.children.length) {
      return undefined;
    }
    current = current.children[index];
  }
  return current;
};

/** 依 `childPath` 換掉一個節點(回傳新的根群組);`next` 為 null 代表刪除該節點。 */
export const replaceNode = (
  group: GroupDraft,
  childPath: readonly number[],
  next: NodeDraft | null,
): GroupDraft => {
  if (childPath.length === 0) {
    return next !== null && next.kind === "group" ? next : group;
  }
  const [index, ...rest] = childPath;
  if (index >= group.children.length) {
    return group;
  }
  if (rest.length === 0) {
    return {
      ...group,
      children:
        next === null
          ? group.children.filter((_, position) => position !== index)
          : replaceAt(group.children, index, next),
    };
  }
  const child = group.children[index];
  return child.kind === "group"
    ? {
        ...group,
        children: replaceAt(
          group.children,
          index,
          replaceNode(child, rest, next),
        ),
      }
    : group;
};

/** 在 `childPath` 指到的群組尾端加一個節點。 */
export const appendChild = (
  group: GroupDraft,
  childPath: readonly number[],
  node: NodeDraft,
): GroupDraft => {
  const target = nodeAt(group, childPath);
  if (target?.kind !== "group") {
    return group;
  }
  return replaceNode(group, childPath, {
    ...target,
    children: [...target.children, node],
  });
};

/** 錯誤標記與 React key 共用的座標字串。 */
export const nodeKey = (
  ruleIndex: number,
  childPath: readonly number[],
): string => `${String(ruleIndex)}:${childPath.join(".")}`;
