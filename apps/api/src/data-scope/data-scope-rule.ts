import { Types } from "mongoose";

import {
  AUDIENCE_FIELDS,
  type Audience,
  type AudienceOptions,
  validateAudience as validateAudienceShape,
} from "@repo/domain/audience";
import {
  type LocalDate,
  addLocalDays,
  localDateOf,
  startOfLocalDay,
  toInstant,
} from "@repo/domain/form";

/**
 * 資料範圍規則的**型別目錄與純邏輯**(ADR-0008 的「型別 → 運算子 → 值來源」表的程式正本):
 * 欄位目錄、驗證、套用對象命中、條件樹編譯成 Mongo filter。
 *
 * 這裡沒有 Nest、沒有資料庫:輸入是「規則 JSON + 欄位目錄 + 操作者事實」,輸出是條件或錯誤。
 * 執行面(快取、讀規則、掛進查詢中介層)在 `data-scope.service.ts` 與
 * `database/plugins/tenant-scope.plugin.ts`。
 *
 * **翻譯器不認識個別欄位**(ADR-0008):能用哪些運算子、值可以是什麼,一律由欄位的**型別**決定。
 */

/** 可篩欄位的型別(ADR-0008 的表;seed 宣告與基礎欄位都只能用這四種)。 */
export const DATA_SCOPE_FIELD_TYPES = ["org", "user", "date", "enum"] as const;

export type DataScopeFieldType = (typeof DATA_SCOPE_FIELD_TYPES)[number];

/** 全部運算子(ADR-0008:org/user/enum 的 in、not in;date 的之間 / 之前 / 之後)。 */
export const DATA_SCOPE_CONDITIONS = [
  "in",
  "not-in",
  "between",
  "before",
  "after",
] as const;

export type DataScopeCondition = (typeof DATA_SCOPE_CONDITIONS)[number];

/** 型別 → 允許的運算子(ADR-0008 的表;UI 依此出下拉)。 */
export const CONDITIONS_BY_TYPE: Record<
  DataScopeFieldType,
  readonly DataScopeCondition[]
> = {
  org: ["in", "not-in"],
  user: ["in", "not-in"],
  date: ["between", "before", "after"],
  enum: ["in", "not-in"],
};

/** 動態值佔位符(ADR-0008:存佔位符,查詢當下代入正在查的人)。 */
export const DATA_SCOPE_DYNAMIC_REFS = [
  "current-user",
  "current-user-orgs",
] as const;

export type DataScopeDynamicRef = (typeof DATA_SCOPE_DYNAMIC_REFS)[number];

/** 型別 → 允許的動態值(ADR-0008 的「值來源」欄;沒列的型別只能給靜態值)。 */
export const DYNAMIC_REFS_BY_TYPE: Record<
  DataScopeFieldType,
  readonly DataScopeDynamicRef[]
> = {
  org: ["current-user-orgs"],
  user: ["current-user"],
  date: [],
  enum: [],
};

/**
 * 套用對象 = 人員條件(`@repo/domain/audience`):可選「所有人」、四個欄位(使用者 / 角色 / 所屬組織 / 權限)
 * 都能用,所屬組織只能指定組織(資料範圍由 root 設定,沒有單據 / 事件可代入)。
 */
export const DATA_SCOPE_AUDIENCE_OPTIONS: AudienceOptions = {
  allowAll: true,
  fields: AUDIENCE_FIELDS,
  orgSources: ["static"],
};

/** 條件樹的群組節點運算子(每層可切,ADR-0008)。 */
export const DATA_SCOPE_GROUP_OPS = ["AND", "OR"] as const;

export type DataScopeGroupOp = (typeof DATA_SCOPE_GROUP_OPS)[number];

/** 一個 enum 欄位的固定選項(seed 宣告)。 */
export interface DataScopeFieldOption {
  value: string;
  label: string;
}

