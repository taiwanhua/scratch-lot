import { type OutcomeCandidate, selectOutcome } from "./evaluate";
import { endStepKey, nextStepKeys, previousStepKeys, stepOf } from "./graph";
import { type AutoApproval, type BlockedAutoApproval, buildPlan } from "./plan";
import {
  evaluationOf,
  isProjectionInSync,
  projectAllTasks,
} from "./projection";
import {
  type AcceptedDecision,
  type HistoryEvent,
  type InstanceOutcome,
  type InstanceSnapshot,
  type InstanceStatus,
  LIVE_INSTANCE_STATUSES,
  type NotifiedResult,
  type PlanItem,
  type SkipReason,
  type StepState,
  type StepStatus,
  type SubmissionSnapshot,
  type SubmissionStatus,
  type TaskProjection,
  type TaskSnapshot,
  type TaskStatus,
  type WorkflowDefinition,
  isJoinStep,
  isReviewStep,
  isTerminalInstanceStatus,
} from "./types";

/**
 * `advance(instance)` 的判斷表(Spec §6「冪等推進」),**純函式**:
 * 輸入(版本定義、實例、任務投影集合、提交、現在時間)→ 輸出「這一輪要做的動作清單」。
 * 不碰資料庫:api 依序執行動作(每個寫入都是條件更新),做完**重讀再呼叫一次**,直到 `row` 是
 * 「沒事可做」的 3 / 9。
 *
 * 由上往下找第一個成立的列:2 → 3 → 4 → 5 → 4b → 4c → 5b → 6 → 7 → 8 → 8b → 9。
 * (原本的列 1「`linking` 沒事可做」已隨 `linking` 狀態移除;其他列號不變,文件與測試照舊引用。)
 * 列 4、5、5b、8 對 `activeStepKeys` 裡每一關各自判斷;4b、4c、7 看所有節點與任務。
 *
 * 列 5 需要查資料庫才知道「跳過條件成不成立、解析出誰」:第一次呼叫回 `resolveStepEntry`,
 * api 算好後把結果放進 `stepEntries` 再呼叫一次,才回真正的寫入。
 *
 * **執行合約**(api 必須照做,`workflow-test-support.ts` 的執行器是參考實作):
 * 1. 依陣列順序執行;**`updateInstance` 的條件不成立(CAS 失敗)就中止本輪**,後面的動作一個都不做,
 *    重讀實例與任務再呼叫 `advance`。後面的動作(同步提交、寄信)是依「這筆更新成功」算出來的,
 *    CAS 失敗代表快照已過期,繼續做會把舊判斷寫進去。
 * 2. 其他動作的「條件不成立」都是**已做過**(冪等),照常往下:`createTask` 的任務已存在、`syncTask` 的狀態
 *    已被改過、`updateSubmission` 沒有同步資格、`appendHistoryOnce` 事件已存在。
 * 3. `invalidState` = 權威資料自相矛盾,不寫任何東西、中止推進並記 log;它會一直出現在「需要推進」,
 *    等人工修資料。
 *
 * **實例建立時要為版本的每個節點建一筆 `pending` 的 `StepState`**(`initialStepStates`):
 * CAS 條件 `stepStatus: { N: "pending" }` 在 Mongo 是對 `steps` 陣列元素下條件
 * (`steps: { $elemMatch: { stepKey: N, status: "pending" } }`),元素不存在就永遠不成立。
 */

/**
 * 列 5 的外部輸入:跳過(帶原因,時間軸顯示是哪一項成立),或解析到的審核者(未剔除申請人也可,這裡會剔除)。
 *
 * `autoApprovals` = 已過 `beforeApprove` 的 B5 自動通過(api 依 `autoApprovalCandidates` 列出、逐一跑守門):
 * 進關的同一次 CAS 記成他們的核准,接著建好他們的任務(投影 = 已核准);`any` 只記第一位(一人核准即過)。
 * **申請人只有在自動通過成立時才留在計畫裡**,否則照一般規則剔除(剔除後沒人 → 阻擋)。
 *
 * `blockedAutoApprovals` = 被守門擋下的:申請人照上一句剔除;其他人照常留一張待審任務。每位在時間軸記一筆
 * `auto_approve_blocked`(`reason` = 哪一種自動通過、`code` = 專案錯誤碼)。
 *
 * `delegatorOf` = B15 代理人(api 解析審核者後已把在代理期間的人換成代理人,`assigneeIds` 是換過的名單):
 * 代理人 id → 原審核者 id 們(多位委託同一人時合成一項,代理人一票作用到所有被代理者)。派任計畫那一項記
 * `delegatorIds`,`task_created` 與自動通過的 `approved` 事件帶它(時間軸「由 X 代理 Y、Z」)。
 */
