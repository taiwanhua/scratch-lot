import { describe, expect, it } from "@jest/globals";

import { advance } from "./advance";
import {
  autoApprovalCandidates,
  isApplicantInSkipOrgs,
  priorApproverIds,
} from "./plan";
import type { InstanceSnapshot, WorkflowDefinition } from "./types";
import { SKIP_ORG_TENANT } from "./types";
import {
  APPLICANT,
  NOW,
  decide,
  entered,
  newInstance,
  review,
  reviewingSubmission,
  runAdvance,
  taskStatusOf,
  withStep,
  worldOf,
} from "./workflow-test-support";

/** 組織樹:tenant → store → kitchen;另一棵 other(同租戶的另一間店)。 */
const KITCHEN = { id: "kitchen", ancestorIds: ["root", "tenant", "store"] };
const OTHER = { id: "other", ancestorIds: ["root", "tenant"] };

describe("B4 申請人屬於這些組織(isApplicantInSkipOrgs)", () => {
  it("所屬組織本身在名單 → 成立;不勾含下層時上層組織不算", () => {
    expect(
      isApplicantInSkipOrgs(
        { orgIds: ["kitchen"], includeDescendants: false },
        [KITCHEN],
        "tenant",
      ),
    ).toBe(true);
    expect(
      isApplicantInSkipOrgs(
        { orgIds: ["store"], includeDescendants: false },
        [KITCHEN],
        "tenant",
      ),
    ).toBe(false);
  });

  it("勾含下層 → 名單組織是所屬組織的祖先也成立", () => {
    expect(
      isApplicantInSkipOrgs(
        { orgIds: ["store"], includeDescendants: true },
        [KITCHEN],
        "tenant",
      ),
    ).toBe(true);
  });

  it("判斷申請人所屬組織(全部):任一個符合就成立", () => {
    expect(
      isApplicantInSkipOrgs(
        { orgIds: ["other"], includeDescendants: false },
        [KITCHEN, OTHER],
        "tenant",
      ),
    ).toBe(true);
  });

  it("「租戶」特殊值代入租戶 id:不含下層 = 直接屬於租戶頂層;含下層 = 租戶裡任何組織", () => {
    const tenantOnly = { orgIds: [SKIP_ORG_TENANT], includeDescendants: false };
    expect(isApplicantInSkipOrgs(tenantOnly, [KITCHEN], "tenant")).toBe(false);
    expect(
      isApplicantInSkipOrgs(
        tenantOnly,
        [{ id: "tenant", ancestorIds: ["root"] }],
        "tenant",
      ),
    ).toBe(true);
    expect(
      isApplicantInSkipOrgs(
        { orgIds: [SKIP_ORG_TENANT], includeDescendants: true },
        [KITCHEN],
        "tenant",
      ),
    ).toBe(true);
    // 租戶讀不到(null)→ 「租戶」不代入任何組織
    expect(
      isApplicantInSkipOrgs(
        { orgIds: [SKIP_ORG_TENANT], includeDescendants: true },
        [KITCHEN],
        null,
      ),
    ).toBe(false);
  });

  it("沒有所屬組織 → 不成立", () => {
    expect(
      isApplicantInSkipOrgs(
        { orgIds: [SKIP_ORG_TENANT], includeDescendants: true },
        [],
        "tenant",
      ),
    ).toBe(false);
  });
});

describe("B4 跳過:時間軸記是哪一項成立", () => {
  const definition: WorkflowDefinition = {
    steps: [review("boss"), review("hr")],
  };

  it("跳過帶原因 → step_skipped 帶 reason,關卡 skipped、啟動下一關", () => {
    const plan = advance({
      definition,
      instance: newInstance(definition),
      tasks: [],
      submission: null,
      now: NOW,
      stepEntries: { boss: { kind: "skip", reason: "skip_orgs" } },
    });
    expect(plan.actions[0]).toMatchObject({
      update: {
        activeStepKeys: ["hr"],
        steps: { boss: { status: "skipped" } },
        pushHistory: [
          { kind: "step_skipped", stepKey: "boss", reason: "skip_orgs" },
        ],
      },
    });
  });
});

