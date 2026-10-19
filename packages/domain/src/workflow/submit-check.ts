import { validateAudience } from "../audience/schema";
import type { FieldDef } from "../form/types";
import {
  APPROVER_AUDIENCE_OPTIONS,
  audienceFormFieldRefsOf,
} from "./approver-audience";
import {
  assigneeFieldProblem,
  audienceOrgFieldProblem,
  skipWhenProblems,
} from "./form-refs";
import {
  type ReviewStepDef,
  type WorkflowDefinition,
  isReviewStep,
} from "./types";

/**
 * 送出時檢查(每次送出、再送出都做):
 * 驗「這筆提交綁的表單版本 + 現在綁的流程目前發布版」搭不搭。
 * 表單與流程各自改版,一筆草稿綁的可能是舊版表單,流程要看的欄位在那一版可能不存在。
 *
 * 四種擋下:
 * 1. `field` 來源的欄位在這個表單版本不存在、或不是使用者型引用欄;人員條件用的表單組織欄位
 *    不存在、或不是組織引用欄(`FIELD_NOT_ORG_REFERENCE`)→ 流程設定有誤
 * 2. `skipWhen` 引用的欄位在這個表單版本不存在、或是受保護欄位 → 流程設定有誤
 * 3. 綁的流程沒有已發布版本(`currentVersion = null`)→ 流程尚未發布
 * 4. 進過審核、但現在綁定被解除或流程被收回分派 → 審核流程已移除
 *
 * 沒進過審核、現在也沒綁定 → 6a 行為(送出即完成);進過審核、現在綁到另一個有效流程 → 依新流程重跑。
 */

export interface SubmitCheckInput {
  /** 提交綁的表單 key。 */
  formKey: string;
  /** 這筆提交綁的表單版本的欄位(不是表單的目前版本)。 */
  formFields: readonly FieldDef[];
  /** 這筆進過審核(`currentInstanceId` 有值)。 */
  hasBeenReviewed: boolean;
  /** 目前的流程綁定(`org_form_workflow`);沒有 = null。 */
  binding: { workflowKey: string } | null;
  /**
   * 綁到的流程現況;`isAssigned` = 本租戶仍看得到它(客製流程,或共用流程仍有 `org_workflow`)。
   * 綁定存在但流程文件讀不到 → 給 null。
   */
  workflow: {
    key: string;
    currentVersion: number | null;
    isAssigned: boolean;
  } | null;
  /** 綁到的流程**目前發布版**的定義(`currentVersion` 非 null 時必給)。 */
  definition: WorkflowDefinition | null;
}

export type SubmitCheckCode =
  "WORKFLOW_REMOVED" | "WORKFLOW_UNPUBLISHED" | "WORKFLOW_MISCONFIGURED";

/** 設定有誤時指出哪一關(`stepKey` / 陣列位置 `stepNumber`,訊息用關卡名稱)、哪個欄位、哪種問題。 */
export interface SubmitCheckIssue {
  stepKey: string;
  stepNumber: number;
  /** `assignee` = 審核者來源的欄位(含人員條件的表單組織欄位);`skipWhen` = 跳過條件引用的欄位。 */
  slot: "assignee" | "skipWhen";
  fieldKey: string | null;
  problem:
    | "FORM_MISMATCH"
    | "FIELD_MISSING"
    | "FIELD_NOT_USER_REFERENCE"
    | "FIELD_NOT_ORG_REFERENCE"
    | "UNKNOWN_FIELD"
    | "PROTECTED_FIELD"
    | "INVALID_EXPRESSION";
  detail: string;
}

export type SubmitCheckResult =
  /** 不走流程(6a:送出即完成) */
  | { kind: "noWorkflow" }
  /** 走這一版流程(實例記實際的 `(workflowKey, workflowVersion)`) */
  | { kind: "workflow"; workflowKey: string; workflowVersion: number }
  | {
      kind: "blocked";
      code: SubmitCheckCode;
      /** 給申請人看的訊息。 */
      message: string;
      issues: SubmitCheckIssue[];
    };

export const SUBMIT_CHECK_MESSAGES: Record<SubmitCheckCode, string> = {
  WORKFLOW_REMOVED: "此表單的審核流程已移除,請聯絡管理員",
  WORKFLOW_UNPUBLISHED: "流程尚未發布",
  WORKFLOW_MISCONFIGURED: "流程設定有誤,請聯絡管理員",
};

function blocked(
  code: SubmitCheckCode,
  issues: SubmitCheckIssue[] = [],
): SubmitCheckResult {
  return {
    kind: "blocked",
    code,
    message: SUBMIT_CHECK_MESSAGES[code],
    issues,
  };
}

