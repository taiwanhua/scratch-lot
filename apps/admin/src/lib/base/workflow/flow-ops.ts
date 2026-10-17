import type { JoinStepDef, ReviewStepDef } from "@repo/domain/workflow";

import {
  type Flow,
  type FlowOpError,
  type FlowSegment,
  type StepPosition,
  allStepsOf,
  flowProblem,
  isForkSource,
  parallelOf,
  positionOf,
  reviewStepsOf,
} from "./flow-model";

/**
 * 設計器的操作(Spec 6b §8 畫面 3):全部是「段落串 → 段落串」的純函式,不改傳入的值。
 * 結果不合形狀規則(`flowProblem`)就拒絕,設計器顯示原因、畫面不變。
 */

export type FlowOpResult =
  | { ok: true; flow: Flow; selectedKey?: string | null }
  | { ok: false; error: FlowOpError };

const ok = (flow: Flow, selectedKey?: string | null): FlowOpResult => ({
  ok: true,
  flow,
  ...(selectedKey !== undefined && { selectedKey }),
});

const fail = (error: FlowOpError): FlowOpResult => ({ ok: false, error });

const checked = (flow: Flow, selectedKey?: string | null): FlowOpResult => {
  const problem = flowProblem(flow);
  return problem === null ? ok(flow, selectedKey) : fail(problem);
};

const cloneFlow = (flow: Flow): Flow =>
  flow.map((segment) =>
    segment.type === "step"
      ? { ...segment }
      : { ...segment, branches: segment.branches.map((branch) => [...branch]) },
  );

// ---- 新節點 ----

/** 版本內唯一的新 key(`<prefix>_<n>`,格式同欄位 key)。 */
export const nextKey = (flow: Flow, prefix: string): string => {
  const used = new Set(allStepsOf(flow).map((step) => step.key));
  let n = used.size + 1;
  while (used.has(`${prefix}_${String(n)}`)) {
    n += 1;
  }
  return `${prefix}_${String(n)}`;
};

/** 新審核關卡的預設值:主管第 1 層、任一人核准即過、可退回。 */
export const newReviewStep = (key: string, name: string): ReviewStepDef => ({
  key,
  name,
  kind: "review",
  assignee: { kind: "manager", level: 1 },
  mode: "any",
  skipWhen: null,
  allowReturn: true,
});

// ---- 加 ----

/** 在某關之後加一關(主線:插在它後面;分支內:插在分支裡它的後面)。`null` = 接在最後。 */
export const insertAfter = (
  flow: Flow,
  stepKey: string | null,
  step: ReviewStepDef,
): FlowOpResult => {
  if (stepKey === null) {
    return checked([...flow, { type: "step", step }], step.key);
  }
  return moveOrPlace(flow, step, { kind: "after", stepKey });
};

/** 在匯合節點之後加一關(匯合後原本結束 → 接這一關;原本接了關卡 → 插在中間)。 */
export const insertAfterJoin = (
  flow: Flow,
  joinKey: string,
  step: ReviewStepDef,
): FlowOpResult => moveOrPlace(flow, step, { kind: "afterJoin", joinKey });

/** 在某條分支的最後加一關。 */
export const appendToBranch = (
  flow: Flow,
  joinKey: string,
  branch: number,
  step: ReviewStepDef,
): FlowOpResult =>
  moveOrPlace(flow, step, { kind: "branchEnd", joinKey, branch });

/**
 * 從此關分流:在這一關之後建 N 條分支(每條一關)與一個匯合節點。
 * 只有主線上、還沒分流過的審核關卡可以(分支內再分流 = 巢狀,不允許)。
 */
export const forkFrom = (
  flow: Flow,
  stepKey: string,
  branchSteps: readonly ReviewStepDef[],
  join: JoinStepDef,
): FlowOpResult => {
  const position = positionOf(flow, stepKey);
  if (position === null) {
    return ok(flow);
  }
  if (position.container === "branch") {
    return fail("NESTED_FORK");
  }
  if (isForkSource(flow, position)) {
    return fail("ALREADY_FORKED");
  }
  const next = cloneFlow(flow);
  next.splice(position.segment + 1, 0, {
    type: "parallel",
    branches: branchSteps.map((step) => [step]),
    join,
  });
  return checked(next, branchSteps.at(0)?.key ?? null);
};

