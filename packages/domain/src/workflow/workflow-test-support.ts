import {
  type AdvanceAction,
  type AdvanceInput,
  type InstanceCondition,
  type StepEntry,
  advance,
  initialStepStates,
} from "./advance";
import { startStepKey } from "./graph";
import type {
  AcceptedDecision,
  Decision,
  HistoryEvent,
  InstanceSnapshot,
  JoinStepDef,
  ReviewStepDef,
  StepState,
  SubmissionSnapshot,
  TaskSnapshot,
  WorkflowDefinition,
} from "./types";

/** 測試夾具:一個審核關卡(預設主管 level 1、`any`)。 */
export function review(
  key: string,
  overrides: Partial<ReviewStepDef> = {},
): ReviewStepDef {
  return {
    key,
    name: key,
    assignee: { kind: "manager", level: 1 },
    mode: "any",
    ...overrides,
  };
}

export function join(key: string): JoinStepDef {
  return { key, name: key, kind: "join" };
}

export const NOW = new Date("2026-03-01T01:00:00.000Z");

export const APPLICANT = "applicant";

/** 直線:直屬主管 → 人資。 */
export const LINEAR: WorkflowDefinition = {
  steps: [review("boss"), review("hr")],
};

/**
 * 採購單:原部門初審 → 分流(財務 any / 法務 all / 採購)→ 匯合 → 原部門確認。
 */
export const PURCHASE: WorkflowDefinition = {
  steps: [
    review("init"),
    review("finance"),
    review("legal", { mode: "all" }),
    review("purchase"),
    join("merge"),
    review("confirm"),
  ],
  edges: [
    { from: "init", to: "finance" },
    { from: "init", to: "legal" },
    { from: "init", to: "purchase" },
    { from: "finance", to: "merge" },
    { from: "legal", to: "merge" },
    { from: "purchase", to: "merge" },
    { from: "merge", to: "confirm" },
  ],
};

/** 每關一筆 pending 的 StepState;狀態 running、active = 起點。 */
export function newInstance(
  definition: WorkflowDefinition,
  overrides: Partial<InstanceSnapshot> = {},
): InstanceSnapshot {
  const start = startStepKey(definition);
  return {
    id: "instance-1",
    status: "running",
    createdBy: APPLICANT,
    submissionId: "submission-1",
    revision: 1,
    activeStepKeys: start === null ? [] : [start],
    steps: initialStepStates(definition),
    editVersion: 1,
    outcome: null,
    history: [{ at: NOW, kind: "started" }],
    finishedAt: null,
    ...overrides,
  };
}

/** 深拷貝(測試裡改來改去不互相汙染)。 */
export function clone<T>(value: T): T {
  return structuredClone(value);
}

/** 改某關的 StepState(回新實例)。 */
export function withStep(
  instance: InstanceSnapshot,
  stepKey: string,
  patch: Partial<StepState>,
): InstanceSnapshot {
  const next = clone(instance);
  next.steps = next.steps.map((step) =>
    step.stepKey === stepKey ? { ...step, ...patch } : step,
  );
  return next;
}

/** 讓某關進關:active、計畫每人一項(`taskKey = <stepKey>-<n>`)。 */
export function entered(
  instance: InstanceSnapshot,
  stepKey: string,
  assignees: readonly string[],
): InstanceSnapshot {
  return withStep(instance, stepKey, {
    status: "active",
    plan: assignees.map((assigneeId, index) => ({
      taskKey: `${stepKey}-${String(index + 1)}`,
      assigneeId,
      previousAssigneeIds: [],
      assigneeState: "active",
    })),
  });
}

