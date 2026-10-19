import type { WorkflowIssueCollector } from "./issues";
import { type StepDef, type WorkflowEdge, isJoinStep } from "./types";

/**
 * 流程的**結構**檢查(只在版本有 `edges` 時跑,全部是錯誤):
 * 6b 允許的形狀 = 直線上可以有多組「分流 → 分支 → 匯合」,不可巢狀、不可交叉、不可迴圈,
 * 審核關卡入線 ≤ 1、匯合入線 ≥ 2 且只接一個審核關卡或結束,分流與匯合明確配對。
 */
export function validateWorkflowStructure(
  steps: readonly StepDef[],
  edges: readonly WorkflowEdge[],
  collector: WorkflowIssueCollector,
): void {
  const byKey = new Map(steps.map((step) => [step.key, step]));
  const graph = buildGraph(byKey, edges, collector);
  checkEnds(steps, graph, collector);
  const hasCycle = checkCycle(steps, graph, collector);
  checkReachability(steps, graph, collector);
  checkDegrees(steps, byKey, graph, collector);
  if (!hasCycle) {
    checkForkJoinPairs(steps, byKey, graph, collector);
  }
}

interface Graph {
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
}

const indexOf = (steps: readonly StepDef[], key: string): number =>
  steps.findIndex((step) => step.key === key);

/** 去掉引用不存在節點的連線與重複連線(各記一筆錯),組出前後鄰接表。 */
function buildGraph(
  byKey: ReadonlyMap<string, StepDef>,
  edges: readonly WorkflowEdge[],
  collector: WorkflowIssueCollector,
): Graph {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const key of byKey.keys()) {
    outgoing.set(key, []);
    incoming.set(key, []);
  }
  const seen = new Set<string>();
  for (const [edgeIndex, edge] of edges.entries()) {
    const missing = [edge.from, edge.to].filter((key) => !byKey.has(key));
    if (missing.length > 0) {
      collector.error(
        "EDGE_UNKNOWN_STEP",
        `連線引用了不存在的關卡:${missing.join("、")}`,
        { edgeIndex },
      );
      continue;
    }
    const pair = `${edge.from}\u0000${edge.to}`;
    if (seen.has(pair)) {
      collector.error("EDGE_DUPLICATE", `${edge.from} → ${edge.to} 重複連線`, {
        edgeIndex,
        stepKey: edge.from,
      });
      continue;
    }
    seen.add(pair);
    outgoing.get(edge.from)?.push(edge.to);
    incoming.get(edge.to)?.push(edge.from);
  }
  return { outgoing, incoming };
}

function outOf(graph: Graph, key: string): string[] {
  return graph.outgoing.get(key) ?? [];
}

function inOf(graph: Graph, key: string): string[] {
  return graph.incoming.get(key) ?? [];
}

/** 恰好一個起點(沒有入線)與一個終點(沒有出線)。 */
function checkEnds(
  steps: readonly StepDef[],
  graph: Graph,
  collector: WorkflowIssueCollector,
): void {
  const starts = steps.filter((step) => inOf(graph, step.key).length === 0);
  const ends = steps.filter((step) => outOf(graph, step.key).length === 0);
  if (starts.length !== 1) {
    collector.error(
      "START_NOT_UNIQUE",
      starts.length === 0
        ? "流程沒有起點(每一關都有入線)"
        : `流程有多個起點:${starts.map((step) => step.key).join("、")}`,
      starts[1] === undefined ? {} : { stepKey: starts[1].key },
    );
  }
  if (ends.length !== 1) {
    collector.error(
      "END_NOT_UNIQUE",
      ends.length === 0
        ? "流程沒有終點(每一關都有出線)"
        : `流程有多個終點:${ends.map((step) => step.key).join("、")}`,
      ends[1] === undefined ? {} : { stepKey: ends[1].key },
    );
  }
}

/** 迴圈(含自己連自己):每個迴圈回報一次,定位在回頭的那條連線的起點。 */
function checkCycle(
  steps: readonly StepDef[],
  graph: Graph,
  collector: WorkflowIssueCollector,
): boolean {
  const state = new Map<string, "visiting" | "done">();
  let hasCycle = false;
  const visit = (key: string): void => {
    state.set(key, "visiting");
    for (const next of outOf(graph, key)) {
      const nextState = state.get(next);
      if (nextState === "visiting") {
        hasCycle = true;
        collector.error("CYCLE", `${key} → ${next} 形成迴圈`, {
          stepKey: key,
          stepIndex: indexOf(steps, key),
        });
      } else if (nextState === undefined) {
        visit(next);
      }
    }
    state.set(key, "done");
  };
  for (const step of steps) {
    if (!state.has(step.key)) {
      visit(step.key);
    }
  }
  return hasCycle;
}