/** 欄位目錄的一欄(seed 宣告的業務欄位,或底座自動掛入的基礎欄位)。 */
export interface DataScopeField {
  name: string;
  label: string;
  type: DataScopeFieldType;
  /** 只有 `enum` 型別有值。 */
  options?: DataScopeFieldOption[];
  /** 底座自動掛入的基礎欄位(ADR-0007),非 seed 宣告。 */
  isBase?: boolean;
}

/**
 * 基礎欄位目錄(ADR-0008「基礎欄位由底座自動掛進目錄」;欄位本身由 ADR-0007 的
 * `baseFieldsPlugin` + 租戶隔離的 `orgId` 保證每張業務表都有)。
 * 存進 `data_scope_targets` 的只有 seed 宣告的業務欄位,這六欄查詢時才附加。
 */
export const BASE_DATA_SCOPE_FIELDS: readonly DataScopeField[] = [
  { name: "orgId", label: "組織", type: "org", isBase: true },
  { name: "createdBy", label: "建立者", type: "user", isBase: true },
  { name: "updatedBy", label: "更新者", type: "user", isBase: true },
  { name: "createdAt", label: "建立時間", type: "date", isBase: true },
  { name: "updatedAt", label: "更新時間", type: "date", isBase: true },
  { name: "deletedAt", label: "刪除時間", type: "date", isBase: true },
];

/** 值:靜態清單,或動態佔位符。 */
export type DataScopeValue =
  | { kind: "static"; values: string[] }
  | { kind: "dynamic"; ref: DataScopeDynamicRef };

export interface DataScopeLeaf {
  field: string;
  cond: DataScopeCondition;
  value: DataScopeValue;
}

export interface DataScopeGroup {
  op: DataScopeGroupOp;
  children: DataScopeNode[];
}

export type DataScopeNode = DataScopeGroup | DataScopeLeaf;

/** 套用對象(人員條件;形狀正本 `@repo/domain/audience`)。 */
export type DataScopeAudience = Audience;

export interface DataScopeRuleEntry {
  audience: DataScopeAudience;
  filter: DataScopeNode;
}

/**
 * 規則不合法的原因(`RULE_INVALID` 的 `extensions.reason`;前端依此顯示中文並標在條件列上)。
 * 每一條都對應 ADR-0008 的一句規定,新增時同步回寫 `docs/standards/api/graphql-schema.md` GQL-04。
 */
export const RULE_INVALID_REASONS = [
  /** 節點既不是群組(op + children)也不是條件列(field + cond + value) */
  "MALFORMED_NODE",
  /** 群組的 children 是空的 —「什麼都不限制」與「什麼都看不到」語意含糊,一律拒絕 */
  "EMPTY_GROUP",
  /** 欄位不在該資料目標的欄位目錄裡(含基礎欄位) */
  "UNKNOWN_FIELD",
  /** 運算子不在該欄位型別允許的清單裡(CONDITIONS_BY_TYPE) */
  "CONDITION_NOT_ALLOWED",
  /** 值來源不符型別:給了該型別不支援的動態值,或 kind 不是 static / dynamic */
  "VALUE_SOURCE_NOT_ALLOWED",
  /** 值本身不合法:空清單、id 不是 ObjectId、日期不是帶時區的 ISO 時點、between 不是兩個、enum 不在選項內 */
  "VALUE_INVALID",
  /**
   * 套用對象不合法(人員條件的格式):`mode` 不認得、`match` 沒有條件列(含空群組)、
   * 欄位不在清單、值不合法、群組超過 3 層;`path` 指到出錯的條件列
   */
  "AUDIENCE_INVALID",
  /** rules 不是陣列、單筆不是物件、缺 audience / filter */
  "MALFORMED_RULE",
] as const;

export type RuleInvalidReason = (typeof RULE_INVALID_REASONS)[number];

