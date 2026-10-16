import type {
  JoinStepDef,
  ReviewStepDef,
  StepDef,
  WorkflowDefinition,
  WorkflowEdge,
} from "@repo/domain/workflow";

/**
 * 流程設計器的編輯模型(Spec 6b §5「流程結構」、§8 畫面 3)。
 *
 * 設計器不開放自由拉線,所以編輯的不是「節點 + 連線」,而是**一串段落**:
 *
 * - `step`:主線上的一個審核關卡
 * - `parallel`:從**前一段的審核關卡**分流出去的 N 條分支(每條一關或多關,依序走),全部匯到同一個
 *   系統匯合節點;匯合節點之後接下一段(審核關卡)或結束
 *
 * 這個形狀本身就守住 6b 允許的結構(不巢狀、不交叉、分流 / 匯合明確配對、審核關卡入線 ≤ 1),
 * 設計器的每個操作都是「段落串 → 段落串」的純函式(`flow-ops.ts`),再由 `toDefinition` 產出
 * `steps` / `edges`。形狀規則(`flowProblem`):第一段是審核關卡;`parallel` 前面一定是審核關卡
 * (= 分流來源);每組至少兩條分支、每條至少一關。
 */

export interface ParallelSegment {
  type: "parallel";
  branches: ReviewStepDef[][];
  join: JoinStepDef;
}

export type FlowSegment =
  { type: "step"; step: ReviewStepDef } | ParallelSegment;

export type Flow = FlowSegment[];

/** 一個審核關卡在段落串裡的位置。 */
export type StepPosition =
  | { container: "main"; segment: number }
  | { container: "branch"; segment: number; branch: number; index: number };

/** 操作被拒的原因(設計器顯示對應文案,段落串不變)。 */
export type FlowOpError =
  /** 分流前面一定要有一個審核關卡(刪 / 移走分流來源會讓分流懸空) */
  | "FORK_NEEDS_SOURCE"
  /** 分支裡不能再分流(不可巢狀) */
  | "NESTED_FORK"
  /** 這一關已經是分流來源 */
  | "ALREADY_FORKED"
  /** 移動後會留下空分支 */
  | "BRANCH_WOULD_BE_EMPTY"
  /** 流程至少要有一關 */
  | "LAST_STEP";

export const isJoinStep = (step: StepDef): step is JoinStepDef =>
  step.kind === "join";

// ---- 查詢 ----

/** 段落串裡所有審核關卡(依畫面順序)。 */
export const reviewStepsOf = (flow: Flow): ReviewStepDef[] =>
  flow.flatMap((segment) =>
    segment.type === "step" ? [segment.step] : segment.branches.flat(),
  );

/** 段落串裡所有節點(含匯合節點),順序 = `toDefinition` 的 `steps[]`。 */
export const allStepsOf = (flow: Flow): StepDef[] =>
  flow.flatMap((segment) =>
    segment.type === "step"
      ? [segment.step]
      : [...segment.branches.flat(), segment.join],
  );

export const positionOf = (
  flow: Flow,
  stepKey: string,
): StepPosition | null => {
  for (const [segment, item] of flow.entries()) {
    if (item.type === "step" && item.step.key === stepKey) {
      return { container: "main", segment };
    }
    if (item.type === "parallel") {
      for (const [branch, steps] of item.branches.entries()) {
        const index = steps.findIndex((step) => step.key === stepKey);
        if (index !== -1) {
          return { container: "branch", segment, branch, index };
        }
      }
    }
  }
  return null;
};

/** 這一關是不是分流來源(下一段是 `parallel`)。 */
export const isForkSource = (flow: Flow, position: StepPosition): boolean =>
  position.container === "main" &&
  flow.at(position.segment + 1)?.type === "parallel";

/** 某個匯合節點所在的那組分流。 */
export const parallelOf = (
  flow: Flow,
  joinKey: string,
): ParallelSegment | undefined =>
  flow.find(
    (segment): segment is ParallelSegment =>
      segment.type === "parallel" && segment.join.key === joinKey,
  );

