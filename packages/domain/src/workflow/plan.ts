import { evaluateCondition } from "../form/expression";
import { semanticValuesOf } from "../form/semantic";
import type { ExpressionContext, FieldDef, StoredValues } from "../form/types";
import { previousStepKeys } from "./graph";
import { evaluationOf } from "./projection";
import {
  type AutoApproveReason,
  type InstanceSnapshot,
  type PlanItem,
  type ReviewStepDef,
  SKIP_ORG_TENANT,
  type SkipOrgsDef,
  type WorkflowDefinition,
} from "./types";

/**
 * 進關時要算的兩件事:跳過條件、派任計畫。
 * 審核者的**解析**要查資料庫(角色成員、主管、使用者狀態),由 api 做;
 * 這裡只負責「拿到名單之後」的純規則:去重、剔除申請人、編 `taskKey`。
 */

/** 送出的那份表單內容(跳過條件的求值對象;同一實例內固定)。 */
export interface SkipEvaluationInput {
  /** 該修訂綁的表單版本欄位。 */
  fields: readonly FieldDef[];
  /** 該修訂的存值快照。 */
  values: StoredValues;
  /** 送出當時的上下文(時間用送出當時,不用推進當下)。 */
  ctx: ExpressionContext;
}

/**
 * 跳過條件:沒設 → false(永遠不跳過);設了就拿送出的表單內容算一次。
 * 算法同 6a 表單公式(下拉欄用選項值、引用欄用 id)。
 */
export function shouldSkipStep(
  step: Pick<ReviewStepDef, "skipWhen">,
  input: SkipEvaluationInput,
): boolean {
  if (step.skipWhen === undefined || step.skipWhen === null) {
    return false;
  }
  return evaluateCondition(step.skipWhen, {
    values: semanticValuesOf(input.fields, input.values),
    ctx: input.ctx,
    fields: input.fields,
    stored: input.values,
  });
}

/** `taskKey = "<stepKey>-<seq>"`(seq 從 1 起;改派不變)。 */
export function taskKeyOf(stepKey: string, seq: number): string {
  return `${stepKey}-${String(seq)}`;
}

/** 申請人的一個所屬組織(api 從修訂 `ctx` 快照的 `orgIds` 查出組織樹位置)。 */
export interface ApplicantOrgFact {
  id: string;
  /** 由上到下的祖先 id(`orgs.ancestors`)。 */
  ancestorIds: readonly string[];
}

/**
 * 「申請人屬於這些組織」成不成立:申請人任一個所屬組織 = 名單裡的組織(`SKIP_ORG_TENANT` 代入 `tenantId`),
 * 或勾了「包含下層」且名單組織是它的祖先。沒有所屬組織 / 名單是空的 → 不成立。
 */
export function isApplicantInSkipOrgs(
  skipOrgs: SkipOrgsDef,
  applicantOrgs: readonly ApplicantOrgFact[],
  tenantId: string | null,
): boolean {
  const targets = new Set(
    skipOrgs.orgIds
      .map((id) => (id === SKIP_ORG_TENANT ? tenantId : id))
      .filter((id): id is string => id !== null),
  );
  return applicantOrgs.some(
    (org) =>
      targets.has(org.id) ||
      (skipOrgs.includeDescendants &&
        org.ancestorIds.some((ancestor) => targets.has(ancestor))),
  );
}

/** 自動通過的一位審核者與原因。 */
export interface AutoApproval {
  assigneeId: string;
  reason: AutoApproveReason;
}

/** 自動通過被 `beforeApprove` 擋下的一位(`code` = 專案錯誤碼;時間軸記 `auto_approve_blocked`)。 */
export interface BlockedAutoApproval extends AutoApproval {
  code: string;
}

/** 某關的所有上游關卡(沿入線往回走到起點;不含自己)。 */
function upstreamStepKeys(
  definition: WorkflowDefinition,
  stepKey: string,
): Set<string> {
  const seen = new Set<string>();
  const queue = previousStepKeys(definition, stepKey);
  while (queue.length > 0) {
    const key = queue.shift();
    if (key === undefined || seen.has(key) || key === stepKey) {
      continue;
    }
    seen.add(key);
    queue.push(...previousStepKeys(definition, key));
  }
  return seen;
}