export type StepEntry =
  | { kind: "skip"; reason?: SkipReason }
  | {
      kind: "assign";
      assigneeIds: string[];
      autoApprovals?: readonly AutoApproval[];
      blockedAutoApprovals?: readonly BlockedAutoApproval[];
      delegatorOf?: Readonly<Record<string, readonly string[]>>;
    };

export interface AdvanceInput {
  definition: WorkflowDefinition;
  instance: InstanceSnapshot;
  /** 這個實例現有的全部任務文件。 */
  tasks: readonly TaskSnapshot[];
  /** 實例對應的提交(列 2 / 5 / 8 / 8b 判斷「有沒有資格同步提交」);讀不到給 null。 */
  submission: SubmissionSnapshot | null;
  now: Date;
  /** 列 5:`stepKey` → 進關結果(api 算好帶回來)。 */
  stepEntries?: Readonly<Record<string, StepEntry>>;
}

/** 判斷表的列號(8b 是本實作補的恢復列:提交的阻擋標記與實例不符)。 */
export type AdvanceRow =
  | "2"
  | "3"
  | "4"
  | "5"
  | "4b"
  | "4c"
  | "5b"
  | "6"
  | "7"
  | "8"
  | "8b"
  | "9"
  | "invalid";

/** 實例的條件更新要帶的條件(全部都要成立;api 翻成 Mongo 條件)。 */
export interface InstanceCondition {
  /** CAS:`editVersion` 的預期值;不給 = 不比對(只有收尾的 `finishedAt` 不比對)。 */
  editVersion?: number;
  /** 實例狀態必須在這些值之內。 */
  statusIn: InstanceStatus[];
  /** `outcome` 必須還是 null(全案終局只能寫一次)。 */
  outcomeIsNull?: boolean;
  /** `finishedAt` 必須還是 null。 */
  finishedAtIsNull?: boolean;
  /** 這些節點的 `StepState.status` 必須是指定值。 */
  stepStatus?: Record<string, StepStatus>;
  /** 這些節點必須**不在** `activeStepKeys`(後繼啟動「尚未啟動」的條件)。 */
  notActive?: string[];
}

/** 一個節點要改的欄位(沒給的不動)。 */
export interface StepUpdate {
  status?: StepStatus;
  blocked?: boolean;
  plan?: PlanItem[];
  /** 整份取代(只有進關時的 B5 自動通過會寫;人按的決定由 api 以 `$push` 寫)。 */
  decisions?: AcceptedDecision[];
}

export interface InstanceUpdate {
  status?: InstanceStatus;
  /** 整份取代。 */
  activeStepKeys?: string[];
  steps?: Record<string, StepUpdate>;
  outcome?: InstanceOutcome;
  finishedAt?: Date;
  pushHistory?: HistoryEvent[];
  /** `editVersion` +1(狀態改變一律 +1)。 */
  incEditVersion: boolean;
}

/** 提交的條件更新:只在「提交仍指向本實例、修訂號相符、狀態是審核中」時才寫。 */
export interface SubmissionSyncCondition {
  submissionId: string;
  currentInstanceId: string;
  revision: number;
  status: "reviewing";
}

export type AdvanceAction =
  /** 列 5:請 api 算這一關的跳過條件並解析審核者,帶進 `stepEntries` 再呼叫一次。 */
  | { kind: "resolveStepEntry"; stepKey: string }
  | {
      kind: "updateInstance";
      condition: InstanceCondition;
      update: InstanceUpdate;
    }
  | {
      kind: "updateSubmission";
      condition: SubmissionSyncCondition;
      set: { status?: SubmissionStatus; blocked?: boolean };
    }
  /** 依計畫建任務;`(instanceId, taskKey)` 唯一鍵擋重複。 */
  | {
      kind: "createTask";
      stepKey: string;
      taskKey: string;
      projection: TaskProjection;
    }
  /** 任務投影同步;條件 = `(instanceId, taskKey)` + 目前讀到的狀態。 */
  | {
      kind: "syncTask";
      taskKey: string;
      expectedStatus: TaskStatus;
      set: TaskProjection;
    }
  /** 寄「有新任務」的信(盡力;失敗只記 log)。 */
  | {
      kind: "notifyTaskCreated";
      stepKey: string;
      taskKey: string;
      assigneeId: string;
    }
  /** 寄結果信給申請人(盡力;寄信關閉時只記 log)。 */
  | { kind: "notifyResult"; result: NotifiedResult }
  /**
   * 追加一筆歷程,條件是 `history` 裡還沒有「同種類 + 同 `taskKey` / `result`」的事件
   * (`task_created` 與 `notified` 的冪等標記)。
   */
  | { kind: "appendHistoryOnce"; event: HistoryEvent }
  /** 權威資料自相矛盾(見檔頭「執行合約」3):不寫、中止、記 log。 */
  | {
      kind: "invalidState";
      reason: string;
      stepKey?: string;
      taskKey?: string;
    };

