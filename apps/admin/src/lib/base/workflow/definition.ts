import type {
  StepDef,
  WorkflowDefinition,
  WorkflowEdge,
} from "@repo/domain/workflow";

/**
 * GraphQL 的版本定義 ⇄ `@repo/domain/workflow` 的 `WorkflowDefinition`。
 * `steps` 是 JSON 純量(StepDef 陣列,含 `kind`);`edges` 為 null = 直線。
 * 形狀對錯交給檢查器(`validateWorkflowDefinition`),這裡只做型別整形。
 */
export interface RawWorkflowVersion {
  steps: unknown;
  edges?: readonly { from: string; to: string }[] | null;
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
});

/** 版本的「檢查用表單」(舊資料沒有這一欄 = 沒選)。 */
export const checkFormKeyOf = (version: {
  checkFormKey?: string | null;
}): string | null => version.checkFormKey ?? null;

/**
 * 存草稿 / 檢查用的 input(`definition: { steps, edges, checkFormKey? }`)。
 * `checkFormKey` 不給 = 不送(api 不動已存的值);給 `null` = 清掉。
 */
export const definitionInputOf = (
  definition: WorkflowDefinition,
  checkFormKey?: string | null,
) => ({
  ...(checkFormKey !== undefined && { checkFormKey }),
  // GraphQL 的 `steps` 是 JSONObject 純量陣列
  steps: definition.steps.map((step): Record<string, unknown> => ({ ...step })),
  edges:
    definition.edges === null ||
    definition.edges === undefined ||
    definition.edges.length === 0
      ? null
      : definition.edges,
});