/**
 * 「已在前面的關卡核准過」的人(2026-10-16 定):只看**這個實例**(= 最近一次送出之後的
 * 這一輪)裡、這一關**上游**的關卡,決定紀錄**記在他名下**的有效核准 —— 代理人代為核准記在代理人名下,
 * 只算代理人;自動通過記在他名下的也算。不同分支(不在上游)的核准不算。
 */
export function priorApproverIds(
  definition: WorkflowDefinition,
  instance: Pick<InstanceSnapshot, "steps" | "history">,
  stepKey: string,
): Set<string> {
  const upstream = upstreamStepKeys(definition, stepKey);
  const approvers = new Set<string>();
  for (const state of instance.steps) {
    if (!upstream.has(state.stepKey)) {
      continue;
    }
    const { effectiveTaskKeys } = evaluationOf(definition, instance, state);
    for (const decision of state.decisions) {
      if (
        decision.decision === "approved" &&
        effectiveTaskKeys.has(decision.taskKey)
      ) {
        approvers.add(decision.userId);
      }
    }
  }
  return approvers;
}

/**
 * 自動通過的候選人(還沒經守門;api 依序以本人身分跑 `checkApproveGuard`,結果放進 `StepEntry` 的
 * `autoApprovals` / `blockedAutoApprovals`):
 * - 申請人在名單裡:開了 `applicant` → `auto_applicant`;否則開了 `priorApprover` 且他已在前關核准過 →
 *   `auto_prior_approver`
 * - 其他人:開了 `priorApprover` 且已在前關核准過 → `auto_prior_approver`
 *
 * 順序同名單(去重)。
 */
export function autoApprovalCandidates(
  definition: WorkflowDefinition,
  instance: Pick<InstanceSnapshot, "steps" | "history" | "createdBy">,
  step: Pick<ReviewStepDef, "key" | "autoApprove">,
  assigneeIds: readonly string[],
): AutoApproval[] {
  const isApplicantAuto = step.autoApprove?.applicant === true;
  const isPriorAuto = step.autoApprove?.priorApprover === true;
  if (!isApplicantAuto && !isPriorAuto) {
    return [];
  }
  const prior = isPriorAuto
    ? priorApproverIds(definition, instance, step.key)
    : new Set<string>();
  const result: AutoApproval[] = [];
  for (const assigneeId of new Set(assigneeIds)) {
    if (assigneeId === instance.createdBy && isApplicantAuto) {
      result.push({ assigneeId, reason: "auto_applicant" });
    } else if (prior.has(assigneeId)) {
      result.push({ assigneeId, reason: "auto_prior_approver" });
    }
  }
  return result;
}

/**
 * 派任計畫:解析到的審核者去重、剔除申請人(不能自審),每人一項,`taskKey` 依序編。
 * `keepApplicant`(申請人的自動通過**成立**,已過守門)時申請人留在計畫裡。
 * `delegatorOf`(代理人;代理人 id → 原審核者 id 們)有記的那一項帶 `delegatorIds`。
 * 剔除後為空 → 空陣列(呼叫端依來源決定:`manager` 往上一層在解析時就做完了,其餘阻擋)。
 */
export function buildPlan(
  stepKey: string,
  assigneeIds: readonly string[],
  applicantId: string,
  options: {
    keepApplicant?: boolean;
    delegatorOf?: Readonly<Record<string, readonly string[]>>;
  } = {},
): PlanItem[] {
  const unique = [...new Set(assigneeIds)].filter(
    (id) => options.keepApplicant === true || id !== applicantId,
  );
  return unique.map((assigneeId, index) => {
    const delegatorIds = options.delegatorOf?.[assigneeId] ?? [];
    return {
      taskKey: taskKeyOf(stepKey, index + 1),
      assigneeId,
      previousAssigneeIds: [],
      assigneeState: "active",
      ...(delegatorIds.length > 0 && { delegatorIds: [...delegatorIds] }),
    };
  });
}

/** 新增審核者時的下一個 `taskKey`(接在計畫最大序號之後,不重用)。 */
export function nextTaskKey(
  stepKey: string,
  plan: readonly Pick<PlanItem, "taskKey">[],
): string {
  const prefix = `${stepKey}-`;
  const maxSeq = plan.reduce((max, item) => {
    const seq = item.taskKey.startsWith(prefix)
      ? Number(item.taskKey.slice(prefix.length))
      : 0;
    return Number.isInteger(seq) && seq > max ? seq : max;
  }, 0);
  return taskKeyOf(stepKey, maxSeq + 1);
}