export interface AdvancePlan {
  row: AdvanceRow;
  actions: AdvanceAction[];
}

/** 判斷表的入口:回第一個成立的列與它要做的動作。 */
export function advance(input: AdvanceInput): AdvancePlan {
  const { instance } = input;
  if (isTerminalInstanceStatus(instance.status)) {
    const finishing = finishingActions(input);
    return finishing.length > 0
      ? { row: "2", actions: finishing }
      : { row: "3", actions: [] };
  }
  return (
    decideRow4(input) ??
    enterRow5(input) ??
    recoverRow4b(input) ??
    approveRow4c(input) ??
    joinRow5b(input) ??
    createTasksRow6(input) ??
    syncTasksRow7(input) ??
    unblockRow8(input) ??
    syncSubmissionBlockedRow8b(input) ?? { row: "9", actions: [] }
  );
}

// ---- 共用 ----

const COMPLETED_LIKE: ReadonlySet<StepStatus> = new Set([
  "completed",
  "skipped",
]);

function isDone(status: StepStatus | undefined): boolean {
  return status !== undefined && COMPLETED_LIKE.has(status);
}

function statusMapOf(instance: InstanceSnapshot): Map<string, StepStatus> {
  return new Map(instance.steps.map((step) => [step.stepKey, step.status]));
}

function stateOf(
  instance: InstanceSnapshot,
  stepKey: string,
): StepState | undefined {
  return instance.steps.find((step) => step.stepKey === stepKey);
}

/** 節點 N 在這組狀態下「可啟動」:審核關卡 → 可;匯合 → 所有入線來源都完成 / 跳過。 */
function isStartable(
  definition: WorkflowDefinition,
  statuses: ReadonlyMap<string, StepStatus>,
  nodeKey: string,
): boolean {
  const node = stepOf(definition, nodeKey);
  if (node === undefined) {
    return false;
  }
  if (!isJoinStep(node)) {
    return true;
  }
  return previousStepKeys(definition, nodeKey).every((source) =>
    isDone(statuses.get(source)),
  );
}

/** 尚未啟動 = 不在 `activeStepKeys` 且 `status = pending`(沒有 StepState 視同 pending)。 */
function isNotStarted(
  statuses: ReadonlyMap<string, StepStatus>,
  active: ReadonlySet<string>,
  nodeKey: string,
): boolean {
  return (
    !active.has(nodeKey) && (statuses.get(nodeKey) ?? "pending") === "pending"
  );
}

/** 某完成 / 跳過節點的後繼裡「可啟動而尚未啟動」的。 */
function pendingSuccessorsOf(
  definition: WorkflowDefinition,
  statuses: ReadonlyMap<string, StepStatus>,
  active: ReadonlySet<string>,
  nodeKey: string,
): string[] {
  return nextStepKeys(definition, nodeKey).filter(
    (next) =>
      isStartable(definition, statuses, next) &&
      isNotStarted(statuses, active, next),
  );
}

/** 有沒有任何節點「可啟動而尚未啟動」(全案核准條件之二、列 4b)。 */
function hasPendingStart(
  definition: WorkflowDefinition,
  statuses: ReadonlyMap<string, StepStatus>,
  active: ReadonlySet<string>,
): boolean {
  return definition.steps.some(
    (step) =>
      isDone(statuses.get(step.key)) &&
      pendingSuccessorsOf(definition, statuses, active, step.key).length > 0,
  );
}

/** 全案核准三條件:active 空、無待啟動、終點已完成 / 跳過。 */
export function isApprovalReached(
  definition: WorkflowDefinition,
  statuses: ReadonlyMap<string, StepStatus>,
  active: ReadonlySet<string>,
): boolean {
  const end = endStepKey(definition);
  return (
    active.size === 0 &&
    !hasPendingStart(definition, statuses, active) &&
    end !== null &&
    isDone(statuses.get(end))
  );
}

/** 更新後實例該是什麼狀態:核准 / 有 active 關卡阻擋 → blocked / 否則 running。 */
function liveStatusAfter(
  instance: InstanceSnapshot,
  active: ReadonlySet<string>,
  blockedOverrides: ReadonlyMap<string, boolean> = new Map(),
): InstanceStatus {
  const isAnyBlocked = [...active].some(
    (key) =>
      blockedOverrides.get(key) ?? stateOf(instance, key)?.blocked ?? false,
  );
  return isAnyBlocked ? "blocked" : "running";
}

