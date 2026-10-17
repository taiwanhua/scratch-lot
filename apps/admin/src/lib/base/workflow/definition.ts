import type {
  AssigneeSource,
  StepDef,
  WorkflowDefinition,
  WorkflowEdge,
} from "@repo/domain/workflow";

/**
 * GraphQL 的版本定義 ⇄ `@repo/domain/workflow` 的 `WorkflowDefinition`。
 * `steps` 是 JSON 純量(StepDef 陣列,含 `kind`);`edges` 為 null = 直線;
 * `cc`(整個流程的知會對象)是 JSON 純量,null = 沒設。
 * 形狀對錯交給檢查器(`validateWorkflowDefinition`),這裡只做型別整形。
 */
export interface RawWorkflowVersion {
  steps: unknown;
  edges?: readonly { from: string; to: string }[] | null;
  cc?: Record<string, unknown> | null;
}

export const definitionOf = (
  version: RawWorkflowVersion,
): WorkflowDefinition => ({
  steps: Array.isArray(version.steps) ? (version.steps as StepDef[]) : [],
  edges:
    version.edges === null || version.edges === undefined
      ? null
      : version.edges.map((edge): WorkflowEdge => ({
          from: edge.from,
          to: edge.to,
        })),
  cc:
    version.cc === null || version.cc === undefined
      ? null
      : (version.cc as unknown as AssigneeSource),
});

/** 版本的「檢查用表單」(舊資料沒有這一欄 = 沒選)。 */
export const checkFormKeyOf = (version: {
  checkFormKey?: string | null;
}): string | null => version.checkFormKey ?? null;

/**
 * 存草稿 / 檢查用的 input(`definition: { steps, edges, cc, checkFormKey? }`)。
 * `checkFormKey` 不給 = 不送(api 不動已存的值);給 `null` = 清掉。
 * `cc`(整個流程的知會對象)設計器一律送:沒設 = `null`(清掉)。
 */
export const definitionInputOf = (
  definition: WorkflowDefinition,
  checkFormKey?: string | null,
) => ({
  ...(checkFormKey !== undefined && { checkFormKey }),
  // GraphQL 的 `steps` / `cc` 是 JSONObject 純量
  steps: definition.steps.map((step): Record<string, unknown> => ({ ...step })),
  edges:
    definition.edges === null ||
    definition.edges === undefined ||
    definition.edges.length === 0
      ? null
      : definition.edges,
  cc:
    definition.cc === null || definition.cc === undefined
      ? null
      : ({ ...definition.cc } as Record<string, unknown>),
});
