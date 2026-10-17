import { describe, expect, it } from "@jest/globals";

import {
  type JoinStepDef,
  type ReviewStepDef,
  type WorkflowDefinition,
  validateWorkflowDefinition,
} from "@repo/domain/workflow";

import {
  type Flow,
  definitionFingerprint,
  parseFlow,
  reviewStepsOf,
  toDefinition,
} from "./flow-model";
import {
  addBranch,
  appendToBranch,
  forkFrom,
  insertAfter,
  insertAfterJoin,
  moveStep,
  newReviewStep,
  removeParallel,
  removeStep,
  shiftStep,
} from "./flow-ops";

const step = (key: string): ReviewStepDef => newReviewStep(key, key);
const join = (key: string): JoinStepDef => ({ key, name: key, kind: "join" });

/** 採購單(Spec 6b §2 平行分支的例子):初審 → 財務 / 法務 / 採購 → 匯合 → 原部門確認。 */
const purchaseFlow = (): Flow => [
  { type: "step", step: step("review") },
  {
    type: "parallel",
    branches: [[step("finance")], [step("legal")], [step("purchase")]],
    join: join("merge"),
  },
  { type: "step", step: step("confirm") },
];

const keysOf = (flow: Flow): string[] =>
  reviewStepsOf(flow).map((item) => item.key);

const flowOf = (result: ReturnType<typeof removeStep>): Flow => {
  if (!result.ok) {
    throw new Error(`操作被拒:${result.error}`);
  }
  return result.flow;
};

describe("段落串 ⇄ 版本定義", () => {
  it("沒有分流 = 直線:edges 為 null,陣列順序就是流程", () => {
    const definition = toDefinition([
      { type: "step", step: step("manager") },
      { type: "step", step: step("hr") },
    ]);

    expect(definition.edges).toBeNull();
    expect(definition.steps.map((item) => item.key)).toEqual(["manager", "hr"]);
  });

  it("分流 → 各分支 → 匯合 → 後續關卡的連線;過得了 domain 的結構檢查", () => {
    const definition = toDefinition(purchaseFlow());

    expect(definition.edges).toEqual([
      { from: "review", to: "finance" },
      { from: "finance", to: "merge" },
      { from: "review", to: "legal" },
      { from: "legal", to: "merge" },
      { from: "review", to: "purchase" },
      { from: "purchase", to: "merge" },
      { from: "merge", to: "confirm" },
    ]);
    expect(
      validateWorkflowDefinition(definition, { isShared: false }).errors,
    ).toEqual([]);
  });

  it("解析再輸出完全相同(節點陣列順序打亂也一樣)", () => {
    const definition = toDefinition(purchaseFlow());
    const shuffled: WorkflowDefinition = {
      steps: definition.steps.toReversed(),
      edges: definition.edges,
    };

    const parsed = parseFlow(shuffled);

    expect(parsed).not.toBeNull();
    expect(toDefinition(parsed ?? []).edges).toEqual(definition.edges);
  });

  it("直線寫成單鏈 edges(A → B → C)也解析得了,且與 edges: null 的寫法視為同一份", () => {
    const chain: WorkflowDefinition = {
      steps: [step("a"), step("b"), step("c")],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    };

    const parsed = parseFlow(chain);

    expect(parsed?.map((item) => item.type)).toEqual(["step", "step", "step"]);
    expect(definitionFingerprint(toDefinition(parsed ?? []))).toBe(
      definitionFingerprint(chain),
    );
  });

  it("比對字串不看陣列順序與鍵順序:節點 / 連線打亂、同一關的屬性順序不同,仍視為沒改", () => {
    const definition = toDefinition(purchaseFlow());
    const shuffled: WorkflowDefinition = {
      steps: definition.steps
        .toReversed()
        .map((item) => Object.fromEntries(Object.entries(item).toReversed()))
        .map((item) => item as (typeof definition.steps)[number]),
      edges: definition.edges?.toReversed() ?? null,
    };

    expect(definitionFingerprint(shuffled)).toBe(
      definitionFingerprint(definition),
    );
    expect(definitionFingerprint(toDefinition(parseFlow(shuffled) ?? []))).toBe(
      definitionFingerprint(definition),
    );
  });

  it("匯合後沒有出線(三部門都過就結案)也解析得了", () => {
    const flow = purchaseFlow().slice(0, 2);

    expect(parseFlow(toDefinition(flow))).toEqual(flow);
  });

  it("表示不了的形狀回 null:巢狀分流、交叉連線、直線裡的匯合節點", () => {
    const nested: WorkflowDefinition = {
      steps: [
        step("a"),
        step("b"),
        step("c"),
        step("d"),
        join("inner"),
        join("outer"),
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
        { from: "b", to: "d" },
        { from: "b", to: "inner" },
        { from: "d", to: "inner" },
        { from: "inner", to: "outer" },
        { from: "c", to: "outer" },
      ],
    };
    const cross: WorkflowDefinition = {
      steps: [step("a"), step("b"), step("c"), join("j")],
      edges: [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
        { from: "b", to: "c" },
        { from: "b", to: "j" },
        { from: "c", to: "j" },
      ],
    };

    expect(parseFlow(nested)).toBeNull();
    expect(parseFlow(cross)).toBeNull();
    expect(parseFlow({ steps: [step("a"), join("j")] })).toBeNull();
  });
});