/** 驗證失敗的單一結果:`path` 指到出問題的位置(如 `rules[0].filter.children[1].value`)。 */
export interface RuleViolation {
  path: string;
  reason: RuleInvalidReason;
  /** 給開發者看的英文補充(GQL-04:使用者文案由前端依 reason 對應)。 */
  detail: string;
}

/**
 * 查詢當下代入動態值所需的操作者事實(來自 OperatorContext)。
 * 套用對象的比對不在這裡:由 `AudienceService.matchesAudience` 判斷(人員條件,與審核者 / 通知同一份)。
 */
export interface DataScopeOperatorFacts {
  actorId: Types.ObjectId | null;
  /** 所屬組織(org_user);動態值【操作者的所屬組織】用它。 */
  memberOrgIds: readonly Types.ObjectId[];
}

/**
 * 日期條件換算用的兩個租戶時區(都已驗過;來源與退回規則見 `database/tenant-timezone.ts`)。
 * 根組織自己查資料時兩個相同。
 */
export interface DataScopeTimezones {
  /** 規則作者 = 規則所屬組織(根組織)的租戶時區:把存的時點還原成日曆天。 */
  rule: string;
  /** 操作者所在租戶的時區:那個日曆天在這裡的 00:00 與次日 00:00 當邊界。 */
  operator: string;
}

/** 編譯後要 AND 進查詢的 Mongo 條件(欄位名 → 條件運算式)。 */
export type MongoCondition = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGroupNode(node: Record<string, unknown>): boolean {
  return "op" in node || "children" in node;
}

/**
 * 欄位目錄 = seed 宣告的業務欄位 + 底座自動掛入的基礎欄位(ADR-0008)。
 * 同名時以 seed 宣告優先(模組自己宣告了 `createdBy` 就用它的標籤 / 型別)。
 */
export function fieldCatalogOf(
  declared: readonly DataScopeField[],
): DataScopeField[] {
  const byName = new Map<string, DataScopeField>();
  for (const field of BASE_DATA_SCOPE_FIELDS) {
    byName.set(field.name, field);
  }
  for (const field of declared) {
    byName.set(field.name, field);
  }
  // 目錄順序:seed 宣告的在前(頁面上先看到業務欄位),基礎欄位殿後
  const declaredNames = new Set(declared.map((field) => field.name));
  return [
    ...declared.map((field) => byName.get(field.name) ?? field),
    ...BASE_DATA_SCOPE_FIELDS.filter((field) => !declaredNames.has(field.name)),
  ];
}

// ---- 驗證(saveDataScopeRule) ----

/**
 * 驗證整份規則;回傳第一個違規(沒有違規則 undefined)。
 * 整份覆蓋的語意讓「只驗到第一個錯」夠用:編輯器一次只送一份,修掉再送。
 */
export function validateRules(
  rules: unknown,
  catalog: readonly DataScopeField[],
): RuleViolation | undefined {
  if (!Array.isArray(rules)) {
    return {
      path: "rules",
      reason: "MALFORMED_RULE",
      detail: "rules must be an array",
    };
  }
  const byName = new Map(catalog.map((field) => [field.name, field]));
  for (const [index, entry] of rules.entries()) {
    const violation = validateRuleEntry(
      entry,
      byName,
      `rules[${String(index)}]`,
    );
    if (violation) {
      return violation;
    }
  }
  return undefined;
}

function validateRuleEntry(
  entry: unknown,
  byName: ReadonlyMap<string, DataScopeField>,
  path: string,
): RuleViolation | undefined {
  if (!isRecord(entry)) {
    return {
      path,
      reason: "MALFORMED_RULE",
      detail: "a rule must be an object with audience and filter",
    };
  }
  const audienceViolation = validateAudience(
    entry.audience,
    `${path}.audience`,
  );
  if (audienceViolation) {
    return audienceViolation;
  }
  if (entry.filter === undefined) {
    return {
      path: `${path}.filter`,
      reason: "MALFORMED_RULE",
      detail: "filter is required",
    };
  }
  return validateNode(entry.filter, byName, `${path}.filter`);
}