/** 段落串形狀是否合法;不合法回第一個問題。 */
export const flowProblem = (flow: Flow): FlowOpError | null => {
  if (flow.length === 0) {
    return "LAST_STEP";
  }
  for (const [index, segment] of flow.entries()) {
    if (segment.type === "step") {
      continue;
    }
    if (index === 0 || flow.at(index - 1)?.type !== "step") {
      return "FORK_NEEDS_SOURCE";
    }
    if (
      segment.branches.length < 2 ||
      segment.branches.some((branch) => branch.length === 0)
    ) {
      return "BRANCH_WOULD_BE_EMPTY";
    }
  }
  return null;
};

// ---- 段落串 → 版本定義 ----

/** 一段的連線:前一段的尾巴接到這一段的開頭;回新的尾巴。 */
const segmentEdges = (
  segment: FlowSegment,
  tails: readonly string[],
  edges: WorkflowEdge[],
): string[] => {
  const link = (from: readonly string[], to: string) => {
    for (const tail of from) {
      edges.push({ from: tail, to });
    }
  };
  if (segment.type === "step") {
    link(tails, segment.step.key);
    return [segment.step.key];
  }
  for (const branch of segment.branches) {
    let previous: readonly string[] = tails;
    for (const step of branch) {
      link(previous, step.key);
      previous = [step.key];
    }
    link(previous, segment.join.key);
  }
  return [segment.join.key];
};

/**
 * 段落串 → 版本定義。沒有任何分流 = 直線(`edges: null`,陣列順序就是流程);
 * 有分流才產生連線(分流來源 → 各分支第一關、分支內依序、各分支最後一關 → 匯合、匯合 → 下一段)。
 */
export const toDefinition = (flow: Flow): WorkflowDefinition => {
  const steps = allStepsOf(flow);
  if (!flow.some((segment) => segment.type === "parallel")) {
    return { steps, edges: null };
  }
  const edges: WorkflowEdge[] = [];
  let tails: string[] = [];
  for (const segment of flow) {
    tails = segmentEdges(segment, tails, edges);
  }
  return { steps, edges };
};

// ---- 版本定義 → 段落串 ----

const edgeIdOf = (edge: WorkflowEdge): string => `${edge.from}->${edge.to}`;

/** 物件的鍵依字母排序(遞迴),讓「同內容、不同鍵順序」的 JSON 字串相同;`undefined` 與 `null` 視同。 */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => canonical(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined && item !== null)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
};

/**
 * 一版定義「實際的連線」:有 `edges`(非空)就是它;沒有 = 直線,陣列順序兩兩相連。
 * 直線版本可以寫成 `edges: null` 或一條單鏈,兩者語意相同(`@repo/domain/workflow` 的 `nextStepKeys`)。
 */
export const effectiveEdgesOf = (
  definition: WorkflowDefinition,
): WorkflowEdge[] =>
  definition.edges !== null &&
  definition.edges !== undefined &&
  definition.edges.length > 0
    ? definition.edges
    : definition.steps.slice(1).map((step, index) => ({
        from: definition.steps[index].key,
        to: step.key,
      }));

/**
 * 比對用的正規化字串:節點依 key 排序、連線用「實際的連線」排序。陣列順序不同(api / fork 建的平行定義)、
 * 直線寫成 null 或單鏈,只要圖一樣就相同 —— 「有沒有未存的變更」靠它判斷。
 */
export const definitionFingerprint = (definition: WorkflowDefinition): string =>
  JSON.stringify({
    steps: definition.steps
      .toSorted((a, b) => a.key.localeCompare(b.key))
      .map((step) => canonical(step)),
    edges: effectiveEdgesOf(definition)
      .map((edge) => edgeIdOf(edge))
      .toSorted((a, b) => a.localeCompare(b)),
  });

interface GraphIndex {
  byKey: ReadonlyMap<string, StepDef>;
  outOf: ReadonlyMap<string, string[]>;
  seen: Set<string>;
}

/** 某節點的唯一後繼;沒有出線回 null,出線不只一條回 undefined(形狀不合)。 */
const soleNext = (
  graph: GraphIndex,
  key: string,
): StepDef | null | undefined => {
  const outs = graph.outOf.get(key) ?? [];
  if (outs.length === 0) {
    return null;
  }
  return outs.length === 1 ? graph.byKey.get(outs[0]) : undefined;
};