/** 唯一起點時:每關都要從起點可達;唯一終點時:每關都要能走到終點。 */
function checkReachability(
  steps: readonly StepDef[],
  graph: Graph,
  collector: WorkflowIssueCollector,
): void {
  const starts = steps.filter((step) => inOf(graph, step.key).length === 0);
  const ends = steps.filter((step) => outOf(graph, step.key).length === 0);
  const flagged = new Set<string>();
  const flag = (key: string, message: string): void => {
    if (flagged.has(key)) {
      return;
    }
    flagged.add(key);
    collector.error("UNREACHABLE", message, {
      stepKey: key,
      stepIndex: indexOf(steps, key),
    });
  };
  if (starts.length === 1 && starts[0] !== undefined) {
    const reached = walk(starts[0].key, (key) => outOf(graph, key));
    for (const step of steps) {
      if (!reached.has(step.key)) {
        flag(step.key, `${step.key} 從起點走不到`);
      }
    }
  }
  if (ends.length === 1 && ends[0] !== undefined) {
    const reached = walk(ends[0].key, (key) => inOf(graph, key));
    for (const step of steps) {
      if (!reached.has(step.key)) {
        flag(step.key, `${step.key} 走不到終點`);
      }
    }
  }
}

function walk(
  from: string,
  neighbours: (key: string) => string[],
): Set<string> {
  const reached = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const key = queue.shift() ?? "";
    for (const next of neighbours(key)) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  return reached;
}

/** 入線 / 出線數:審核關卡入線 ≤ 1;匯合入線 ≥ 2、出線 ≤ 1 且只能接審核關卡。 */
function checkDegrees(
  steps: readonly StepDef[],
  byKey: ReadonlyMap<string, StepDef>,
  graph: Graph,
  collector: WorkflowIssueCollector,
): void {
  for (const [stepIndex, step] of steps.entries()) {
    const location = { stepKey: step.key, stepIndex };
    const incoming = inOf(graph, step.key);
    const outgoing = outOf(graph, step.key);
    if (!isJoinStep(step)) {
      if (incoming.length > 1) {
        collector.error(
          "REVIEW_MULTIPLE_INCOMING",
          `審核關卡 ${step.key} 有 ${String(incoming.length)} 條入線;多條分支要先匯合到匯合節點`,
          location,
        );
      }
      continue;
    }
    if (incoming.length < 2) {
      collector.error(
        "JOIN_TOO_FEW_INCOMING",
        `匯合節點 ${step.key} 至少要有兩條入線`,
        location,
      );
    }
    const joinTargets = outgoing.filter((key) => {
      const target = byKey.get(key);
      return target !== undefined && isJoinStep(target);
    });
    if (outgoing.length > 1 || joinTargets.length > 0) {
      collector.error(
        "JOIN_OUTGOING_INVALID",
        `匯合節點 ${step.key} 之後只能結束或接一個審核關卡`,
        location,
      );
    }
  }
}

/** 一條分支的走訪結果。 */
interface Branch {
  /** 分支上依序的審核關卡。 */
  nodes: string[];
  /** 分支匯到的匯合節點;沒匯到任何匯合節點 = null。 */
  joinKey: string | null;
  /** 分支內出現多條出線的節點(巢狀分流或交叉連線)。 */
  splitAt: string | null;
  /** 走到一個已被別的分支佔用的節點。 */
  crossedAt: string | null;
}

/**
 * 分流 / 匯合配對:每個分流(審核關卡出線 ≥ 2)的每條出線是一條分支,沿單一出線往下走到匯合節點;
 * 所有分支要匯到**同一個**匯合節點,且該匯合節點的入線要**全部**來自這個分流的分支。
 * 分支內再分流 = 巢狀;分支之間互連 = 交叉;沒有任何分流配對的匯合節點 = 不配對。
 */
function checkForkJoinPairs(
  steps: readonly StepDef[],
  byKey: ReadonlyMap<string, StepDef>,
  graph: Graph,
  collector: WorkflowIssueCollector,
): void {
  const context: PairContext = {
    graph,
    collector,
    pairedJoins: new Map<string, string>(),
    location: (key: string) => ({
      stepKey: key,
      stepIndex: indexOf(steps, key),
    }),
  };
  for (const fork of steps) {
    const targets = outOf(graph, fork.key);
    if (isJoinStep(fork) || targets.length < 2) {
      continue;
    }
    const owner = new Map<string, number>();
    const branches = targets.map((start, branchIndex) =>
      walkBranch(start, branchIndex, byKey, graph, owner),
    );
    if (reportBrokenBranches(fork.key, branches, owner, context)) {
      continue;
    }
    pairJoin(fork.key, branches, context);
  }
  for (const step of steps) {
    if (
      isJoinStep(step) &&
      !context.pairedJoins.has(step.key) &&
      !collectorMentions(collector, step.key)
    ) {
      collector.error(
        "FORK_JOIN_MISMATCH",
        `匯合節點 ${step.key} 沒有對應的分流`,
        context.location(step.key),
      );
    }
  }
}