/** 在某組分流多加一條分支(一關)。 */
export const addBranch = (
  flow: Flow,
  joinKey: string,
  step: ReviewStepDef,
): FlowOpResult => {
  const next = cloneFlow(flow);
  const segment = parallelOf(next, joinKey);
  if (segment === undefined) {
    return ok(flow);
  }
  segment.branches.push([step]);
  return checked(next, step.key);
};

// ---- 刪 ----

/**
 * 分支少於兩條時收成直線:剩下那條分支的關卡直接接在分流來源後面,匯合節點一起刪掉;
 * 一條都不剩就整組拿掉。
 */
const collapseThinParallels = (flow: Flow): Flow =>
  flow.flatMap((segment): FlowSegment[] => {
    if (segment.type === "step") {
      return [segment];
    }
    const branches = segment.branches.filter((branch) => branch.length > 0);
    if (branches.length >= 2) {
      return [{ ...segment, branches }];
    }
    return (branches.at(0) ?? []).map((step) => ({ type: "step", step }));
  });

/** 從段落串拿掉一關(不收合分支)。 */
const withoutStep = (flow: Flow, position: StepPosition): Flow => {
  const next = cloneFlow(flow);
  if (position.container === "main") {
    next.splice(position.segment, 1);
    return next;
  }
  const segment = next[position.segment];
  if (segment.type === "parallel") {
    segment.branches[position.branch].splice(position.index, 1);
  }
  return next;
};

/**
 * 刪除審核關卡:連線自動接上(前後段直接相連);刪掉分支最後一關 = 刪那條分支,
 * 分支剩一條時整組收成直線(匯合節點一起刪)。刪掉分流來源時,前一段若是審核關卡就由它接手分流,
 * 否則拒絕(分流會懸空)。
 */
export const removeStep = (flow: Flow, stepKey: string): FlowOpResult => {
  const position = positionOf(flow, stepKey);
  if (position === null) {
    return ok(flow);
  }
  if (reviewStepsOf(flow).length === 1) {
    return fail("LAST_STEP");
  }
  return checked(collapseThinParallels(withoutStep(flow, position)), null);
};

/** 刪掉整組分流:所有分支的關卡連同匯合節點一起刪,分流來源直接接到匯合後的那一段。 */
export const removeParallel = (flow: Flow, joinKey: string): FlowOpResult => {
  const next = flow.filter(
    (segment) => !(segment.type === "parallel" && segment.join.key === joinKey),
  );
  return next.length === flow.length ? ok(flow) : checked(next, null);
};

// ---- 移 ----

/**
 * 拖放 / 移動的目的地,一律以**別的節點**為參照(不用索引:移走原位之後索引會位移):
 * 插在某一關之前 / 之後(同一條主線或分支)、接在某條分支最後、接在某個匯合節點之後。
 */
export type DropTarget =
  | { kind: "before" | "after"; stepKey: string }
  | { kind: "branchEnd"; joinKey: string; branch: number }
  | { kind: "afterJoin"; joinKey: string };

/** 依參照把一關放進段落串;參照找不到回 null。 */
const placeStep = (
  flow: Flow,
  step: ReviewStepDef,
  target: DropTarget,
): Flow | null => {
  const next = cloneFlow(flow);
  if ("stepKey" in target) {
    const anchor = positionOf(next, target.stepKey);
    const offset = target.kind === "after" ? 1 : 0;
    if (anchor === null) {
      return null;
    }
    if (anchor.container === "main") {
      next.splice(anchor.segment + offset, 0, { type: "step", step });
      return next;
    }
    const segment = next[anchor.segment];
    if (segment.type === "parallel") {
      segment.branches[anchor.branch].splice(anchor.index + offset, 0, step);
    }
    return next;
  }
  const segment = parallelOf(next, target.joinKey);
  if (segment === undefined) {
    return null;
  }
  if (target.kind === "afterJoin") {
    next.splice(next.indexOf(segment) + 1, 0, { type: "step", step });
    return next;
  }
  const branch = segment.branches.at(target.branch);
  if (branch === undefined) {
    return null;
  }
  branch.push(step);
  return next;
};