/** 三關直線:first → second → third(審核者由各測試的進關結果決定)。 */
function linear(
  overrides: Parameters<typeof review>[1] = {},
): WorkflowDefinition {
  return {
    steps: [review("first"), review("second"), review("third", overrides)],
  };
}

/** first、second 都已完成,third 剛進 active(還沒派人)。 */
function atThird(
  definition: WorkflowDefinition,
  decisions: { stepKey: string; userId: string }[],
): InstanceSnapshot {
  let instance = newInstance(definition);
  for (const stepKey of ["first", "second"]) {
    const users = decisions
      .filter((one) => one.stepKey === stepKey)
      .map((one) => one.userId);
    instance = entered(
      instance,
      stepKey,
      users.length > 0 ? users : [`${stepKey}-reviewer`],
    );
    const state = instance.steps.find((step) => step.stepKey === stepKey);
    for (const item of state?.plan ?? []) {
      instance = decide(instance, stepKey, item.taskKey, "approved");
    }
    instance = withStep(instance, stepKey, { status: "completed" });
  }
  return { ...instance, activeStepKeys: ["third"] };
}

describe("B5 已在前面的關卡核准過(priorApproverIds / autoApprovalCandidates)", () => {
  it("審核者在這一輪更早的關卡親自核准過 → 候選(auto_prior_approver)", () => {
    const definition = linear({ autoApprove: { priorApprover: true } });
    const instance = atThird(definition, [{ stepKey: "first", userId: "u1" }]);
    expect(
      autoApprovalCandidates(
        definition,
        instance,
        review("third", {
          autoApprove: { priorApprover: true },
        }),
        ["u1", "u2"],
      ),
    ).toEqual([{ assigneeId: "u1", reason: "auto_prior_approver" }]);
  });

  it("更早那一票是 B5「申請人是審核者」自動通過、記在申請人名下 → 也算", () => {
    const step = review("third", { autoApprove: { priorApprover: true } });
    const definition = linear({ autoApprove: { priorApprover: true } });
    const instance = atThird(definition, [
      { stepKey: "first", userId: APPLICANT },
    ]);
    expect(priorApproverIds(definition, instance, "third")).toEqual(
      new Set([APPLICANT, "second-reviewer"]),
    );
    expect(
      autoApprovalCandidates(definition, instance, step, [APPLICANT]),
    ).toEqual([{ assigneeId: APPLICANT, reason: "auto_prior_approver" }]);
  });

  it("更早那一關由代理人代為核准(決定記在代理人名下)→ 只算代理人,原審核者不算", () => {
    const step = review("third", { autoApprove: { priorApprover: true } });
    const definition = linear({ autoApprove: { priorApprover: true } });
    // 第一關的任務原本是 owner 的,由代理人 deputy 代為核准:決定記在 deputy 名下
    let instance = atThird(definition, [{ stepKey: "first", userId: "owner" }]);
    instance = {
      ...instance,
      steps: instance.steps.map((state) =>
        state.stepKey === "first"
          ? {
              ...state,
              decisions: state.decisions.map((decision) => ({
                ...decision,
                userId: "deputy",
              })),
            }
          : state,
      ),
    };
    expect(
      autoApprovalCandidates(definition, instance, step, ["owner", "deputy"]),
    ).toEqual([{ assigneeId: "deputy", reason: "auto_prior_approver" }]);
  });

  it("新一輪(新的實例)沒有更早的核准 → 沒有候選", () => {
    const step = review("first", { autoApprove: { priorApprover: true } });
    const definition = linear();
    expect(
      autoApprovalCandidates(definition, newInstance(definition), step, ["u1"]),
    ).toEqual([]);
  });

  it("晚於結果的核准(any 的第二筆)不算核准過;不在上游的分支也不算", () => {
    const definition: WorkflowDefinition = {
      steps: [
        review("first"),
        review("left"),
        review("right", { autoApprove: { priorApprover: true } }),
        { key: "merge", name: "merge", kind: "join" },
      ],
      edges: [
        { from: "first", to: "left" },
        { from: "first", to: "right" },
        { from: "left", to: "merge" },
        { from: "right", to: "merge" },
      ],
    };
    let instance = entered(newInstance(definition), "first", ["u1", "u2"]);
    instance = decide(instance, "first", "first-1", "approved");
    instance = decide(instance, "first", "first-2", "approved");
    instance = withStep(instance, "first", { status: "completed" });
    instance = entered(instance, "left", ["u3"]);
    instance = decide(instance, "left", "left-1", "approved");
    expect(priorApproverIds(definition, instance, "right")).toEqual(
      new Set(["u1"]),
    );
  });

  it("沒有開啟(預設)→ 沒有候選,申請人照常剔除", () => {
    const definition = linear();
    const instance = atThird(definition, [{ stepKey: "first", userId: "u1" }]);
    const step = review("third");
    expect(
      autoApprovalCandidates(definition, instance, step, ["u1", APPLICANT]),
    ).toEqual([]);
  });
});

