import {
  type WorkflowInstanceFieldsFragment,
  WorkflowStepStatus,
} from "@repo/graphql";

type InstanceStep = WorkflowInstanceFieldsFragment["steps"][number];

/** 阻擋清單一列裡「卡在哪、卡在誰」的一項。 */
export type BlockedItem =
  /** 承辦人失效(停用 / 移出租戶)或還在等的人:可改派給別人 */
  | {
      kind: "task";
      stepKey: string;
      stepName: string;
      taskKey: string;
      taskId: string | null;
      assigneeId: string;
      assigneeName: string;
      isInvalid: boolean;
      /** 同一關已在計畫裡的人(改派 / 新增時不能選) */
      stepAssigneeIds: string[];
      /** 可否選申請人(這一關「申請人也是審核者時」= 照常審核) */
      allowsApplicant: boolean;
    }
  /** 關卡解析不到任何審核者:新增一位 */
  | {
      kind: "empty";
      stepKey: string;
      stepName: string;
      /** 可否選申請人(這一關「申請人也是審核者時」= 照常審核) */
      allowsApplicant: boolean;
    };

const itemsOfStep = (step: InstanceStep): BlockedItem[] => {
  if (step.kind === "join" || step.status !== WorkflowStepStatus.Active) {
    return [];
  }
  if (step.plan.length === 0) {
    return [
      {
        kind: "empty",
        stepKey: step.stepKey,
        stepName: step.name,
        allowsApplicant: step.allowsApplicantAssignee,
      },
    ];
  }
  const decided = new Set(step.decisions.map((item) => item.taskKey));
  const stepAssigneeIds = step.plan.map((item) => item.assignee.id);
  return step.plan
    .filter((item) => !decided.has(item.taskKey))
    .map((item) => ({
      kind: "task",
      stepKey: step.stepKey,
      stepName: step.name,
      taskKey: item.taskKey,
      taskId: item.taskId ?? null,
      assigneeId: item.assignee.id,
      assigneeName: item.assignee.name ?? item.assignee.id,
      isInvalid: item.assigneeState === "invalid",
      stepAssigneeIds,
      allowsApplicant: step.allowsApplicantAssignee,
    }));
};

/**
 * 一個實例裡「可處置」的項目(改派、新增審核者):進行中的審核關卡裡,
 * 還沒決定的計畫項目(失效的排前面)、以及解析為空的關卡。阻擋的關卡先列。
 */
export const blockedItemsOf = (
  instance: WorkflowInstanceFieldsFragment,
): BlockedItem[] =>
  instance.steps
    .toSorted((a, b) => Number(b.blocked) - Number(a.blocked))
    .flatMap((step) => itemsOfStep(step))
    .toSorted(
      (a, b) =>
        Number(b.kind === "task" && b.isInvalid) -
        Number(a.kind === "task" && a.isInvalid),
    );
