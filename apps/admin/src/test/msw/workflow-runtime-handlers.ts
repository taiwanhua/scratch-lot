import { HttpResponse } from "msw";

import {
  type AddStepAssigneeMutationVariables,
  type ApplicableFormsQuery,
  BlockedInstancesFilter,
  type BlockedInstancesQueryVariables,
  type DecideTaskMutationVariables,
  FormSubmissionStatus,
  type MyApplicationsQueryVariables,
  type MyTasksQueryVariables,
  type ReassignTaskMutationVariables,
  WorkflowDecideResult,
  WorkflowDecision,
  type WorkflowInstanceFieldsFragment,
  type WorkflowTaskFieldsFragment,
  WorkflowTaskStatus,
} from "@repo/graphql";

import { type AuthErrorCode, graphqlError } from "./auth-handlers";
import type { FormFailure } from "./form-runtime-handlers";
import { api } from "./server";
import { type ApplicationRow, STAMP } from "./workflow-fixtures";

export type WorkflowRuntimeOperation =
  "DecideTask" | "ReassignTask" | "RetryAdvanceInstance";

export interface WorkflowRuntimeWorldOptions {
  /** 登入者的 id(`myTasks` / 實例上的 `myTasks` 以它為準);預設 `user-1`(authWorld 的測試使用者) */
  viewerId?: string;
  instances?: WorkflowInstanceFieldsFragment[];
  tasks?: WorkflowTaskFieldsFragment[];
  applications?: ApplicationRow[];
  applicable?: ApplicableFormsQuery["applicableForms"];
  /** 阻擋清單兩種篩選各列哪些實例(實例 id);`truncated` 只給「需要推進」 */
  blocked?: {
    blocked?: string[];
    needsAdvance?: string[];
    truncated?: boolean;
  };
  /** `decideTask` 回 `STEP_CLOSED`(此關已結束或任務已變更),任務不動 */
  closedTaskIds?: string[];
  failures?: Partial<Record<WorkflowRuntimeOperation, FormFailure>>;
  /** 直接指定 `applyCenterCounts` 的回傳(驗 `99+` 這種大數字);缺席時由任務與申請的狀態算 */
  counts?: { myTasks: number; myApplications: number };
}

export interface WorkflowRuntimeWorld {
  handlers: Parameters<typeof import("./server").server.use>;
  inputs: {
    decide: DecideTaskMutationVariables["input"][];
    reassign: ReassignTaskMutationVariables["input"][];
    addAssignee: AddStepAssigneeMutationVariables["input"][];
    retry: string[];
    myApplications: MyApplicationsQueryVariables["input"][];
    myTasks: MyTasksQueryVariables["input"][];
    blocked: BlockedInstancesQueryVariables["input"][];
  };
  /** `applyCenterCounts` 被打了幾次(驗「事件後重查」) */
  countsCalls: () => number;
}

/** 一頁清單的形狀(假 api 不真的分頁)。 */
const page = <T>(items: T[], size = 20) => ({
  items,
  totalCount: items.length,
  page: 1,
  pageSize: size,
});

const DONE = new Set([
  WorkflowTaskStatus.Approved,
  WorkflowTaskStatus.Rejected,
  WorkflowTaskStatus.Returned,
  WorkflowTaskStatus.Late,
]);

const TASK_STATUS_OF: Record<WorkflowDecision, WorkflowTaskStatus> = {
  [WorkflowDecision.Approve]: WorkflowTaskStatus.Approved,
  [WorkflowDecision.Reject]: WorkflowTaskStatus.Rejected,
  [WorkflowDecision.Return]: WorkflowTaskStatus.Returned,
};

const DECISION_VALUE_OF: Record<WorkflowDecision, string> = {
  [WorkflowDecision.Approve]: "approved",
  [WorkflowDecision.Reject]: "rejected",
  [WorkflowDecision.Return]: "returned",
};