/** 模擬 `decideTask` 的原子 `$push`:決定進 `decisions`、同時追加歷程、`editVersion` +1。 */
export function decide(
  instance: InstanceSnapshot,
  stepKey: string,
  taskKey: string,
  decision: Decision,
  comment: string | null = null,
): InstanceSnapshot {
  const next = clone(instance);
  const state = next.steps.find((step) => step.stepKey === stepKey);
  const item = state?.plan.find((planItem) => planItem.taskKey === taskKey);
  if (!state || !item) {
    throw new Error(`找不到 ${stepKey} / ${taskKey}`);
  }
  const accepted: AcceptedDecision = {
    taskKey,
    userId: item.assigneeId,
    decision,
    comment,
    at: NOW,
  };
  state.decisions.push(accepted);
  next.history.push({
    at: NOW,
    kind: decision,
    stepKey,
    taskKey,
    userId: item.assigneeId,
    comment,
  });
  next.editVersion += 1;
  return next;
}

/** 審核中、指向本實例的提交(有資格同步)。 */
export function reviewingSubmission(
  overrides: Partial<SubmissionSnapshot> = {},
): SubmissionSnapshot {
  return {
    id: "submission-1",
    status: "reviewing",
    revision: 1,
    currentInstanceId: "instance-1",
    blocked: false,
    ...overrides,
  };
}

/** 記憶體裡的一份「資料庫」:實例、任務、提交、寄出的信。 */
export interface World {
  definition: WorkflowDefinition;
  instance: InstanceSnapshot;
  tasks: TaskSnapshot[];
  submission: SubmissionSnapshot | null;
  mails: string[];
}

export function worldOf(
  definition: WorkflowDefinition,
  instance: InstanceSnapshot = newInstance(definition),
  submission: SubmissionSnapshot | null = reviewingSubmission(),
): World {
  return { definition, instance, tasks: [], submission, mails: [] };
}

function conditionHolds(
  instance: InstanceSnapshot,
  condition: InstanceCondition,
): boolean {
  if (
    condition.editVersion !== undefined &&
    condition.editVersion !== instance.editVersion
  ) {
    return false;
  }
  if (!condition.statusIn.includes(instance.status)) {
    return false;
  }
  if (condition.outcomeIsNull === true && instance.outcome !== null) {
    return false;
  }
  if (condition.finishedAtIsNull === true && instance.finishedAt !== null) {
    return false;
  }
  for (const [key, status] of Object.entries(condition.stepStatus ?? {})) {
    const state = instance.steps.find((step) => step.stepKey === key);
    if ((state?.status ?? "pending") !== status) {
      return false;
    }
  }
  return (condition.notActive ?? []).every(
    (key) => !instance.activeStepKeys.includes(key),
  );
}

/**
 * 依序執行一輪的動作(照 `advance.ts` 檔頭的執行合約):條件不成立就不寫;
 * **`updateInstance` 失敗或遇到 `invalidState` 就中止本輪**,後面的動作不執行。
 * 回每個**有執行到**的動作是否寫入成功。
 */
export function applyActions(
  world: World,
  actions: readonly AdvanceAction[],
): boolean[] {
  const results: boolean[] = [];
  for (const action of actions) {
    const isWritten = applyAction(world, action);
    results.push(isWritten);
    if (
      action.kind === "invalidState" ||
      (action.kind === "updateInstance" && !isWritten)
    ) {
      break;
    }
  }
  return results;
}

function applyInstanceUpdate(
  world: World,
  action: Extract<AdvanceAction, { kind: "updateInstance" }>,
): boolean {
  const { instance } = world;
  if (!conditionHolds(instance, action.condition)) {
    return false;
  }
  const { update } = action;
  const next = clone(instance);
  next.status = update.status ?? next.status;
  next.activeStepKeys = [...(update.activeStepKeys ?? next.activeStepKeys)];
  for (const [key, patch] of Object.entries(update.steps ?? {})) {
    next.steps = next.steps.map((step) =>
      step.stepKey === key ? { ...step, ...clone(patch) } : step,
    );
  }
  next.outcome = update.outcome ? { ...update.outcome } : next.outcome;
  next.finishedAt = update.finishedAt ?? next.finishedAt;
  next.history.push(...(update.pushHistory ?? []));
  next.editVersion += update.incEditVersion ? 1 : 0;
  world.instance = next;
  return true;
}