function syncConditionOf(
  instance: InstanceSnapshot,
  submission: SubmissionSnapshot | null,
): SubmissionSyncCondition | null {
  if (
    submission?.currentInstanceId !== instance.id ||
    submission.revision !== instance.revision ||
    submission.status !== "reviewing"
  ) {
    return null;
  }
  return {
    submissionId: submission.id,
    currentInstanceId: instance.id,
    revision: instance.revision,
    status: "reviewing",
  };
}

function liveCondition(
  instance: InstanceSnapshot,
  extra: Omit<InstanceCondition, "editVersion" | "statusIn"> = {},
): InstanceCondition {
  return {
    editVersion: instance.editVersion,
    statusIn: [...LIVE_INSTANCE_STATUSES],
    ...extra,
  };
}

/**
 * 後繼啟動的 ③④:可啟動且尚未啟動的加進 `active`(就地修改)並回傳;
 * 匯合條件還沒成立的後繼放 `waiting`(記 `join_waiting`)。
 */
function startSuccessors(
  definition: WorkflowDefinition,
  statuses: ReadonlyMap<string, StepStatus>,
  active: Set<string>,
  nodeKey: string,
): { started: string[]; waiting: string[] } {
  const started: string[] = [];
  const waiting: string[] = [];
  for (const next of nextStepKeys(definition, nodeKey)) {
    if (!isStartable(definition, statuses, next)) {
      waiting.push(next);
    } else if (isNotStarted(statuses, active, next)) {
      active.add(next);
      started.push(next);
    }
  }
  return { started, waiting };
}

/**
 * **後繼啟動**(列 4 完成、列 4b 恢復、列 5 跳過、列 5b 匯合共用):一次 CAS 更新實例同時做完 ——
 * ①該節點改 `completed` / `skipped` ②移出 `activeStepKeys` ③判斷每個後繼「可啟動」
 * (匯合要所有入線來源都完成 / 跳過,否則記 `join_waiting`)④可啟動且尚未啟動的加進 active
 * ⑤追加 `step_completed` / `step_skipped`。更新後若全案核准三條件成立,同一次 CAS 一併改 `approved`
 * (只改狀態;`finishedAt`、完成事件與寄信留給列 2)。
 *
 * `mode = "recover"`(列 4b):節點早已完成 / 跳過,不改它、不再記它的完成事件,只補啟動後繼。
 */
function successorStart(
  input: AdvanceInput,
  nodeKey: string,
  mode: "completed" | "skipped" | "recover",
  skipReason: SkipReason | null = null,
): AdvanceAction {
  const { definition, instance, now } = input;
  const statuses = statusMapOf(instance);
  const originalStatus = statuses.get(nodeKey) ?? "pending";
  const active = new Set(instance.activeStepKeys);
  const history: HistoryEvent[] = [];
  const stepUpdates: Record<string, StepUpdate> = {};
  if (mode !== "recover") {
    statuses.set(nodeKey, mode);
    active.delete(nodeKey);
    stepUpdates[nodeKey] = { status: mode, blocked: false };
    history.push({
      at: now,
      kind: mode === "completed" ? "step_completed" : "step_skipped",
      stepKey: nodeKey,
      ...(mode === "skipped" && skipReason !== null
        ? { reason: skipReason }
        : {}),
    });
  }
  const { started, waiting } = startSuccessors(
    definition,
    statuses,
    active,
    nodeKey,
  );
  if (mode !== "recover") {
    for (const key of waiting) {
      history.push({ at: now, kind: "join_waiting", stepKey: key });
    }
  }
  const isApproved = isApprovalReached(definition, statuses, active);
  const blockedOverrides = new Map([[nodeKey, false]]);
  const nextStatus: InstanceStatus = isApproved
    ? "approved"
    : liveStatusAfter(instance, active, blockedOverrides);
  const stepStatusCondition: Record<string, StepStatus> = {
    [nodeKey]: originalStatus,
  };
  for (const key of started) {
    stepStatusCondition[key] = "pending";
  }
  return {
    kind: "updateInstance",
    condition: liveCondition(instance, {
      stepStatus: stepStatusCondition,
      notActive: started,
    }),
    update: {
      activeStepKeys: [...active],
      ...(Object.keys(stepUpdates).length > 0 ? { steps: stepUpdates } : {}),
      ...(nextStatus === instance.status ? {} : { status: nextStatus }),
      ...(history.length > 0 ? { pushHistory: history } : {}),
      incEditVersion: true,
    },
  };
}

// ---- 列 2:終局收尾 ----

const SUBMISSION_STATUS_OF: Partial<Record<InstanceStatus, SubmissionStatus>> =
  {
    approved: "completed",
    rejected: "rejected",
    returned: "returned",
    withdrawn: "withdrawn",
  };