/** 新關卡直接放;已在段落串裡的就是移動。 */
const moveOrPlace = (
  flow: Flow,
  step: ReviewStepDef,
  target: DropTarget,
): FlowOpResult => {
  if (positionOf(flow, step.key) !== null) {
    return moveStep(flow, step.key, target);
  }
  const placed = placeStep(flow, step, target);
  return placed === null ? ok(flow) : checked(placed, step.key);
};

/**
 * 移動審核關卡(拖節點 = 在同一分支內改順序、移到別條分支、或在主線上改順序)。
 * 分流來源不能移(分流會懸空);移走後會留下空分支 → 拒絕(節點彈回原位)。
 */
export const moveStep = (
  flow: Flow,
  stepKey: string,
  target: DropTarget,
): FlowOpResult => {
  const position = positionOf(flow, stepKey);
  const step = reviewStepsOf(flow).find((item) => item.key === stepKey);
  const isSelf = "stepKey" in target && target.stepKey === stepKey;
  if (position === null || step === undefined || isSelf) {
    return ok(flow);
  }
  if (isForkSource(flow, position)) {
    return fail("FORK_NEEDS_SOURCE");
  }
  const removed = withoutStep(flow, position);
  const origin = removed.at(position.segment);
  if (
    position.container === "branch" &&
    origin?.type === "parallel" &&
    origin.branches[position.branch].length === 0
  ) {
    return fail("BRANCH_WOULD_BE_EMPTY");
  }
  const placed = placeStep(removed, step, target);
  return placed === null ? ok(flow) : checked(placed, stepKey);
};

/** 上移 / 下移一格(同一條主線或同一條分支內;鍵盤也做得到拖拉的事)。 */
export const shiftStep = (
  flow: Flow,
  stepKey: string,
  delta: -1 | 1,
): FlowOpResult => {
  const position = positionOf(flow, stepKey);
  if (position === null) {
    return ok(flow);
  }
  const kind = delta === 1 ? "after" : "before";
  if (position.container === "branch") {
    const segment = flow[position.segment];
    const branch =
      segment.type === "parallel" ? segment.branches[position.branch] : [];
    const neighbour = branch.at(position.index + delta);
    return neighbour === undefined || position.index + delta < 0
      ? ok(flow)
      : moveStep(flow, stepKey, { kind, stepKey: neighbour.key });
  }
  const neighbour =
    position.segment + delta < 0
      ? undefined
      : flow.at(position.segment + delta);
  if (neighbour === undefined) {
    return ok(flow);
  }
  if (neighbour.type === "step") {
    return moveStep(flow, stepKey, { kind, stepKey: neighbour.step.key });
  }
  // 跨過一整組分流:往下 = 接到匯合之後;往上 = 放到分流來源之前
  if (delta === 1) {
    return moveStep(flow, stepKey, {
      kind: "afterJoin",
      joinKey: neighbour.join.key,
    });
  }
  const source = flow.at(position.segment - 2);
  return source?.type === "step" && position.segment >= 2
    ? moveStep(flow, stepKey, { kind: "before", stepKey: source.step.key })
    : ok(flow);
};

// ---- 改 ----

/** 改一關的內容(名稱、來源、會簽…);key 由呼叫端決定能不能改。 */
export const updateStep = (
  flow: Flow,
  stepKey: string,
  nextStep: ReviewStepDef,
): Flow =>
  flow.map((segment) => {
    if (segment.type === "step") {
      return segment.step.key === stepKey
        ? { ...segment, step: nextStep }
        : segment;
    }
    return {
      ...segment,
      branches: segment.branches.map((branch) =>
        branch.map((step) => (step.key === stepKey ? nextStep : step)),
      ),
    };
  });

/** 改匯合節點的名稱(它沒有其他屬性)。 */
export const renameJoin = (flow: Flow, joinKey: string, name: string): Flow =>
  flow.map((segment) =>
    segment.type === "parallel" && segment.join.key === joinKey
      ? { ...segment, join: { ...segment.join, name } }
      : segment,
  );