describe("B5 自動通過:進關一次寫入核准", () => {
  it("申請人是審核者、開了自動通過 → 申請人留在計畫,記成他的核准(時間軸帶原因),該關完成", () => {
    const definition: WorkflowDefinition = {
      steps: [review("boss", { autoApprove: { applicant: true } })],
    };
    const world = worldOf(definition);
    runAdvance(world, {
      boss: {
        kind: "assign",
        assigneeIds: [APPLICANT],
        autoApprovals: [{ assigneeId: APPLICANT, reason: "auto_applicant" }],
      },
    });
    const boss = world.instance.steps.find((step) => step.stepKey === "boss");
    expect(boss?.status).toBe("completed");
    expect(boss?.plan.map((item) => item.assigneeId)).toEqual([APPLICANT]);
    expect(boss?.decisions).toEqual([
      {
        taskKey: "boss-1",
        userId: APPLICANT,
        decision: "approved",
        comment: null,
        at: NOW,
      },
    ]);
    expect(
      world.instance.history.find((event) => event.kind === "approved"),
    ).toMatchObject({
      stepKey: "boss",
      taskKey: "boss-1",
      userId: APPLICANT,
      reason: "auto_applicant",
    });
    expect(world.instance.status).toBe("approved");
    expect(taskStatusOf(world, "boss-1")).toBe("approved");
    // 自動通過的任務不寄「有新任務」
    expect(world.mails).toEqual(["result:approved"]);
  });

  it("多人會簽(all),其中一人核准過 → 只記他那一票,其他人照常審核", () => {
    const definition: WorkflowDefinition = {
      steps: [
        review("boss", { mode: "all", autoApprove: { priorApprover: true } }),
      ],
    };
    const world = worldOf(definition);
    runAdvance(world, {
      boss: {
        kind: "assign",
        assigneeIds: ["u1", "u2"],
        autoApprovals: [{ assigneeId: "u1", reason: "auto_prior_approver" }],
      },
    });
    const boss = world.instance.steps.find((step) => step.stepKey === "boss");
    expect(boss?.status).toBe("active");
    expect(boss?.decisions.map((one) => one.userId)).toEqual(["u1"]);
    expect(taskStatusOf(world, "boss-1")).toBe("approved");
    expect(taskStatusOf(world, "boss-2")).toBe("pending");
    expect(world.mails).toEqual(["task:boss-2:u2"]);
  });

  it("any 有兩位自動通過 → 只記第一位(一人核准即過)", () => {
    const definition: WorkflowDefinition = {
      steps: [review("boss", { autoApprove: { priorApprover: true } })],
    };
    const plan = advance({
      definition,
      instance: newInstance(definition),
      tasks: [],
      submission: reviewingSubmission(),
      now: NOW,
      stepEntries: {
        boss: {
          kind: "assign",
          assigneeIds: ["u1", "u2"],
          autoApprovals: [
            { assigneeId: "u1", reason: "auto_prior_approver" },
            { assigneeId: "u2", reason: "auto_prior_approver" },
          ],
        },
      },
    });
    expect(plan.actions[0]).toMatchObject({
      update: {
        steps: { boss: { decisions: [{ taskKey: "boss-1", userId: "u1" }] } },
      },
    });
  });

  it("申請人的自動通過被守門擋下 → 照一般規則剔除申請人,派給其他審核者;時間軸記原因與錯誤碼", () => {
    const definition: WorkflowDefinition = {
      steps: [review("boss", { autoApprove: { applicant: true } })],
    };
    const world = worldOf(definition);
    runAdvance(world, {
      boss: {
        kind: "assign",
        assigneeIds: [APPLICANT, "u1"],
        autoApprovals: [],
        blockedAutoApprovals: [
          {
            assigneeId: APPLICANT,
            reason: "auto_applicant",
            code: "NOT_READY",
          },
        ],
      },
    });
    const boss = world.instance.steps.find((step) => step.stepKey === "boss");
    expect(boss?.status).toBe("active");
    expect(boss?.plan.map((item) => item.assigneeId)).toEqual(["u1"]);
    expect(boss?.decisions).toEqual([]);
    expect(taskStatusOf(world, "boss-1")).toBe("pending");
    expect(
      world.instance.history.filter(
        (event) => event.kind === "auto_approve_blocked",
      ),
    ).toEqual([
      {
        at: NOW,
        kind: "auto_approve_blocked",
        stepKey: "boss",
        userId: APPLICANT,
        reason: "auto_applicant",
        code: "NOT_READY",
      },
    ]);
  });

  it("只有申請人、自動通過被擋下 → 剔除後沒人,該關阻擋(擋下的紀錄在阻擋之前)", () => {
    const definition: WorkflowDefinition = {
      steps: [review("boss", { autoApprove: { applicant: true } })],
    };
    const world = worldOf(definition);
    runAdvance(world, {
      boss: {
        kind: "assign",
        assigneeIds: [APPLICANT],
        autoApprovals: [],
        blockedAutoApprovals: [
          {
            assigneeId: APPLICANT,
            reason: "auto_applicant",
            code: "NOT_READY",
          },
        ],
      },
    });
    const boss = world.instance.steps.find((step) => step.stepKey === "boss");
    expect(boss?.plan).toEqual([]);
    expect(boss?.blocked).toBe(true);
    expect(world.instance.status).toBe("blocked");
    expect(world.instance.history.slice(-2).map((event) => event.kind)).toEqual(
      ["auto_approve_blocked", "blocked"],
    );
  });

  it("申請人經由「已在前關核准過」(auto_prior_approver)被守門擋下 → 照一般規則剔除申請人", () => {
    const definition: WorkflowDefinition = {
      steps: [review("boss", { autoApprove: { priorApprover: true } })],
    };
    const world = worldOf(definition);
    runAdvance(world, {
      boss: {
        kind: "assign",
        assigneeIds: [APPLICANT, "u1"],
        autoApprovals: [],
        blockedAutoApprovals: [
          {
            assigneeId: APPLICANT,
            reason: "auto_prior_approver",
            code: "NOT_READY",
          },
        ],
      },
    });
    const boss = world.instance.steps.find((step) => step.stepKey === "boss");
    expect(boss?.plan.map((item) => item.assigneeId)).toEqual(["u1"]);
    expect(boss?.decisions).toEqual([]);
    expect(taskStatusOf(world, "boss-1")).toBe("pending");
    expect(
      world.instance.history.find(
        (event) => event.kind === "auto_approve_blocked",
      ),
    ).toMatchObject({ userId: APPLICANT, reason: "auto_prior_approver" });
  });

  it("前關核准過的審核者(不是申請人)被擋下 → 照常留一張待審任務給他", () => {
    const definition: WorkflowDefinition = {
      steps: [review("boss", { autoApprove: { priorApprover: true } })],
    };
    const world = worldOf(definition);
    runAdvance(world, {
      boss: {
        kind: "assign",
        assigneeIds: ["u1"],
        autoApprovals: [],
        blockedAutoApprovals: [
          {
            assigneeId: "u1",
            reason: "auto_prior_approver",
            code: "NOT_READY",
          },
        ],
      },
    });
    expect(taskStatusOf(world, "boss-1")).toBe("pending");
    expect(
      world.instance.history.find(
        (event) => event.kind === "auto_approve_blocked",
      ),
    ).toMatchObject({ userId: "u1", reason: "auto_prior_approver" });
  });
});
