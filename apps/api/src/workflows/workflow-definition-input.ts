import type { Audience } from "@repo/domain/audience";
import type { Expression } from "@repo/domain/form";
import {
  type AssigneeSource,
  REVIEW_STEP_PROPS,
  type SkipOrgsDef,
  type StepDef,
  type WorkflowDefinition,
  type WorkflowEdge,
} from "@repo/domain/workflow";

/**
 * 設計器送來的流程定義(`definition: { steps, edges? }`,`steps` 是 JSON 物件陣列)→
 * `@repo/domain/workflow` 的形狀。**只做型別上的整形,不判對錯**:對錯交給檢查器
 * (`validateWorkflowDefinition`),所以這裡保留所有會被檢查器指出的東西(未知的 `kind`、
 * 匯合節點帶了審核屬性、不合法的會簽模式…),只把「讀了會讓檢查器本身丟錯」的地方補成安全值
 * (缺 `key` → 空字串、`assignee` 不是物件 → 種類不明)。草稿讀寫、fork、發布快照都存整形後的結果,
 * 節點的 `kind` 與 `edges` 全程保留。
 */

type Raw = Record<string, unknown>;

function isObject(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function assigneeOf(raw: unknown): AssigneeSource {
  if (!isObject(raw)) {
    return { kind: "" } as unknown as AssigneeSource;
  }
  switch (raw.kind) {
    case "audience": {
      // 人員條件原樣保留(格式交給檢查器的 `AUDIENCE_INVALID`)
      return {
        kind: "audience",
        audience: raw.audience as Audience,
      };
    }
    case "field": {
      return {
        kind: "field",
        formKey: text(raw.formKey),
        fieldKey: text(raw.fieldKey),
      };
    }
    case "manager": {
      return {
        kind: "manager",
        level: typeof raw.level === "number" ? raw.level : Number.NaN,
      };
    }
    default: {
      return { kind: text(raw.kind) } as unknown as AssigneeSource;
    }
  }
}

function stepOf(raw: unknown): StepDef {
  const step = isObject(raw) ? raw : {};
  const base = { key: text(step.key), name: text(step.name) };
  if (step.kind === "join") {
    // 帶了審核屬性照樣保留,讓檢查器指出 `JOIN_HAS_REVIEW_PROPS`
    const extras = Object.fromEntries(
      REVIEW_STEP_PROPS.filter((property) => step[property] !== undefined).map(
        (property) => [property, step[property]],
      ),
    );
    return { ...base, kind: "join", ...extras };
  }
  return {
    ...base,
    ...(step.kind === undefined || step.kind === null
      ? {}
      : { kind: step.kind as "review" }),
    assignee: assigneeOf(step.assignee),
    mode: text(step.mode) as "any",
    ...(step.skipWhen === undefined || step.skipWhen === null
      ? {}
      : { skipWhen: step.skipWhen as Expression }),
    // 指定組織跳過、自動通過原樣保留(形狀交給檢查器的 `SKIP_ORGS_INVALID` / `AUTO_APPROVE_INVALID`)
    ...(step.skipOrgs === undefined || step.skipOrgs === null
      ? {}
      : { skipOrgs: step.skipOrgs as SkipOrgsDef }),
    ...(step.autoApprove === undefined || step.autoApprove === null
      ? {}
      : { autoApprove: step.autoApprove }),
    ...(typeof step.allowReturn === "boolean"
      ? { allowReturn: step.allowReturn }
      : {}),
  };
}

export interface DefinitionInput {
  steps: readonly Record<string, unknown>[];
  edges?: readonly { from: string; to: string }[] | null;
  checkFormKey?: string | null;
}

/**
 * 設計器送來的「檢查用表單」:缺席 = undefined(存草稿時不動已存的值);`null` / 空白 = null(清掉)。
 */
export function checkFormKeyFromInput(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** 整形設計器送來的定義;`edges` 缺席 / `null` / 空陣列都存 `null`(= 直線)。 */
export function definitionFromInput(
  input: DefinitionInput,
): WorkflowDefinition {
  const edges: WorkflowEdge[] = (input.edges ?? []).map((edge) => ({
    from: edge.from,
    to: edge.to,
  }));
  return {
    steps: input.steps.map((step) => stepOf(step)),
    edges: edges.length > 0 ? edges : null,
  };
}

/** 落庫的版本 → 定義(`edges` 空陣列與 null 同義)。 */
export function definitionOfVersion(version: {
  steps: StepDef[];
  edges: WorkflowEdge[] | null;
}): WorkflowDefinition {
  const edges = (version.edges ?? []).map((edge) => ({
    from: edge.from,
    to: edge.to,
  }));
  return {
    steps: version.steps.map((step) => ({ ...step })),
    edges: edges.length > 0 ? edges : null,
  };
}
