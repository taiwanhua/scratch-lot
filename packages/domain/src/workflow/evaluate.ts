import type {
  AcceptedDecision,
  ApprovalMode,
  HistoryEvent,
  InstanceOutcome,
  InstanceSnapshot,
  StepState,
  TerminalDecision,
} from "./types";

/**
 * 決定順序的判定(`evaluateStep` 與全案終局)。
 *
 * 接受順序 = 決定被原子寫進實例的順序:同一關看 `decisions[]` 的陣列順序,
 * 跨關看同一次原子追加的 `history` 事件序號(`historyIndex`)。
 */

/** 一關依決定算出的**有效結果**。 */
export type StepResult =
  | { kind: "none" }
  | { kind: "completed" }
  | {
      kind: TerminalDecision;
      taskKey: string;
      /**
       * 該決定的接受序號(`history` 裡對應事件的索引)。找不到事件 = `null`:決定與事件是同一次
       * 原子寫入,缺了代表資料損毀 —— 不拿 `Infinity` 或陣列順序硬湊,由 `advance` 回 `invalidState`。
       */
      historyIndex: number | null;
    };

export interface StepEvaluation {
  result: StepResult;
  /** 算數的決定(`any` 的第一筆;`all` 第一筆駁回 / 退回之前的核准 + 那筆駁回 / 退回)。 */
  effectiveTaskKeys: Set<string>;
  /** 被接受但不算數的決定(`late`)。 */
  lateTaskKeys: Set<string>;
}

/**
 * 某個決定在 `history` 的事件序號:同一次原子更新追加的那筆
 * (`kind` = 決定種類、`taskKey` 相同;每個 `taskKey` 最多一筆決定,所以唯一)。
 */
export function historyIndexOf(
  history: readonly HistoryEvent[],
  decision: Pick<AcceptedDecision, "taskKey" | "decision">,
): number | null {
  const index = history.findIndex(
    (event) =>
      event.kind === decision.decision && event.taskKey === decision.taskKey,
  );
  return index === -1 ? null : index;
}

/**
 * 一關的有效結果:
 * - `any`:第一筆決定就是結果(核准 → 完成;駁回 / 退回 → 那筆),之後的都 `late`
 * - `all`:第一筆駁回 / 退回是結果(之後的都 `late`,它之前的核准仍算數);
 *   否則要 **`plan.length > 0` 且每個計畫項目都有核准**才算完成 —— 空計畫永遠不算完成
 */
export function evaluateStep(
  mode: ApprovalMode,
  state: Pick<StepState, "plan" | "decisions">,
  history: readonly HistoryEvent[],
): StepEvaluation {
  const effectiveTaskKeys = new Set<string>();
  const lateTaskKeys = new Set<string>();
  const [first, ...rest] = state.decisions;
  if (first === undefined) {
    return { result: { kind: "none" }, effectiveTaskKeys, lateTaskKeys };
  }
  if (mode === "any") {
    effectiveTaskKeys.add(first.taskKey);
    for (const later of rest) {
      lateTaskKeys.add(later.taskKey);
    }
    return {
      result: resultOf(first, history),
      effectiveTaskKeys,
      lateTaskKeys,
    };
  }
  let terminal: AcceptedDecision | undefined;
  for (const decision of state.decisions) {
    if (terminal !== undefined) {
      lateTaskKeys.add(decision.taskKey);
      continue;
    }
    effectiveTaskKeys.add(decision.taskKey);
    if (decision.decision !== "approved") {
      terminal = decision;
    }
  }
  if (terminal !== undefined) {
    return {
      result: resultOf(terminal, history),
      effectiveTaskKeys,
      lateTaskKeys,
    };
  }
  const approved = new Set(
    state.decisions
      .filter((decision) => decision.decision === "approved")
      .map((decision) => decision.taskKey),
  );
  const isComplete =
    state.plan.length > 0 &&
    state.plan.every((item) => approved.has(item.taskKey));
  return {
    result: isComplete ? { kind: "completed" } : { kind: "none" },
    effectiveTaskKeys,
    lateTaskKeys,
  };
}

function resultOf(
  decision: AcceptedDecision,
  history: readonly HistoryEvent[],
): StepResult {
  if (decision.decision === "approved") {
    return { kind: "completed" };
  }
  return {
    kind: decision.decision,
    taskKey: decision.taskKey,
    historyIndex: historyIndexOf(history, decision),
  };
}

/** 全案終局的一個候選(某個 active 關卡的有效駁回 / 退回)。 */
export type OutcomeCandidate = InstanceOutcome;

/**
 * 全案終局選取:所有候選(各 active 關卡的有效駁回 / 退回)裡取接受順序最早的一筆。
 * `any` 關卡內被第一筆蓋掉的後續駁回本來就不是有效結果,不會進候選。沒有候選 → null。
 */
export function selectOutcome(
  candidates: readonly OutcomeCandidate[],
): InstanceOutcome | null {
  let earliest: OutcomeCandidate | null = null;
  for (const candidate of candidates) {
    if (earliest === null || candidate.historyIndex < earliest.historyIndex) {
      earliest = candidate;
    }
  }
  return earliest === null
    ? null
    : {
        kind: earliest.kind,
        stepKey: earliest.stepKey,
        taskKey: earliest.taskKey,
        historyIndex: earliest.historyIndex,
      };
}

/** 實例裡某關的狀態;找不到 → undefined。 */
export function stepStateOf(
  instance: Pick<InstanceSnapshot, "steps">,
  stepKey: string,
): StepState | undefined {
  return instance.steps.find((step) => step.stepKey === stepKey);
}