/** 套用對象:人員條件的格式檢查(`@repo/domain/audience`),錯誤一律 `AUDIENCE_INVALID`。 */
function validateAudience(
  audience: unknown,
  path: string,
): RuleViolation | undefined {
  const result = validateAudienceShape(audience, DATA_SCOPE_AUDIENCE_OPTIONS);
  if (result.ok) {
    return undefined;
  }
  return {
    path: result.issue.path === "" ? path : `${path}.${result.issue.path}`,
    reason: "AUDIENCE_INVALID",
    detail: result.issue.message,
  };
}

function validateNode(
  node: unknown,
  byName: ReadonlyMap<string, DataScopeField>,
  path: string,
): RuleViolation | undefined {
  if (!isRecord(node)) {
    return {
      path,
      reason: "MALFORMED_NODE",
      detail: "a filter node must be an object",
    };
  }
  return isGroupNode(node)
    ? validateGroup(node, byName, path)
    : validateLeaf(node, byName, path);
}

function validateGroup(
  node: Record<string, unknown>,
  byName: ReadonlyMap<string, DataScopeField>,
  path: string,
): RuleViolation | undefined {
  const op = node.op;
  if (
    typeof op !== "string" ||
    !(DATA_SCOPE_GROUP_OPS as readonly string[]).includes(op)
  ) {
    return {
      path: `${path}.op`,
      reason: "MALFORMED_NODE",
      detail: `group op must be one of ${DATA_SCOPE_GROUP_OPS.join(" / ")}`,
    };
  }
  const children = node.children;
  if (!Array.isArray(children)) {
    return {
      path: `${path}.children`,
      reason: "MALFORMED_NODE",
      detail: "group children must be an array",
    };
  }
  if (children.length === 0) {
    return {
      path: `${path}.children`,
      reason: "EMPTY_GROUP",
      detail: "a group must have at least one child",
    };
  }
  for (const [index, child] of children.entries()) {
    const violation = validateNode(
      child,
      byName,
      `${path}.children[${String(index)}]`,
    );
    if (violation) {
      return violation;
    }
  }
  return undefined;
}

function validateLeaf(
  node: Record<string, unknown>,
  byName: ReadonlyMap<string, DataScopeField>,
  path: string,
): RuleViolation | undefined {
  const name = node.field;
  if (typeof name !== "string") {
    return {
      path: `${path}.field`,
      reason: "MALFORMED_NODE",
      detail: "field must be a string",
    };
  }
  const field = byName.get(name);
  if (!field) {
    return {
      path: `${path}.field`,
      reason: "UNKNOWN_FIELD",
      detail: `field ${name} is not in the target's field catalog`,
    };
  }
  const cond = node.cond;
  if (
    typeof cond !== "string" ||
    !(CONDITIONS_BY_TYPE[field.type] as readonly string[]).includes(cond)
  ) {
    return {
      path: `${path}.cond`,
      reason: "CONDITION_NOT_ALLOWED",
      detail: `field ${name} is ${field.type}; allowed conditions are ${CONDITIONS_BY_TYPE[field.type].join(" / ")}`,
    };
  }
  return validateValue(
    node.value,
    field,
    cond as DataScopeCondition,
    `${path}.value`,
  );
}

function validateValue(
  value: unknown,
  field: DataScopeField,
  cond: DataScopeCondition,
  path: string,
): RuleViolation | undefined {
  if (!isRecord(value)) {
    return {
      path,
      reason: "VALUE_SOURCE_NOT_ALLOWED",
      detail: "value must be an object with kind static | dynamic",
    };
  }
  if (value.kind === "dynamic") {
    return validateDynamicValue(value, field, path);
  }
  if (value.kind !== "static") {
    return {
      path: `${path}.kind`,
      reason: "VALUE_SOURCE_NOT_ALLOWED",
      detail: "value.kind must be static or dynamic",
    };
  }
  return validateStaticValue(value, field, cond, path);
}