/**
 * 審核引擎 / 申請中心 / 阻擋清單的假 api(docs/modules/workflows.md「api 介面」)。有狀態但**不跑推進**:
 * 決定只把任務改狀態、把決定記進實例那一關(關卡進度看得到「已核准」);改派換計畫項目的承辦人並解除失效;
 * 新增審核者往空計畫追加一項。推進判斷表的正確性在 domain / api 測試。
 * 申請人的撤回 / 作廢 / 複製回的是提交,放在表單執行端的 world(`form-runtime-handlers.ts`)。
 */
export const workflowRuntimeWorld = (
  options: WorkflowRuntimeWorldOptions = {},
): WorkflowRuntimeWorld => {
  const viewerId = options.viewerId ?? "user-1";
  const instances = structuredClone(options.instances ?? []);
  const tasks = structuredClone(options.tasks ?? []);
  const applications = structuredClone(options.applications ?? []);
  const failures = options.failures ?? {};
  const inputs: WorkflowRuntimeWorld["inputs"] = {
    decide: [],
    reassign: [],
    addAssignee: [],
    retry: [],
    myApplications: [],
    myTasks: [],
    blocked: [],
  };
  const fail = (operation: WorkflowRuntimeOperation) => {
    const failure = failures[operation];
    return failure === undefined
      ? null
      : graphqlError(
          failure.code as AuthErrorCode,
          failure.code,
          failure.extensions ?? {},
        );
  };
  const withMyTasks = (instance: WorkflowInstanceFieldsFragment) => ({
    ...instance,
    myTasks: tasks.filter(
      (task) =>
        task.instanceId === instance.id && task.assignee.id === viewerId,
    ),
  });
  const findInstance = (id: string) => instances.find((item) => item.id === id);
  let countsCalls = 0;
  /** 同 api 的條件:派給我的待處理任務、我的審核中 / 被退回的申請。 */
  const countsOf = () =>
    options.counts ?? {
      myTasks: tasks.filter(
        (task) =>
          task.assignee.id === viewerId &&
          task.status === WorkflowTaskStatus.Pending,
      ).length,
      myApplications: applications.filter(
        (row) =>
          row.status === FormSubmissionStatus.Reviewing ||
          row.status === FormSubmissionStatus.Returned,
      ).length,
    };

  const handlers = [
    api.query("MyApplications", ({ variables }) => {
      const { input } = variables as MyApplicationsQueryVariables;
      inputs.myApplications.push(input);
      const items = applications.filter(
        (row) =>
          (input.moduleKey == null || row.moduleKey === input.moduleKey) &&
          (input.formKey == null || row.formKey === input.formKey) &&
          (input.status == null || row.status === input.status),
      );
      return HttpResponse.json({ data: { myApplications: page(items) } });
    }),
    api.query("ApplicableForms", () =>
      HttpResponse.json({
        data: { applicableForms: options.applicable ?? [] },
      }),
    ),
    api.query("MyTasks", ({ variables }) => {
      const { input } = variables as MyTasksQueryVariables;
      inputs.myTasks.push(input);
      const items = tasks.filter(
        (task) =>
          task.assignee.id === viewerId &&
          (input.moduleKey == null || task.moduleKey === input.moduleKey) &&
          (input.formKey == null || task.formKey === input.formKey) &&
          (input.done === true
            ? DONE.has(task.status)
            : task.status === WorkflowTaskStatus.Pending),
      );
      return HttpResponse.json({ data: { myTasks: page(items) } });
    }),
    api.query("ApplyCenterCounts", () => {
      countsCalls += 1;
      return HttpResponse.json({ data: { applyCenterCounts: countsOf() } });
    }),
    // 側欄計數登記制:申請中心那一筆 = 待我處理的任務數(api 只回看得到的模組;這裡的登入者都看得到)
    api.query("SidebarBadges", () =>
      HttpResponse.json({
        data: {
          sidebarBadges: [
            { moduleKey: "apply-center", count: countsOf().myTasks },
          ],
        },
      }),
    ),
    api.query("WorkflowInstance", ({ variables }) => {
      const instance = findInstance((variables as { id: string }).id);
      return instance === undefined
        ? graphqlError("NOT_FOUND" as AuthErrorCode)
        : HttpResponse.json({
            data: { workflowInstance: { instance: withMyTasks(instance) } },
          });
    }),
    api.mutation("DecideTask", ({ variables }) => {
      const { input } = variables as DecideTaskMutationVariables;
      inputs.decide.push(input);
      const failure = fail("DecideTask");
      if (failure !== null) {
        return failure;
      }
      const task = tasks.find((item) => item.id === input.taskId);
      if (task === undefined) {
        return graphqlError("NOT_FOUND" as AuthErrorCode);
      }
      if (options.closedTaskIds?.includes(task.id) === true) {
        return HttpResponse.json({
          data: {
            decideTask: { task, result: WorkflowDecideResult.StepClosed },
          },
        });
      }
      Object.assign(task, {
        status: TASK_STATUS_OF[input.decision],
        decidedAt: STAMP,
        comment: input.comment ?? null,
        editVersion: task.editVersion + 1,
      });
      const step = findInstance(task.instanceId)?.steps.find(
        (item) => item.stepKey === task.stepKey,
      );
      step?.decisions.push({
        taskKey: task.taskKey,
        user: task.assignee,
        decision: DECISION_VALUE_OF[input.decision],
        comment: input.comment ?? null,
        at: STAMP,
      });
      return HttpResponse.json({
        data: { decideTask: { task, result: WorkflowDecideResult.Accepted } },
      });
    }),
    api.query("BlockedInstances", ({ variables }) => {
      const { input } = variables as BlockedInstancesQueryVariables;
      inputs.blocked.push(input);
      const isBlocked = input.filter === BlockedInstancesFilter.Blocked;
      const ids =
        (isBlocked
          ? options.blocked?.blocked
          : options.blocked?.needsAdvance) ?? [];
      const items = instances.filter((item) => ids.includes(item.id));
      return HttpResponse.json({
        data: {
          blockedInstances: {
            ...page(items),
            truncated: !isBlocked && options.blocked?.truncated === true,
          },
        },
      });
    }),
    api.mutation("ReassignTask", ({ variables }) => {
      const { input } = variables as ReassignTaskMutationVariables;
      inputs.reassign.push(input);
      const failure = fail("ReassignTask");
      if (failure !== null) {
        return failure;
      }
      for (const instance of instances) {
        for (const step of instance.steps) {
          const item = step.plan.find((plan) => plan.taskId === input.taskId);
          if (item !== undefined) {
            item.previousAssignees.push(item.assignee);
            item.assignee = { id: input.toUserId, name: input.toUserId };
            item.assigneeState = "active";
            step.blocked = false;
          }
        }
      }
      const task = tasks.at(0) ?? null;
      return HttpResponse.json({
        data: {
          reassignTask: { task, result: WorkflowDecideResult.Accepted },
        },
      });
    }),
    api.mutation("AddStepAssignee", ({ variables }) => {
      const { input } = variables as AddStepAssigneeMutationVariables;
      inputs.addAssignee.push(input);
      const step = findInstance(input.instanceId)?.steps.find(
        (item) => item.stepKey === input.stepKey,
      );
      step?.plan.push({
        taskKey: `${input.stepKey}-1`,
        assignee: { id: input.userId, name: input.userId },
        previousAssignees: [],
        assigneeState: "active",
        taskId: null,
      });
      if (step !== undefined) {
        step.blocked = false;
      }
      return HttpResponse.json({
        data: {
          addStepAssignee: {
            task: tasks.at(0) ?? null,
            result: WorkflowDecideResult.Accepted,
          },
        },
      });
    }),
    api.mutation("RetryAdvanceInstance", ({ variables }) => {
      const { input } = variables as { input: { instanceId: string } };
      inputs.retry.push(input.instanceId);
      const failure = fail("RetryAdvanceInstance");
      if (failure !== null) {
        return failure;
      }
      const instance = findInstance(input.instanceId);
      return instance === undefined
        ? graphqlError("NOT_FOUND" as AuthErrorCode)
        : HttpResponse.json({
            data: {
              retryAdvanceInstance: { instance: withMyTasks(instance) },
            },
          });
    }),
  ];

  return { handlers, inputs, countsCalls: () => countsCalls };
};