const NOTIFIED_RESULT_OF: Partial<Record<InstanceStatus, NotifiedResult>> = {
  approved: "approved",
  rejected: "rejected",
  returned: "returned",
};

function finishingActions(input: AdvanceInput): AdvanceAction[] {
  const { instance, submission, now } = input;
  const actions: AdvanceAction[] = [...taskSyncActions(input)];
  // `superseded` 只收尾自己的任務與歷程,不碰提交;已作廢 / 已被新修訂取代的提交不會通過資格條件
  const syncCondition =
    instance.status === "superseded"
      ? null
      : syncConditionOf(instance, submission);
  const submissionStatus = SUBMISSION_STATUS_OF[instance.status];
  if (
    syncCondition !== null &&
    submission !== null &&
    submissionStatus !== undefined &&
    (submission.status !== submissionStatus || submission.blocked)
  ) {
    actions.push({
      kind: "updateSubmission",
      condition: syncCondition,
      set: { status: submissionStatus, blocked: false },
    });
  }
  if (instance.finishedAt === null) {
    // 流程完成事件(時間軸的「流程完成」);與通知標記 `notified` 分開,各自冪等
    const isCompletedLogged = instance.history.some(
      (event) => event.kind === "completed",
    );
    if (instance.status === "approved" && !isCompletedLogged) {
      actions.push({
        kind: "appendHistoryOnce",
        event: { at: now, kind: "completed" },
      });
    }
    const result = NOTIFIED_RESULT_OF[instance.status];
    const isNotified = instance.history.some(
      (event) => event.kind === "notified" && event.result === result,
    );
    if (result !== undefined && !isNotified) {
      actions.push(
        { kind: "notifyResult", result },
        {
          kind: "appendHistoryOnce",
          event: { at: now, kind: "notified", result },
        },
      );
    }
    // 最後寫:`finishedAt` 有值 = 收尾做完(中途中斷的話下一輪會從缺的那步接下去)
    actions.push({
      kind: "updateInstance",
      condition: { statusIn: [instance.status], finishedAtIsNull: true },
      update: { finishedAt: now, incEditVersion: false },
    });
  }
  return actions;
}

/** 列 7 的同步動作(列 2 收尾也用);只列與投影不符的任務。 */
function taskSyncActions(input: AdvanceInput): AdvanceAction[] {
  const projections = projectAllTasks(input.definition, input.instance);
  const actions: AdvanceAction[] = [];
  for (const task of input.tasks) {
    const expected = projections.get(task.taskKey);
    if (expected === undefined) {
      continue;
    }
    if (!isProjectionInSync(task, expected.projection)) {
      actions.push({
        kind: "syncTask",
        taskKey: task.taskKey,
        expectedStatus: task.status,
        set: expected.projection,
      });
    }
  }
  return actions;
}

// ---- 列 4:有效結果 ----

function decideRow4(input: AdvanceInput): AdvancePlan | null {
  const { definition, instance } = input;
  if (instance.outcome !== null) {
    // 舊資料或 bug:outcome 已寫、實例還活著 → 依已寫的 outcome 終局(outcome 不覆蓋)
    return { row: "4", actions: [terminate(input, instance.outcome, false)] };
  }
  const candidates: OutcomeCandidate[] = [];
  let completedKey: string | null = null;
  for (const key of instance.activeStepKeys) {
    const node = stepOf(definition, key);
    const state = stateOf(instance, key);
    if (
      node === undefined ||
      !isReviewStep(node) ||
      state?.status !== "active"
    ) {
      continue;
    }
    const { result } = evaluationOf(definition, instance, state);
    if (result.kind === "completed") {
      completedKey ??= key;
    } else if (result.kind !== "none") {
      if (result.historyIndex === null) {
        // 決定與它的歷程事件是同一次原子寫入;找不到事件 = 資料損毀,不猜接受順序
        return {
          row: "invalid",
          actions: [
            {
              kind: "invalidState",
              reason: "accepted decision has no matching history event",
              stepKey: key,
              taskKey: result.taskKey,
            },
          ],
        };
      }
      candidates.push({
        kind: result.kind,
        stepKey: key,
        taskKey: result.taskKey,
        historyIndex: result.historyIndex,
      });
    }
  }
  // 終局優先:任一分支有有效駁回 / 退回 → 全案終局,不再啟動任何後繼
  const outcome = selectOutcome(candidates);
  if (outcome !== null) {
    return { row: "4", actions: [terminate(input, outcome, true)] };
  }
  if (completedKey !== null) {
    return {
      row: "4",
      actions: [successorStart(input, completedKey, "completed")],
    };
  }
  return null;
}