function applyAction(world: World, action: AdvanceAction): boolean {
  switch (action.kind) {
    case "resolveStepEntry":
    case "invalidState": {
      return false;
    }
    case "updateInstance": {
      return applyInstanceUpdate(world, action);
    }
    case "updateSubmission": {
      const { submission, instance } = world;
      if (
        submission?.currentInstanceId !== action.condition.currentInstanceId ||
        submission.revision !== action.condition.revision ||
        submission.status !== "reviewing" ||
        action.condition.currentInstanceId !== instance.id
      ) {
        return false;
      }
      world.submission = { ...submission, ...action.set };
      return true;
    }
    case "createTask": {
      if (world.tasks.some((task) => task.taskKey === action.taskKey)) {
        return false;
      }
      world.tasks.push({
        stepKey: action.stepKey,
        taskKey: action.taskKey,
        ...clone(action.projection),
      });
      return true;
    }
    case "syncTask": {
      const task = world.tasks.find(
        (candidate) => candidate.taskKey === action.taskKey,
      );
      if (task?.status !== action.expectedStatus) {
        return false;
      }
      Object.assign(task, clone(action.set));
      return true;
    }
    case "notifyTaskCreated": {
      world.mails.push(`task:${action.taskKey}:${action.assigneeId}`);
      return true;
    }
    case "notifyResult": {
      world.mails.push(`result:${action.result}`);
      return true;
    }
    case "appendHistoryOnce": {
      const { event } = action;
      const exists = world.instance.history.some(
        (candidate: HistoryEvent) =>
          candidate.kind === event.kind &&
          (candidate.taskKey ?? null) === (event.taskKey ?? null) &&
          (candidate.result ?? null) === (event.result ?? null) &&
          (candidate.userId ?? null) === (event.userId ?? null),
      );
      if (exists) {
        return false;
      }
      world.instance = clone(world.instance);
      world.instance.history.push(event);
      return true;
    }
  }
}

/**
 * 模擬 api 的推進迴圈:呼叫 `advance`、執行動作、重讀再呼叫,直到沒事可做。
 * 列 5 的進關結果由 `entries` 提供(`stepKey` → 跳過或名單);沒給的關卡預設派給 `${stepKey}-reviewer`。
 * 回經過的列號。
 */
export function runAdvance(
  world: World,
  entries: Readonly<Record<string, StepEntry>> = {},
  maxRounds = 50,
): string[] {
  const rows: string[] = [];
  for (let round = 0; round < maxRounds; round += 1) {
    const input: AdvanceInput = {
      definition: world.definition,
      instance: world.instance,
      tasks: world.tasks,
      submission: world.submission,
      now: NOW,
    };
    let plan = advance(input);
    const [first] = plan.actions;
    if (first?.kind === "resolveStepEntry") {
      const entry: StepEntry = entries[first.stepKey] ?? {
        kind: "assign",
        assigneeIds: [`${first.stepKey}-reviewer`],
      };
      plan = advance({ ...input, stepEntries: { [first.stepKey]: entry } });
    }
    rows.push(plan.row);
    if (plan.actions.length === 0) {
      return rows;
    }
    applyActions(world, plan.actions);
  }
  throw new Error(`推進超過 ${String(maxRounds)} 輪沒有停:${rows.join(",")}`);
}

/** 在記憶體世界裡對某個任務做決定(找它在計畫裡的位置)。 */
export function decideIn(
  world: World,
  taskKey: string,
  decision: Decision,
  comment: string | null = null,
): void {
  const state = world.instance.steps.find((step) =>
    step.plan.some((item) => item.taskKey === taskKey),
  );
  if (!state) {
    throw new Error(`找不到任務 ${taskKey}`);
  }
  world.instance = decide(
    world.instance,
    state.stepKey,
    taskKey,
    decision,
    comment,
  );
}

export function taskStatusOf(
  world: World,
  taskKey: string,
): string | undefined {
  return world.tasks.find((task) => task.taskKey === taskKey)?.status;
}

export function historyKinds(instance: InstanceSnapshot): string[] {
  return instance.history.map((event) =>
    event.stepKey === undefined || event.stepKey === null
      ? event.kind
      : `${event.kind}:${event.stepKey}`,
  );
}