function validateDynamicValue(
  value: Record<string, unknown>,
  field: DataScopeField,
  path: string,
): RuleViolation | undefined {
  const allowed = DYNAMIC_REFS_BY_TYPE[field.type];
  const ref = value.ref;
  if (
    typeof ref !== "string" ||
    !(allowed as readonly string[]).includes(ref)
  ) {
    return {
      path: `${path}.ref`,
      reason: "VALUE_SOURCE_NOT_ALLOWED",
      detail:
        allowed.length === 0
          ? `field ${field.name} is ${field.type} and takes no dynamic value`
          : `field ${field.name} only accepts dynamic ref ${allowed.join(" / ")}`,
    };
  }
  return undefined;
}

function validateStaticValue(
  value: Record<string, unknown>,
  field: DataScopeField,
  cond: DataScopeCondition,
  path: string,
): RuleViolation | undefined {
  const values = value.values;
  if (!Array.isArray(values) || values.length === 0) {
    return {
      path: `${path}.values`,
      reason: "VALUE_INVALID",
      detail: "value.values is required and must not be empty",
    };
  }
  if (values.some((item) => typeof item !== "string")) {
    return {
      path: `${path}.values`,
      reason: "VALUE_INVALID",
      detail: "value.values must be strings (ids / ISO instants / enum values)",
    };
  }
  const items = values as string[];
  if (field.type === "org" || field.type === "user") {
    const bad = items.findIndex((item) => !Types.ObjectId.isValid(item));
    return bad === -1
      ? undefined
      : {
          path: `${path}.values[${String(bad)}]`,
          reason: "VALUE_INVALID",
          detail: `field ${field.name} is ${field.type}; values must be object ids`,
        };
  }
  if (field.type === "enum") {
    const options = new Set((field.options ?? []).map((item) => item.value));
    const bad = items.findIndex((item) => !options.has(item));
    return bad === -1
      ? undefined
      : {
          path: `${path}.values[${String(bad)}]`,
          reason: "VALUE_INVALID",
          detail: `${String(items[bad])} is not one of the declared options of ${field.name}`,
        };
  }
  return validateDateValues(items, cond, path);
}

function validateDateValues(
  values: string[],
  cond: DataScopeCondition,
  path: string,
): RuleViolation | undefined {
  const expected = cond === "between" ? 2 : 1;
  if (values.length !== expected) {
    return {
      path: `${path}.values`,
      reason: "VALUE_INVALID",
      detail: `${cond} expects exactly ${String(expected)} date value(s)`,
    };
  }
  // 只收時點(帶時區的 ISO 8601,與表單引擎的日期存值同一種);`YYYY-MM-DD` 沒有時區、語意不明,一律拒
  const bad = values.findIndex((item) => toInstant(item) === null);
  return bad === -1
    ? undefined
    : {
        path: `${path}.values[${String(bad)}]`,
        reason: "VALUE_INVALID",
        detail:
          "date values must be ISO 8601 instants with a time zone (the picked day at 00:00 in the tenant time zone)",
      };
}

/** 規則裡有沒有日期條件(執行面據此決定要不要查兩個租戶時區)。 */
export function hasDateCondition(
  rules: readonly DataScopeRuleEntry[],
  catalog: readonly DataScopeField[],
): boolean {
  const dateFields = new Set(
    catalog.filter((field) => field.type === "date").map((field) => field.name),
  );
  const visit = (node: DataScopeNode): boolean =>
    "children" in node
      ? node.children.some((child) => visit(child))
      : dateFields.has(node.field);
  return rules.some((rule) => visit(rule.filter));
}

// ---- 執行(查詢中介層) ----