/** 全案終局:寫 `outcome`、所有 active 節點 `terminated`、實例 → rejected / returned(收尾交給列 2)。 */
function terminate(
  input: AdvanceInput,
  outcome: InstanceOutcome,
  isNewOutcome: boolean,
): AdvanceAction {
  const { instance } = input;
  const steps: Record<string, StepUpdate> = {};
  for (const key of instance.activeStepKeys) {
    steps[key] = { status: "terminated" };
  }
  return {
    kind: "updateInstance",
    condition: liveCondition(
      instance,
      isNewOutcome ? { outcomeIsNull: true } : {},
    ),
    update: {
      status: outcome.kind,
      activeStepKeys: [],
      ...(Object.keys(steps).length > 0 ? { steps } : {}),
      ...(isNewOutcome ? { outcome } : {}),
      incEditVersion: true,
    },
  };
}

// ---- 列 5:審核關卡進關 ----

function enterRow5(input: AdvanceInput): AdvancePlan | null {
  const { definition, instance, now, submission } = input;
  const stepKey = instance.activeStepKeys.find((key) => {
    const node = stepOf(definition, key);
    return (
      node !== undefined &&
      isReviewStep(node) &&
      (stateOf(instance, key)?.status ?? "pending") === "pending"
    );
  });
  if (stepKey === undefined) {
    return null;
  }
  const entry = input.stepEntries?.[stepKey];
  if (entry === undefined) {
    return { row: "5", actions: [{ kind: "resolveStepEntry", stepKey }] };
  }
  if (entry.kind === "skip") {
    return {
      row: "5",
      actions: [
        successorStart(input, stepKey, "skipped", entry.reason ?? null),
      ],
    };
  }
  const node = stepOf(definition, stepKey);
  const reviewNode = node !== undefined && isReviewStep(node) ? node : null;
  const plan = buildPlan(stepKey, entry.assigneeIds, instance.createdBy, {
    keepApplicant: (entry.autoApprovals ?? []).some(
      (approval) => approval.assigneeId === instance.createdBy,
    ),
    ...(entry.delegatorOf !== undefined && { delegatorOf: entry.delegatorOf }),
  });
  const blockedNotes: HistoryEvent[] = (entry.blockedAutoApprovals ?? []).map(
    (blocked) => ({
      at: now,
      kind: "auto_approve_blocked",
      stepKey,
      userId: blocked.assigneeId,
      reason: blocked.reason,
      code: blocked.code,
    }),
  );
  const condition = liveCondition(instance, {
    stepStatus: { [stepKey]: "pending" },
  });
  if (plan.length === 0) {
    const syncCondition = syncConditionOf(instance, submission);
    return {
      row: "5",
      actions: [
        {
          kind: "updateInstance",
          condition,
          update: {
            steps: { [stepKey]: { status: "active", plan: [], blocked: true } },
            ...(instance.status === "blocked" ? {} : { status: "blocked" }),
            pushHistory: [
              ...blockedNotes,
              { at: now, kind: "blocked", stepKey },
            ],
            incEditVersion: true,
          },
        },
        ...(syncCondition === null
          ? []
          : [
              {
                kind: "updateSubmission" as const,
                condition: syncCondition,
                set: { blocked: true },
              },
            ]),
      ],
    };
  }
  const decisions = autoDecisionsOf(
    reviewNode?.mode ?? "any",
    plan,
    entry.autoApprovals ?? [],
    now,
  );
  const update: InstanceUpdate = {
    steps: {
      [stepKey]: {
        status: "active",
        plan,
        blocked: false,
        ...(decisions.length > 0
          ? { decisions: decisions.map(({ decision }) => decision) }
          : {}),
      },
    },
    pushHistory: [
      { at: now, kind: "step_entered", stepKey },
      ...blockedNotes,
      // 決定與它的 `approved` 事件同一次原子寫入(`historyIndexOf` 靠它排接受順序)
      ...decisions.map(({ decision, reason }) => ({
        at: now,
        kind: "approved" as const,
        stepKey,
        taskKey: decision.taskKey,
        userId: decision.userId,
        comment: null,
        reason,
        ...delegatorsOf(
          plan.find((item) => item.taskKey === decision.taskKey) ?? {},
        ),
      })),
    ],
    incEditVersion: true,
  };
  return {
    row: "5",
    actions: [
      { kind: "updateInstance", condition, update },
      ...autoApprovedTasks(input, stepKey, update),
    ],
  };
}

/**
 * B5 自動通過 → 進關時一併寫入的決定(記成那個人的核准,`comment = null`):只記計畫裡有的人;
 * `any` 只記第一位(一人核准即過,多記的會變成「晚於結果」);`all` 每位各記一票,其他人照常審核。
 */