/** 一條分支:從第一關一路走到匯合節點;回分支關卡與它匯到的匯合節點。 */
const walkBranch = (
  graph: GraphIndex,
  first: string,
): { steps: ReviewStepDef[]; join: JoinStepDef } | null => {
  const steps: ReviewStepDef[] = [];
  let cursor: StepDef | null | undefined = graph.byKey.get(first);
  while (cursor !== null && cursor !== undefined && !isJoinStep(cursor)) {
    if (graph.seen.has(cursor.key)) {
      return null;
    }
    graph.seen.add(cursor.key);
    steps.push(cursor);
    cursor = soleNext(graph, cursor.key);
  }
  return cursor === null || cursor === undefined || steps.length === 0
    ? null
    : { steps, join: cursor };
};

/** 從分流來源的各條出線走到**同一個**匯合節點;形狀不對回 null。 */
const parseParallel = (
  graph: GraphIndex,
  outs: readonly string[],
): ParallelSegment | null => {
  const walked = outs.map((first) => walkBranch(graph, first));
  const join = walked[0]?.join;
  if (
    join === undefined ||
    graph.seen.has(join.key) ||
    walked.some((branch) => branch?.join.key !== join.key)
  ) {
    return null;
  }
  graph.seen.add(join.key);
  return {
    type: "parallel",
    branches: walked.map((branch) => branch?.steps ?? []),
    join,
  };
};

/** 從起點沿主線走:審核關卡 → (分流 → 匯合)→ … → 結束。 */
const walkMain = (graph: GraphIndex, start: StepDef): Flow | null => {
  const flow: Flow = [];
  let current: StepDef | null | undefined = start;
  while (current !== null) {
    if (current === undefined || isJoinStep(current)) {
      return null;
    }
    if (graph.seen.has(current.key)) {
      return null;
    }
    graph.seen.add(current.key);
    flow.push({ type: "step", step: current });
    const outs = graph.outOf.get(current.key) ?? [];
    if (outs.length <= 1) {
      current = soleNext(graph, current.key);
      continue;
    }
    const parallel = parseParallel(graph, outs);
    if (parallel === null) {
      return null;
    }
    flow.push(parallel);
    current = soleNext(graph, parallel.join.key);
  }
  return flow;
};

/** 解析結果與原本的節點 / 連線集合完全相同才算表示得了。 */
const sameGraph = (
  flow: Flow,
  steps: readonly StepDef[],
  edges: readonly WorkflowEdge[],
  seen: ReadonlySet<string>,
): boolean => {
  // 沒有分流時 `toDefinition` 輸出 `edges: null`(直線);比對用「實際的連線」,直線 = 陣列順序兩兩相連,
  // 所以帶單鏈 `edges` 的直線版本(domain 認為合法)也對得上
  const rebuiltEdges = new Set(
    effectiveEdgesOf(toDefinition(flow)).map((edge) => edgeIdOf(edge)),
  );
  const originalEdges = new Set(edges.map((edge) => edgeIdOf(edge)));
  return (
    allStepsOf(flow).length === steps.length &&
    steps.every((step) => seen.has(step.key)) &&
    rebuiltEdges.size === originalEdges.size &&
    [...originalEdges].every((id) => rebuiltEdges.has(id))
  );
};

/**
 * 版本定義 → 段落串;**表示不了就回 null**(手改 JSON、舊資料、檢查器會擋的形狀:多起點、巢狀、交叉…)。
 * 回 null 時設計器改成唯讀顯示 + 檢查結果,不去猜使用者要的是什麼。
 */
export const parseFlow = (definition: WorkflowDefinition): Flow | null => {
  const { steps } = definition;
  const edges = definition.edges ?? [];
  if (edges.length === 0) {
    return steps.some((step) => isJoinStep(step))
      ? null
      : steps.map((step) => ({ type: "step", step: step as ReviewStepDef }));
  }
  const outOf = new Map<string, string[]>();
  const targets = new Set<string>();
  for (const edge of edges) {
    outOf.set(edge.from, [...(outOf.get(edge.from) ?? []), edge.to]);
    targets.add(edge.to);
  }
  const starts = steps.filter((step) => !targets.has(step.key));
  if (starts.length !== 1) {
    return null;
  }
  const graph: GraphIndex = {
    byKey: new Map(steps.map((step) => [step.key, step])),
    outOf,
    seen: new Set(),
  };
  const flow = walkMain(graph, starts[0]);
  return flow !== null && sameGraph(flow, steps, edges, graph.seen)
    ? flow
    : null;
};