/**
 * 把**已命中操作者**的規則(套用對象由呼叫端以 `AudienceService.matchesAudience` 篩過)
 * 編譯成要 AND 進查詢的 Mongo 條件;一條都沒有 → `null`
 * (ADR-0008:「沒有規則命中操作者 → 預設 = 可見範圍內」,也就是只剩租戶保底)。
 * `timezones` 只有日期條件用得到(見 `compileDateLeaf`)。
 */
export function compileRules(
  rules: readonly DataScopeRuleEntry[],
  combineOp: DataScopeGroupOp,
  catalog: readonly DataScopeField[],
  facts: DataScopeOperatorFacts,
  timezones: DataScopeTimezones,
): MongoCondition | null {
  const byName = new Map(catalog.map((field) => [field.name, field]));
  const matched = rules.map((rule) =>
    compileNode(rule.filter, byName, facts, timezones),
  );
  if (matched.length === 0) {
    return null;
  }
  const [only] = matched;
  if (only && matched.length === 1) {
    return only;
  }
  return combineOp === "AND" ? { $and: matched } : { $or: matched };
}

function compileNode(
  node: DataScopeNode,
  byName: ReadonlyMap<string, DataScopeField>,
  facts: DataScopeOperatorFacts,
  timezones: DataScopeTimezones,
): MongoCondition {
  if ("children" in node) {
    const children = node.children.map((child) =>
      compileNode(child, byName, facts, timezones),
    );
    return node.op === "AND" ? { $and: children } : { $or: children };
  }
  return compileLeaf(node, byName, facts, timezones);
}

function compileLeaf(
  leaf: DataScopeLeaf,
  byName: ReadonlyMap<string, DataScopeField>,
  facts: DataScopeOperatorFacts,
  timezones: DataScopeTimezones,
): MongoCondition {
  // 驗證已保證欄位在目錄內;防守性地以 enum 當退路(不會讓條件放寬)
  const field = byName.get(leaf.field);
  const type = field?.type ?? "enum";
  if (type === "date") {
    return compileDateLeaf(leaf, timezones);
  }
  const values = resolveValues(leaf.value, type, facts);
  switch (leaf.cond) {
    case "in": {
      return { [leaf.field]: { $in: values } };
    }
    case "not-in": {
      return { [leaf.field]: { $nin: values } };
    }
    default: {
      // 驗證不會放行(非日期型別只有 in / not-in);萬一出現,什麼都不命中
      return { [leaf.field]: { $in: [] } };
    }
  }
}

/**
 * 日期條件 → 時點範圍(與表單引擎的日期同一種做法,`docs/concepts/form-engine.md`「值、計算與條件」):
 * 條件是**日曆天,逐租戶套用** —— 「2/1」對每個租戶都是它自己時區的 2/1。
 *
 * 1. 存的值是「選的那一天在規則作者時區 00:00」的時點:先用 `timezones.rule` 還原成日曆天
 * 2. 再用 `timezones.operator` 算那一天的 00:00 與次日 00:00 當邊界(夏令時間切換日也對)
 *
 * - `before` D:`< D 當天 00:00`(D 當天不含)
 * - `after` D:`>= D 的次日 00:00`(D 當天不含)
 * - `between` A、B:`>= A 當天 00:00` 且 `< B 的次日 00:00`(兩端的整天都含)
 *
 * 值不是時點(遷移前的 `YYYY-MM-DD`、壞資料)→ 這個條件什麼都不命中(fail-closed:規則命中了卻算不出範圍,
 * 寧可看不到也不放寬)。
 */