function autoDecisionsOf(
  mode: "any" | "all",
  plan: readonly PlanItem[],
  approvals: readonly AutoApproval[],
  now: Date,
): { decision: AcceptedDecision; reason: AutoApproval["reason"] }[] {
  const result: {
    decision: AcceptedDecision;
    reason: AutoApproval["reason"];
  }[] = [];
  const seen = new Set<string>();
  for (const approval of approvals) {
    const item = plan.find((entry) => entry.assigneeId === approval.assigneeId);
    if (item === undefined || seen.has(item.taskKey)) {
      continue;
    }
    seen.add(item.taskKey);
    result.push({
      decision: {
        taskKey: item.taskKey,
        userId: item.assigneeId,
        decision: "approved",
        comment: null,
        at: now,
      },
      reason: approval.reason,
    });
    if (mode === "any") {
      break;
    }
  }
  return result;
}

/**
 * 自動通過的人的任務:進關的 CAS 成功後立刻建(投影 = 已核准)。不能等列 6 —— 這一關可能在下一輪的列 4
 * 就完成(連帶全案核准),列 6 只補進行中關卡的任務。`(instanceId, taskKey)` 唯一,重跑不重建。
 */
function autoApprovedTasks(
  input: AdvanceInput,
  stepKey: string,
  update: InstanceUpdate,
): AdvanceAction[] {
  const patch = update.steps?.[stepKey];
  const decided = new Set((patch?.decisions ?? []).map((one) => one.taskKey));
  if (decided.size === 0) {
    return [];
  }
  const instance = input.instance;
  const next: InstanceSnapshot = {
    ...instance,
    steps: instance.steps.map((state) =>
      state.stepKey === stepKey ? { ...state, ...patch } : state,
    ),
    history: [...instance.history, ...(update.pushHistory ?? [])],
  };
  const projections = projectAllTasks(input.definition, next);
  const actions: AdvanceAction[] = [];
  for (const taskKey of decided) {
    const projection = projections.get(taskKey)?.projection;
    if (projection !== undefined) {
      actions.push({ kind: "createTask", stepKey, taskKey, projection });
    }
  }
  return actions;
}

// ---- 列 4b:後繼啟動的恢復 ----

function recoverRow4b(input: AdvanceInput): AdvancePlan | null {
  const { definition, instance } = input;
  const statuses = statusMapOf(instance);
  const active = new Set(instance.activeStepKeys);
  const source = definition.steps.find(
    (step) =>
      isDone(statuses.get(step.key)) &&
      pendingSuccessorsOf(definition, statuses, active, step.key).length > 0,
  );
  if (source === undefined) {
    return null;
  }
  return { row: "4b", actions: [successorStart(input, source.key, "recover")] };
}

// ---- 列 4c:核准條件已成立但實例未核准 ----

function approveRow4c(input: AdvanceInput): AdvancePlan | null {
  const { definition, instance } = input;
  if (
    !isApprovalReached(
      definition,
      statusMapOf(instance),
      new Set(instance.activeStepKeys),
    )
  ) {
    return null;
  }
  return {
    row: "4c",
    actions: [
      {
        kind: "updateInstance",
        condition: liveCondition(instance),
        update: { status: "approved", incEditVersion: true },
      },
    ],
  };
}

// ---- 列 5b:匯合節點進 active 即完成 ----

function joinRow5b(input: AdvanceInput): AdvancePlan | null {
  const { definition, instance } = input;
  const joinKey = instance.activeStepKeys.find((key) => {
    const node = stepOf(definition, key);
    return node !== undefined && isJoinStep(node);
  });
  if (joinKey === undefined) {
    return null;
  }
  return { row: "5b", actions: [successorStart(input, joinKey, "completed")] };
}

// ---- 列 6:計畫項目缺任務 ----

function createTasksRow6(input: AdvanceInput): AdvancePlan | null {
  const { definition, instance, tasks } = input;
  const existing = new Set(tasks.map((task) => task.taskKey));
  const projections = projectAllTasks(definition, instance);
  const actions: AdvanceAction[] = [];
  for (const state of instance.steps) {
    if (state.status !== "active") {
      continue;
    }
    for (const item of state.plan) {
      const projection = projections.get(item.taskKey)?.projection;
      if (projection === undefined) {
        continue;
      }
      if (!existing.has(item.taskKey)) {
        actions.push({
          kind: "createTask",
          stepKey: state.stepKey,
          taskKey: item.taskKey,
          projection,
        });
      }
      actions.push(...announceActions(input, state, item));
    }
  }
  return actions.length > 0 ? { row: "6", actions } : null;
}