export function checkSubmitCompatibility(
  input: SubmitCheckInput,
): SubmitCheckResult {
  if (input.binding === null) {
    return input.hasBeenReviewed
      ? blocked("WORKFLOW_REMOVED")
      : { kind: "noWorkflow" };
  }
  // 有綁定但流程已讀不到或被收回分派:不論進沒進過審核都擋(不靜默免審)
  if (input.workflow?.isAssigned !== true) {
    return blocked("WORKFLOW_REMOVED");
  }
  if (input.workflow.currentVersion === null || input.definition === null) {
    return blocked("WORKFLOW_UNPUBLISHED");
  }
  const issues = definitionIssuesAgainst(
    input.definition,
    input.formKey,
    input.formFields,
  );
  if (issues.length > 0) {
    return blocked("WORKFLOW_MISCONFIGURED", issues);
  }
  return {
    kind: "workflow",
    workflowKey: input.workflow.key,
    workflowVersion: input.workflow.currentVersion,
  };
}

/** 流程定義對某一版表單欄位的引用問題(`field` 來源 + `skipWhen`)。 */
function definitionIssuesAgainst(
  definition: WorkflowDefinition,
  formKey: string,
  fields: readonly FieldDef[],
): SubmitCheckIssue[] {
  const issues: SubmitCheckIssue[] = [];
  for (const [index, step] of definition.steps.entries()) {
    if (!isReviewStep(step)) {
      continue;
    }
    const stepNumber = index + 1;
    issues.push(
      ...assigneeIssues(step, stepNumber, formKey, fields),
      ...skipWhenIssues(step, stepNumber, fields),
    );
  }
  return issues;
}

/** 人員條件:用到的表單組織欄位要在這一版且是組織引用欄(格式錯的條件發布前已擋,這裡略過)。 */
function audienceIssues(
  step: ReviewStepDef,
  stepNumber: number,
  audience: unknown,
  fields: readonly FieldDef[],
): SubmitCheckIssue[] {
  const validation = validateAudience(audience, APPROVER_AUDIENCE_OPTIONS);
  if (!validation.ok) {
    return [];
  }
  const label = `關卡「${step.name}」的審核者條件`;
  return audienceFormFieldRefsOf(validation.audience).flatMap(
    ({ fieldKey }) => {
      const problem = audienceOrgFieldProblem(fields, fieldKey);
      return problem === null
        ? []
        : [
            {
              stepKey: step.key,
              stepNumber,
              slot: "assignee" as const,
              fieldKey,
              problem,
              detail:
                problem === "FIELD_MISSING"
                  ? `${label}用的組織欄位 ${fieldKey} 不在這個表單版本`
                  : `${label}用的欄位 ${fieldKey} 不是組織引用欄`,
            },
          ];
    },
  );
}

/** `field` 來源:要屬於被送出的這張表單、欄位在這一版且是使用者型引用欄。 */
function assigneeIssues(
  step: ReviewStepDef,
  stepNumber: number,
  formKey: string,
  fields: readonly FieldDef[],
): SubmitCheckIssue[] {
  const { assignee } = step;
  if (assignee.kind === "audience") {
    return audienceIssues(step, stepNumber, assignee.audience, fields);
  }
  if (assignee.kind !== "field") {
    return [];
  }
  const base = {
    stepKey: step.key,
    stepNumber,
    slot: "assignee" as const,
    fieldKey: assignee.fieldKey,
  };
  const label = `關卡「${step.name}」的審核者欄位`;
  if (assignee.formKey !== formKey) {
    return [
      {
        ...base,
        problem: "FORM_MISMATCH",
        detail: `${label}屬於表單 ${assignee.formKey},不是 ${formKey}`,
      },
    ];
  }
  const problem = assigneeFieldProblem(fields, assignee.fieldKey);
  if (problem === null) {
    return [];
  }
  return [
    {
      ...base,
      problem,
      detail:
        problem === "FIELD_MISSING"
          ? `${label} ${assignee.fieldKey} 不在這個表單版本`
          : `${label} ${assignee.fieldKey} 不是使用者型引用欄`,
    },
  ];
}

/** `skipWhen`:引用的欄位要在這一版、且不是受保護欄位。 */
function skipWhenIssues(
  step: ReviewStepDef,
  stepNumber: number,
  fields: readonly FieldDef[],
): SubmitCheckIssue[] {
  if (step.skipWhen === undefined || step.skipWhen === null) {
    return [];
  }
  return skipWhenProblems(step.skipWhen, fields).map((problem) => ({
    stepKey: step.key,
    stepNumber,
    slot: "skipWhen",
    fieldKey: problem.fieldKey ?? null,
    problem:
      problem.problem === "UNKNOWN_FIELD" ||
      problem.problem === "PROTECTED_FIELD"
        ? problem.problem
        : "INVALID_EXPRESSION",
    detail: `關卡「${step.name}」的跳過條件:${problem.detail}`,
  }));
}