describe("從此關分流 / 加關卡", () => {
  it("在主線關卡後建 N 條分支與一個匯合節點,選中第一條分支", () => {
    const result = forkFrom(
      [{ type: "step", step: step("review") }],
      "review",
      [step("finance"), step("legal")],
      join("merge"),
    );

    expect(result.ok && result.selectedKey).toBe("finance");
    const definition = toDefinition(flowOf(result));
    expect(definition.steps.map((item) => item.kind)).toEqual([
      "review",
      "review",
      "review",
      "join",
    ]);
  });

  it("分支內不能再分流(巢狀)、已分流的關卡不能再分一次", () => {
    expect(
      forkFrom(purchaseFlow(), "finance", [step("x"), step("y")], join("j2")),
    ).toEqual({ ok: false, error: "NESTED_FORK" });
    expect(
      forkFrom(purchaseFlow(), "review", [step("x"), step("y")], join("j2")),
    ).toEqual({ ok: false, error: "ALREADY_FORKED" });
  });

  it("分支內可以再加關卡,也可以多加一條分支", () => {
    const withStep = flowOf(
      appendToBranch(purchaseFlow(), "merge", 1, step("legal_2")),
    );
    const withBranch = flowOf(addBranch(withStep, "merge", step("audit")));

    expect(keysOf(withBranch)).toEqual([
      "review",
      "finance",
      "legal",
      "legal_2",
      "purchase",
      "audit",
      "confirm",
    ]);
  });

  it("匯合節點後可以接關卡;在分支關卡後面加一關會留在同一條分支", () => {
    const flow = purchaseFlow().slice(0, 2);
    const afterJoin = flowOf(insertAfterJoin(flow, "merge", step("final")));
    const inBranch = flowOf(insertAfter(afterJoin, "finance", step("cfo")));

    expect(toDefinition(inBranch).edges).toContainEqual({
      from: "finance",
      to: "cfo",
    });
    expect(toDefinition(inBranch).edges).toContainEqual({
      from: "merge",
      to: "final",
    });
  });
});

describe("刪除", () => {
  it("刪審核關卡:連線自動接上", () => {
    const flow = flowOf(removeStep(purchaseFlow(), "confirm"));

    expect(
      toDefinition(flow).edges?.some((edge) => edge.from === "merge"),
    ).toBe(false);
  });

  it("刪掉分支最後一關 = 刪那條分支;只剩一條分支時整組收成直線", () => {
    const twoBranches = flowOf(removeStep(purchaseFlow(), "purchase"));
    const linear = flowOf(removeStep(twoBranches, "legal"));

    expect(twoBranches.find((item) => item.type === "parallel")).toBeDefined();
    expect(linear.every((item) => item.type === "step")).toBe(true);
    expect(keysOf(linear)).toEqual(["review", "finance", "confirm"]);
    expect(toDefinition(linear).edges).toBeNull();
  });

  it("刪掉整組分流:連同匯合節點一起刪", () => {
    const flow = flowOf(removeParallel(purchaseFlow(), "merge"));

    expect(keysOf(flow)).toEqual(["review", "confirm"]);
    expect(toDefinition(flow).steps.some((item) => item.kind === "join")).toBe(
      false,
    );
  });

  it("分流來源前面沒有關卡時不能刪(分流會懸空);最後一關不能刪", () => {
    expect(removeStep(purchaseFlow(), "review")).toEqual({
      ok: false,
      error: "FORK_NEEDS_SOURCE",
    });
    expect(removeStep([{ type: "step", step: step("only") }], "only")).toEqual({
      ok: false,
      error: "LAST_STEP",
    });
  });
});

describe("移動(拖節點 / 上移下移)", () => {
  it("同一分支內改順序、移到別條分支", () => {
    const flow = flowOf(
      appendToBranch(purchaseFlow(), "merge", 0, step("finance_2")),
    );
    const reordered = flowOf(
      moveStep(flow, "finance_2", { kind: "before", stepKey: "finance" }),
    );
    const moved = flowOf(
      moveStep(reordered, "finance", {
        kind: "branchEnd",
        joinKey: "merge",
        branch: 2,
      }),
    );

    expect(keysOf(reordered).slice(1, 3)).toEqual(["finance_2", "finance"]);
    expect(toDefinition(moved).edges).toContainEqual({
      from: "purchase",
      to: "finance",
    });
  });

  it("把分支唯一的一關移走會留下空分支 → 拒絕;分流來源不能移", () => {
    expect(
      moveStep(purchaseFlow(), "legal", { kind: "after", stepKey: "confirm" }),
    ).toEqual({ ok: false, error: "BRANCH_WOULD_BE_EMPTY" });
    expect(
      moveStep(purchaseFlow(), "review", { kind: "after", stepKey: "confirm" }),
    ).toEqual({ ok: false, error: "FORK_NEEDS_SOURCE" });
  });

  it("主線上移 / 下移;跨過一整組分流時接到匯合之後", () => {
    const flow: Flow = [
      { type: "step", step: step("a") },
      { type: "step", step: step("b") },
      ...purchaseFlow().slice(1),
    ];
    // b 是分流來源 → 不能動;a 下移會碰到 b(分流來源)之後
    expect(shiftStep(flow, "b", 1)).toEqual({
      ok: false,
      error: "FORK_NEEDS_SOURCE",
    });
    const swapped = flowOf(shiftStep(flow, "confirm", -1));
    expect(keysOf(swapped)).toEqual([
      "a",
      "confirm",
      "b",
      "finance",
      "legal",
      "purchase",
    ]);
  });
});