interface PairContext {
  graph: Graph;
  collector: WorkflowIssueCollector;
  /** 匯合節點 → 配對到的分流。 */
  pairedJoins: Map<string, string>;
  location: (key: string) => { stepKey: string; stepIndex: number };
}

/** 分支本身壞掉(交叉、巢狀、空分支)就報錯並回 true,不再做配對。 */
function reportBrokenBranches(
  forkKey: string,
  branches: readonly Branch[],
  owner: ReadonlyMap<string, number>,
  context: PairContext,
): boolean {
  const { collector, graph, location } = context;
  let isBroken = false;
  for (const branch of branches) {
    if (branch.crossedAt !== null) {
      isBroken = true;
      collector.error(
        "CROSS_BRANCH",
        `${branch.crossedAt} 同時屬於 ${forkKey} 的兩條分支(分支之間不能互連)`,
        location(branch.crossedAt),
      );
    }
    if (branch.splitAt !== null) {
      isBroken = true;
      const splitAt = branch.splitAt;
      const ownBranch = owner.get(splitAt);
      const isCross = outOf(graph, splitAt).some((key) => {
        const branchOfTarget = owner.get(key);
        return branchOfTarget !== undefined && branchOfTarget !== ownBranch;
      });
      collector.error(
        isCross ? "CROSS_BRANCH" : "NESTED_FORK",
        isCross
          ? `${splitAt} 連到了 ${forkKey} 的另一條分支(分支之間不能互連)`
          : `${splitAt} 在 ${forkKey} 的分支裡又分流(不支援巢狀平行)`,
        location(splitAt),
      );
    }
    if (branch.joinKey !== null && branch.nodes.length === 0) {
      isBroken = true;
      collector.error(
        "BRANCH_EMPTY",
        `${forkKey} 直接連到匯合節點 ${branch.joinKey};每條分支至少要有一個審核關卡`,
        location(forkKey),
      );
    }
  }
  return isBroken;
}

/** 所有分支匯到同一個匯合節點、該節點入線全來自這些分支、且沒有被別的分流配對過。 */
function pairJoin(
  forkKey: string,
  branches: readonly Branch[],
  context: PairContext,
): void {
  const { collector, graph, location, pairedJoins } = context;
  const joinKeys = new Set(branches.map((branch) => branch.joinKey));
  const [joinKey] = [...joinKeys];
  if (joinKeys.size !== 1 || joinKey === null || joinKey === undefined) {
    collector.error(
      "FORK_JOIN_MISMATCH",
      `${forkKey} 的分支沒有全部匯到同一個匯合節點`,
      location(forkKey),
    );
    return;
  }
  const branchEnds = new Set(
    branches.map((branch) => branch.nodes.at(-1) ?? forkKey),
  );
  const foreign = inOf(graph, joinKey).filter((key) => !branchEnds.has(key));
  if (foreign.length > 0) {
    collector.error(
      "FORK_JOIN_MISMATCH",
      `匯合節點 ${joinKey} 的入線 ${foreign.join("、")} 不是來自 ${forkKey} 的分支`,
      location(joinKey),
    );
    return;
  }
  const previousFork = pairedJoins.get(joinKey);
  if (previousFork !== undefined) {
    collector.error(
      "FORK_JOIN_MISMATCH",
      `匯合節點 ${joinKey} 同時配對了 ${previousFork} 與 ${forkKey}`,
      location(joinKey),
    );
    return;
  }
  pairedJoins.set(joinKey, forkKey);
}

/** 同一個匯合節點已有配對類的錯誤時,不再重複報「沒有對應的分流」。 */
function collectorMentions(
  collector: WorkflowIssueCollector,
  stepKey: string,
): boolean {
  return collector.errors.some(
    (issue) =>
      issue.location.stepKey === stepKey &&
      (issue.code === "FORK_JOIN_MISMATCH" ||
        issue.code === "JOIN_TOO_FEW_INCOMING"),
  );
}

/** 從分流的某條出線往下走:遇到匯合節點停、遇到多條出線或沒有出線停。 */
function walkBranch(
  start: string,
  branchIndex: number,
  byKey: ReadonlyMap<string, StepDef>,
  graph: Graph,
  owner: Map<string, number>,
): Branch {
  const branch: Branch = {
    nodes: [],
    joinKey: null,
    splitAt: null,
    crossedAt: null,
  };
  let current: string | undefined = start;
  while (current !== undefined) {
    const node = byKey.get(current);
    if (node === undefined) {
      return branch;
    }
    if (isJoinStep(node)) {
      branch.joinKey = current;
      return branch;
    }
    const claimedBy = owner.get(current);
    if (claimedBy !== undefined && claimedBy !== branchIndex) {
      branch.crossedAt = current;
      return branch;
    }
    owner.set(current, branchIndex);
    branch.nodes.push(current);
    const outgoing = outOf(graph, current);
    if (outgoing.length > 1) {
      branch.splitAt = current;
      return branch;
    }
    current = outgoing[0];
  }
  return branch;
}