/** B15:計畫項目有被代理者時,事件要帶的 `delegatorIds`;沒有 → 空物件(不帶欄位)。 */
function delegatorsOf(
  item: Pick<PlanItem, "delegatorIds">,
): Pick<HistoryEvent, "delegatorIds"> {
  const ids = item.delegatorIds ?? [];
  return ids.length > 0 ? { delegatorIds: [...ids] } : {};
}

/**
 * 「有新任務」的信與 `task_created` 事件。任務已建、但事件還沒記(建完就中斷)也要補,
 * 否則這位審核者永遠收不到信;只通知還能審的人(有效承辦人、尚未決定)。
 */
function announceActions(
  input: AdvanceInput,
  state: StepState,
  item: PlanItem,
): AdvanceAction[] {
  const isAnnounced = input.instance.history.some(
    (event) => event.kind === "task_created" && event.taskKey === item.taskKey,
  );
  const isDecided = state.decisions.some(
    (decision) => decision.taskKey === item.taskKey,
  );
  if (isAnnounced || isDecided || item.assigneeState !== "active") {
    return [];
  }
  return [
    {
      kind: "notifyTaskCreated",
      stepKey: state.stepKey,
      taskKey: item.taskKey,
      assigneeId: item.assigneeId,
    },
    {
      kind: "appendHistoryOnce",
      event: {
        at: input.now,
        kind: "task_created",
        stepKey: state.stepKey,
        taskKey: item.taskKey,
        userId: item.assigneeId,
        ...delegatorsOf(item),
      },
    },
  ];
}

// ---- 列 7:任務投影不同步 ----

function syncTasksRow7(input: AdvanceInput): AdvancePlan | null {
  const actions = taskSyncActions(input);
  return actions.length > 0 ? { row: "7", actions } : null;
}

// ---- 列 8:可解除阻擋 ----

/** 空計畫永遠不解除;`any` 要有 active 且未決定的項目;`all` 要沒有任何 invalid 項目。 */
function canUnblock(definition: WorkflowDefinition, state: StepState): boolean {
  if (!state.blocked || state.plan.length === 0) {
    return false;
  }
  const node = stepOf(definition, state.stepKey);
  if (node === undefined || !isReviewStep(node)) {
    return false;
  }
  if (node.mode === "any") {
    const decided = new Set(
      state.decisions.map((decision) => decision.taskKey),
    );
    return state.plan.some(
      (item) => item.assigneeState === "active" && !decided.has(item.taskKey),
    );
  }
  return state.plan.every((item) => item.assigneeState !== "invalid");
}

function unblockRow8(input: AdvanceInput): AdvancePlan | null {
  const { definition, instance, submission, now } = input;
  const stepKey = instance.activeStepKeys.find((key) => {
    const state = stateOf(instance, key);
    return state?.status === "active" && canUnblock(definition, state);
  });
  if (stepKey === undefined) {
    return null;
  }
  const active = new Set(instance.activeStepKeys);
  const nextStatus = liveStatusAfter(
    instance,
    active,
    new Map([[stepKey, false]]),
  );
  const syncCondition = syncConditionOf(instance, submission);
  return {
    row: "8",
    actions: [
      {
        kind: "updateInstance",
        condition: liveCondition(instance, {
          stepStatus: { [stepKey]: "active" },
        }),
        update: {
          steps: { [stepKey]: { blocked: false } },
          ...(nextStatus === instance.status ? {} : { status: nextStatus }),
          pushHistory: [{ at: now, kind: "unblocked", stepKey }],
          incEditVersion: true,
        },
      },
      ...(nextStatus === "running" && syncCondition !== null
        ? [
            {
              kind: "updateSubmission" as const,
              condition: syncCondition,
              set: { blocked: false },
            },
          ]
        : []),
    ],
  };
}

// ---- 列 8b:提交的阻擋標記與實例不符(恢復列) ----

function syncSubmissionBlockedRow8b(input: AdvanceInput): AdvancePlan | null {
  const { instance, submission } = input;
  const syncCondition = syncConditionOf(instance, submission);
  const isBlocked = instance.status === "blocked";
  if (syncCondition === null || submission === null) {
    return null;
  }
  if (submission.blocked === isBlocked) {
    return null;
  }
  return {
    row: "8b",
    actions: [
      {
        kind: "updateSubmission",
        condition: syncCondition,
        set: { blocked: isBlocked },
      },
    ],
  };
}

// ---- 建立實例 ----

/**
 * 新實例的 `steps[]`:版本的**每個節點**各一筆 `pending`(見檔頭「執行合約」的最後一段)。
 * 送出建實例時寫入;之後只改欄位,不增刪元素。
 */
export function initialStepStates(definition: WorkflowDefinition): StepState[] {
  return definition.steps.map((step) => ({
    stepKey: step.key,
    status: "pending",
    blocked: false,
    plan: [],
    decisions: [],
  }));
}