function compileDateLeaf(
  leaf: DataScopeLeaf,
  timezones: DataScopeTimezones,
): MongoCondition {
  const instants =
    leaf.value.kind === "static"
      ? leaf.value.values.map((value) => toInstant(value))
      : [];
  const [from, to] = instants;
  const dayOf = (instant: number): LocalDate =>
    localDateOf(instant, timezones.rule);
  const dayStartOf = (instant: number): Date =>
    new Date(startOfLocalDay(dayOf(instant), timezones.operator));
  // 次日邊界 = 日曆天 +1(`addLocalDays`)後取操作者時區那一天的起點(不從當天 00:00 往後推時間:
  // 午夜切換夏令時間的時區,次日邊界才不會差 1 小時)
  const nextDayOf = (instant: number): Date =>
    new Date(
      startOfLocalDay(addLocalDays(dayOf(instant), 1), timezones.operator),
    );
  if (leaf.cond === "before" && typeof from === "number") {
    return { [leaf.field]: { $lt: dayStartOf(from) } };
  }
  if (leaf.cond === "after" && typeof from === "number") {
    return { [leaf.field]: { $gte: nextDayOf(from) } };
  }
  if (
    leaf.cond === "between" &&
    typeof from === "number" &&
    typeof to === "number"
  ) {
    return {
      [leaf.field]: { $gte: dayStartOf(from), $lt: nextDayOf(to) },
    };
  }
  return { [leaf.field]: { $in: [] } };
}

/**
 * 值來源 → 實際比對值(org / user / enum;日期走 `compileDateLeaf`):動態值在此代入正在查的人(ADR-0008),
 * 靜態值依型別轉型。
 * 動態值代入後可能是空陣列(操作者沒有登入主體 / 沒有所屬組織)— 這時 `$in: []` 命中不到任何資料,
 * 是刻意的 fail-closed:規則命中了卻算不出對象,寧可看不到也不放寬。
 */
function resolveValues(
  value: DataScopeValue,
  type: DataScopeFieldType,
  facts: DataScopeOperatorFacts,
): unknown[] {
  if (value.kind === "dynamic") {
    if (value.ref === "current-user-orgs") {
      return [...facts.memberOrgIds];
    }
    return facts.actorId === null ? [] : [facts.actorId];
  }
  if (type === "org" || type === "user") {
    return value.values.map((item) => new Types.ObjectId(item));
  }
  return [...value.values];
}

/** 某模組在這次查詢要套的條件(`compileRules` 的結果,已確定命中操作者)。 */
export interface ModuleCondition {
  moduleKey: string;
  condition: MongoCondition;
}

/**
 * 同一 collection 下多個模組的規則 → 一個要 AND 進查詢的條件(`docs/modules/data-scope.md`「依模組」):
 *
 * `{ $or: [ { moduleKey: { $exists: true, $nin: [有規則的模組] } }, { $and: [{ moduleKey: M }, M 的規則] }, … ] }`
 *
 * - 沒有規則命中操作者的模組不列進 `$nin` → 那些模組的資料維持只看可見範圍
 * - `$nin` 那一支要求 `moduleKey` **存在**:沒有 `moduleKey` 的文件(回填 migration 跑完前的舊資料)
 *   `$nin` 本來會命中,等於繞過規則;有規則命中操作者時,這種文件一律看不到(fail-closed)
 * - 固定欄位表只有一個 moduleKey,結果等於「該模組的規則」本身(外面多包一層 `$or`,語意相同)
 * - 一個模組都沒有 → `null`(不加條件)
 *
 * 各分支用 `$and` 包而不是把 `moduleKey` 與規則攤平在同一個物件:規則本身可以是任意條件,
 * 攤平會有同名鍵互相覆蓋的風險。
 */
export function combineByModule(
  conditions: readonly ModuleCondition[],
): MongoCondition | null {
  if (conditions.length === 0) {
    return null;
  }
  return {
    $or: [
      {
        moduleKey: {
          $exists: true,
          $nin: conditions.map((entry) => entry.moduleKey),
        },
      },
      ...conditions.map((entry) => ({
        $and: [{ moduleKey: entry.moduleKey }, entry.condition],
      })),
    ],
  };
}
