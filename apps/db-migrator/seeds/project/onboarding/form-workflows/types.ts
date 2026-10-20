import type { OnboardingContext } from "../context";

/** 流程定義的一關(`StepDef` 的 JSON;形狀正本 `@repo/domain/workflow` 的 `ReviewStepDef`)。 */
export type WorkflowStepJson = Record<string, unknown>;

/**
 * 一張表單開通時建立的流程(規格 2.1;開通清單「表單代號與流程」)。表單票各自匯出一份,
 * 在 `./index.ts` 的清單加一行;建流程、發布、綁定由共用的一步(`../steps/form-workflows.ts`)做。
 *
 * 流程是**租戶客製流程**(共用流程不能用角色條件),key 全域唯一,所以帶租戶短碼:
 * `<租戶短碼>_<formKey>`(同底座「以此為基底建流程」的預設 key 形狀)。
 */
export interface FormWorkflowSpec {
  /** 綁定的表單(受管表單的 key)。 */
  formKey: string;
  /** 表單的中文名稱(輸出給操作者看)。 */
  formName: string;
  /** 流程名稱(流程管理顯示)。 */
  workflowName: string;
  /** 關卡(依開通時建立的角色組出;角色 id 從 `context.state` 取)。 */
  steps: (context: OnboardingContext) => WorkflowStepJson[];
}

/** 這個租戶的流程 key:`<租戶短碼>_<formKey>`(全域唯一;建立後不可改)。 */
export function workflowKeyOf(tenantSlug: string, formKey: string): string {
  return `${tenantSlug}_${formKey}`;
}

/** 人員條件(條件列全部 AND;`@repo/domain/audience`)。 */
export function audienceSource(
  ...rows: Record<string, unknown>[]
): Record<string, unknown> {
  return {
    kind: "audience",
    audience: { mode: "match", filter: { op: "AND", children: rows } },
  };
}

/** 一般審核關卡:任一人核准即通過、可退回、沒有跳過與自動通過。 */
export function reviewStep(
  key: string,
  name: string,
  assignee: Record<string, unknown>,
): WorkflowStepJson {
  return {
    key,
    name,
    kind: "review",
    assignee,
    mode: "any",
    skipWhen: null,
    allowReturn: true,
  };
}
