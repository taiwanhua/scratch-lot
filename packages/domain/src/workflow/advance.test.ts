import { describe, expect, it } from "@jest/globals";

import { type AdvanceAction, advance } from "./advance";
import type {
  InstanceSnapshot,
  TaskSnapshot,
  WorkflowDefinition,
} from "./types";
import {
  APPLICANT,
  LINEAR,
  NOW,
  PURCHASE,
  applyActions,
  clone,
  decide,
  decideIn,
  entered,
  historyKinds,
  join,
  newInstance,
  review,
  reviewingSubmission,
  runAdvance,
  taskStatusOf,
  withStep,
  worldOf,
} from "./workflow-test-support";

function run(
  definition: WorkflowDefinition,
  instance: InstanceSnapshot,
  tasks: TaskSnapshot[] = [],
  submission = reviewingSubmission(),
) {
  return advance({ definition, instance, tasks, submission, now: NOW });
}

function taskOf(
  stepKey: string,
  taskKey: string,
  assigneeId: string,
  status: TaskSnapshot["status"] = "pending",
): TaskSnapshot {
  return {
    stepKey,
    taskKey,
    assigneeId,
    status,
    previousAssigneeIds: [],
    decidedAt: null,
    comment: null,
  };
}

/** 為這些任務補上 `task_created` 事件(已寄過通知的狀態;承辦人取計畫目前那一位)。 */
function announce(
  instance: InstanceSnapshot,
  taskKeys: readonly string[],
): InstanceSnapshot {
  const next = clone(instance);
  for (const taskKey of taskKeys) {
    const stepKey = taskKey.slice(0, taskKey.lastIndexOf("-"));
    const item = next.steps
      .find((state) => state.stepKey === stepKey)
      ?.plan.find((entry) => entry.taskKey === taskKey);
    next.history.push({
      at: NOW,
      kind: "task_created",
      stepKey,
      taskKey,
      ...(item ? { userId: item.assigneeId } : {}),
    });
  }
  return next;
}

/** 模擬流程管理者改派 `boss` 關卡唯一的一項(同一個 `taskKey` 換承辦人)。 */
function reassignTo(
  instance: InstanceSnapshot,
  from: string,
  to: string,
): InstanceSnapshot {
  return withStep(instance, "boss", {
    plan: instance.steps[0]?.plan.map((item) => ({
      ...item,
      assigneeId: to,
      previousAssigneeIds: [...item.previousAssigneeIds, from],
    })),
  });
}

function kindsOf(actions: readonly AdvanceAction[]): string[] {
  return actions.map((action) => action.kind);
}

describe("advance 判斷表:每一列", () => {
  it("列 2:已核准但未收尾 → 任務投影同步、提交 → completed、記流程完成、寄結果信、最後寫 finishedAt", () => {
    let instance = entered(newInstance(LINEAR), "boss", ["u1", "u2"]);
    instance = decide(instance, "boss", "boss-1", "approved");
    instance = withStep(instance, "boss", { status: "completed" });
    instance = { ...instance, status: "approved", activeStepKeys: [] };
    const plan = run(LINEAR, instance, [
      taskOf("boss", "boss-1", "u1"),
      taskOf("boss", "boss-2", "u2"),
    ]);
    expect(plan.row).toBe("2");
    expect(kindsOf(plan.actions)).toEqual([
      "syncTask",
      "syncTask",
      "updateSubmission",
      "appendHistoryOnce",
      "notifyResult",
      "appendHistoryOnce",
      "updateInstance",
    ]);
    const [approvedSync, cancelledSync, submission, completed, notify] =
      plan.actions;
    expect(completed).toEqual({
      kind: "appendHistoryOnce",
      event: { at: NOW, kind: "completed" },
    });
    // 最後一位核准者的投影是 approved(收尾不把它取消),其他人 cancelled
    expect(approvedSync).toMatchObject({ set: { status: "approved" } });
    expect(cancelledSync).toMatchObject({ set: { status: "cancelled" } });
    expect(submission).toMatchObject({
      condition: {
        currentInstanceId: "instance-1",
        revision: 1,
        status: "reviewing",
      },
      set: { status: "completed", blocked: false },
    });
    expect(notify).toEqual({ kind: "notifyResult", result: "approved" });
    expect(plan.actions.at(-1)).toMatchObject({
      condition: { statusIn: ["approved"], finishedAtIsNull: true },
      update: { finishedAt: NOW },
    });
  });

  it("列 2:superseded 只收尾自己的任務與歷程,不碰提交、不寄信", () => {
    const instance = newInstance(LINEAR, {
      status: "superseded",
      activeStepKeys: [],
    });
    const plan = run(LINEAR, instance, [], reviewingSubmission());
    expect(plan.row).toBe("2");
    expect(kindsOf(plan.actions)).toEqual(["updateInstance"]);
  });

  it("列 2:提交已作廢(或已被新修訂取代)→ 無資格同步,不會被改回", () => {
    const instance = {
      ...newInstance(LINEAR),
      status: "approved" as const,
      activeStepKeys: [],
      finishedAt: NOW,
    };
    for (const submission of [
      reviewingSubmission({ status: "voided" }),
      reviewingSubmission({ revision: 2, currentInstanceId: "instance-2" }),
    ]) {
      expect(run(LINEAR, instance, [], submission)).toEqual({
        row: "3",
        actions: [],
      });
    }
  });

  it("列 2:撤回不寄結果信;歷程已有 notified 就不重寄", () => {
    const withdrawn = newInstance(LINEAR, {
      status: "withdrawn",
      activeStepKeys: [],
    });
    expect(kindsOf(run(LINEAR, withdrawn).actions)).toEqual([
      "updateSubmission",
      "updateInstance",
    ]);
    const notified = newInstance(LINEAR, {
      status: "rejected",
      activeStepKeys: [],
      history: [
        { at: NOW, kind: "started" },
        { at: NOW, kind: "notified", result: "rejected" },
      ],
    });
    expect(
      kindsOf(
        run(LINEAR, notified, [], reviewingSubmission({ status: "rejected" }))
          .actions,
      ),
    ).toEqual(["updateInstance"]);
  });

  it("列 3:已終局且收尾完成 → 沒事可做", () => {
    const instance = newInstance(LINEAR, {
      status: "rejected",
      activeStepKeys: [],
      finishedAt: NOW,
    });
    expect(
      run(LINEAR, instance, [], reviewingSubmission({ status: "rejected" })),
    ).toEqual({ row: "3", actions: [] });
  });

  it("列 4:any 第一筆核准 → 該關完成並啟動下一關(一次 CAS)", () => {
    let instance = entered(newInstance(LINEAR), "boss", ["u1"]);
    instance = decide(instance, "boss", "boss-1", "approved");
    const plan = run(LINEAR, instance, [taskOf("boss", "boss-1", "u1")]);
    expect(plan.row).toBe("4");
    expect(plan.actions).toEqual([
      {
        kind: "updateInstance",
        condition: {
          editVersion: instance.editVersion,
          statusIn: ["running", "blocked"],
          stepStatus: { boss: "active", hr: "pending" },
          notActive: ["hr"],
        },
        update: {
          activeStepKeys: ["hr"],
          steps: { boss: { status: "completed", blocked: false } },
          pushHistory: [{ at: NOW, kind: "step_completed", stepKey: "boss" }],
          incEditVersion: true,
        },
      },
    ]);
  });

  it("列 4:最後一關完成與全案核准在同一次更新", () => {
    let instance = withStep(newInstance(LINEAR), "boss", {
      status: "completed",
    });
    instance = entered({ ...instance, activeStepKeys: ["hr"] }, "hr", ["u9"]);
    instance = decide(instance, "hr", "hr-1", "approved");
    const [action] = run(LINEAR, instance).actions;
    expect(action).toMatchObject({
      kind: "updateInstance",
      update: { status: "approved", activeStepKeys: [] },
    });
  });

  it("列 4:駁回 → 寫 outcome(只能從 null 寫一次)、active 節點 terminated、實例 rejected", () => {
    let instance = entered(newInstance(LINEAR), "boss", ["u1"]);
    instance = decide(instance, "boss", "boss-1", "rejected", "不准");
    const plan = run(LINEAR, instance);
    expect(plan.row).toBe("4");
    expect(plan.actions[0]).toMatchObject({
      condition: { outcomeIsNull: true, statusIn: ["running", "blocked"] },
      update: {
        status: "rejected",
        activeStepKeys: [],
        steps: { boss: { status: "terminated" } },
        outcome: {
          kind: "rejected",
          stepKey: "boss",
          taskKey: "boss-1",
          historyIndex: 1,
        },
      },
    });
  });

  it("列 5:剛進 active 的審核關卡 → 先請 api 解析,帶回名單後一次寫計畫(剔除申請人)", () => {
    const instance = newInstance(LINEAR);
    expect(run(LINEAR, instance)).toEqual({
      row: "5",
      actions: [{ kind: "resolveStepEntry", stepKey: "boss" }],
    });
    const plan = advance({
      definition: LINEAR,
      instance,
      tasks: [],
      submission: reviewingSubmission(),
      now: NOW,
      stepEntries: {
        boss: { kind: "assign", assigneeIds: ["u1", APPLICANT, "u2", "u1"] },
      },
    });
    expect(plan.actions).toEqual([
      {
        kind: "updateInstance",
        condition: {
          editVersion: 1,
          statusIn: ["running", "blocked"],
          stepStatus: { boss: "pending" },
        },
        update: {
          steps: {
            boss: {
              status: "active",
              blocked: false,
              plan: [
                {
                  taskKey: "boss-1",
                  assigneeId: "u1",
                  previousAssigneeIds: [],
                  assigneeState: "active",
                },
                {
                  taskKey: "boss-2",
                  assigneeId: "u2",
                  previousAssigneeIds: [],
                  assigneeState: "active",
                },
              ],
            },
          },
          pushHistory: [{ at: NOW, kind: "step_entered", stepKey: "boss" }],
          incEditVersion: true,
        },
      },
    ]);
  });

  it("列 5:解析為空(剔除自審後)→ 該關 active + 空計畫 + blocked、實例與提交 blocked", () => {
    const plan = advance({
      definition: LINEAR,
      instance: newInstance(LINEAR),
      tasks: [],
      submission: reviewingSubmission(),
      now: NOW,
      stepEntries: { boss: { kind: "assign", assigneeIds: [APPLICANT] } },
    });
    expect(plan.actions).toEqual([
      {
        kind: "updateInstance",
        condition: expect.anything(),
        update: {
          steps: { boss: { status: "active", plan: [], blocked: true } },
          status: "blocked",
          pushHistory: [{ at: NOW, kind: "blocked", stepKey: "boss" }],
          incEditVersion: true,
        },
      },
      {
        kind: "updateSubmission",
        condition: expect.anything(),
        set: { blocked: true },
      },
    ]);
  });

  it("列 5:跳過條件成立 → skipped 並啟動後繼;最後一關跳過 → 同一次更新核准", () => {
    const skipFirst = advance({
      definition: LINEAR,
      instance: newInstance(LINEAR),
      tasks: [],
      submission: null,
      now: NOW,
      stepEntries: { boss: { kind: "skip" } },
    });
    expect(skipFirst.actions[0]).toMatchObject({
      update: {
        activeStepKeys: ["hr"],
        steps: { boss: { status: "skipped" } },
        pushHistory: [{ kind: "step_skipped", stepKey: "boss" }],
      },
    });
    const lastInstance = {
      ...withStep(newInstance(LINEAR), "boss", { status: "completed" }),
      activeStepKeys: ["hr"],
    };
    const skipLast = advance({
      definition: LINEAR,
      instance: lastInstance,
      tasks: [],
      submission: null,
      now: NOW,
      stepEntries: { hr: { kind: "skip" } },
    });
    expect(skipLast.actions[0]).toMatchObject({
      update: { status: "approved", activeStepKeys: [] },
    });
  });

  it("列 4b:前關已完成(已不在 active)、後關未啟動 → 補啟動,不重記完成事件", () => {
    const instance = withStep(
      { ...newInstance(LINEAR), activeStepKeys: [] },
      "boss",
      { status: "completed" },
    );
    const plan = run(LINEAR, instance);
    expect(plan.row).toBe("4b");
    expect(plan.actions[0]).toEqual({
      kind: "updateInstance",
      condition: {
        editVersion: 1,
        statusIn: ["running", "blocked"],
        stepStatus: { boss: "completed", hr: "pending" },
        notActive: ["hr"],
      },
      update: { activeStepKeys: ["hr"], incEditVersion: true },
    });
  });

  it("列 4b:匯合條件已成立、匯合未啟動 → 補啟動匯合", () => {
    let instance = { ...newInstance(PURCHASE), activeStepKeys: [] as string[] };
    for (const key of ["init", "finance", "legal", "purchase"]) {
      instance = withStep(instance, key, { status: "completed" });
    }
    const plan = run(PURCHASE, instance);
    expect(plan.row).toBe("4b");
    expect(plan.actions[0]).toMatchObject({
      update: { activeStepKeys: ["merge"] },
    });
  });

  it("列 4c:核准三條件已成立但實例仍 running → 改 approved(只改狀態)", () => {
    let instance = { ...newInstance(LINEAR), activeStepKeys: [] as string[] };
    instance = withStep(instance, "boss", { status: "completed" });
    instance = withStep(instance, "hr", { status: "skipped" });
    const plan = run(LINEAR, instance);
    expect(plan).toEqual({
      row: "4c",
      actions: [
        {
          kind: "updateInstance",
          condition: { editVersion: 1, statusIn: ["running", "blocked"] },
          update: { status: "approved", incEditVersion: true },
        },
      ],
    });
  });

  it("列 5b:匯合節點進 active 即完成,啟動其後續(不派人、不算跳過條件)", () => {
    let instance = { ...newInstance(PURCHASE), activeStepKeys: ["merge"] };
    for (const key of ["init", "finance", "legal", "purchase"]) {
      instance = withStep(instance, key, { status: "completed" });
    }
    const plan = run(PURCHASE, instance);
    expect(plan.row).toBe("5b");
    expect(plan.actions[0]).toMatchObject({
      update: {
        activeStepKeys: ["confirm"],
        steps: { merge: { status: "completed" } },
      },
    });
  });

  it("列 5b:匯合節點後面沒有出線 → 三部門都通過直接結案(不派任何人)", () => {
    const definition: WorkflowDefinition = {
      steps: PURCHASE.steps.filter((step) => step.key !== "confirm"),
      edges: (PURCHASE.edges ?? []).filter((edge) => edge.to !== "confirm"),
    };
    let instance = { ...newInstance(definition), activeStepKeys: ["merge"] };
    for (const key of ["init", "finance", "legal", "purchase"]) {
      instance = withStep(instance, key, { status: "completed" });
    }
    expect(run(definition, instance).actions[0]).toMatchObject({
      update: { status: "approved", activeStepKeys: [] },
    });
  });

  it("列 6:計畫有項目沒有任務 → 依計畫補建、寄信並記 task_created;已記過的只補建不重寄", () => {
    const instance = entered(newInstance(LINEAR), "boss", ["u1", "u2"]);
    const plan = run(LINEAR, instance);
    expect(plan.row).toBe("6");
    expect(kindsOf(plan.actions)).toEqual([
      "createTask",
      "notifyTaskCreated",
      "appendHistoryOnce",
      "createTask",
      "notifyTaskCreated",
      "appendHistoryOnce",
    ]);
    const announced = clone(instance);
    announced.history.push({
      at: NOW,
      kind: "task_created",
      stepKey: "boss",
      taskKey: "boss-2",
      userId: "u2",
    });
    // boss-1 任務已建但沒記 task_created(建完就中斷)→ 補寄信與事件;boss-2 已記過 → 只補建
    const replan = run(LINEAR, announced, [taskOf("boss", "boss-1", "u1")]);
    expect(kindsOf(replan.actions)).toEqual([
      "notifyTaskCreated",
      "appendHistoryOnce",
      "createTask",
    ]);
    expect(replan.actions[0]).toMatchObject({
      taskKey: "boss-1",
      assigneeId: "u1",
    });
  });

  it("列 6:已決定或已失效的承辦人不補寄;其餘都已記過 → 不再觸發", () => {
    const ALL_BOSS: WorkflowDefinition = {
      steps: [review("boss", { mode: "all" }), review("hr")],
    };
    let instance = entered(newInstance(ALL_BOSS), "boss", ["u1", "u2", "u3"]);
    instance = withStep(instance, "boss", {
      plan: instance.steps[0]?.plan.map((item) =>
        item.taskKey === "boss-3"
          ? { ...item, assigneeState: "invalid" as const }
          : item,
      ),
    });
    instance = decide(instance, "boss", "boss-2", "approved");
    instance = announce(instance, ["boss-1"]);
    const plan = run(ALL_BOSS, instance, [
      taskOf("boss", "boss-1", "u1"),
      taskOf("boss", "boss-2", "u2"),
      taskOf("boss", "boss-3", "u3"),
    ]);
    expect(plan.row).not.toBe("6");
    expect(kindsOf(plan.actions)).not.toContain("notifyTaskCreated");
  });

  it("列 6:改派(同一個 taskKey 換承辦人)→ 新承辦人沒記過 task_created 就補通知;改派回已通知過的人不重複", () => {
    const base = announce(entered(newInstance(LINEAR), "boss", ["u1"]), [
      "boss-1",
    ]);
    const toU9 = reassignTo(base, "u1", "u9");
    const plan = run(LINEAR, toU9, [taskOf("boss", "boss-1", "u1")]);
    expect(plan.row).toBe("6");
    expect(plan.actions).toEqual([
      {
        kind: "notifyTaskCreated",
        stepKey: "boss",
        taskKey: "boss-1",
        assigneeId: "u9",
      },
      {
        kind: "appendHistoryOnce",
        event: {
          at: NOW,
          kind: "task_created",
          stepKey: "boss",
          taskKey: "boss-1",
          userId: "u9",
        },
      },
    ]);
    // u9 記過之後 → 不再通知;再改派回 u1(u1 已記過)→ 也不重複
    const announced = announce(toU9, ["boss-1"]);
    const settled = run(LINEAR, announced, [taskOf("boss", "boss-1", "u9")]);
    expect(kindsOf(settled.actions)).not.toContain("notifyTaskCreated");
    const backToU1 = reassignTo(announced, "u9", "u1");
    const back = run(LINEAR, backToU1, [taskOf("boss", "boss-1", "u9")]);
    expect(kindsOf(back.actions)).not.toContain("notifyTaskCreated");
  });

  it("列 7:已完成關卡(不在 active)的任務投影不同步也會修", () => {
    let instance = entered(newInstance(LINEAR), "boss", ["u1", "u2"]);
    instance = decide(instance, "boss", "boss-1", "approved");
    instance = withStep(instance, "boss", { status: "completed" });
    instance = entered({ ...instance, activeStepKeys: ["hr"] }, "hr", ["u9"]);
    instance = announce(instance, ["boss-1", "boss-2", "hr-1"]);
    const plan = run(LINEAR, instance, [
      taskOf("boss", "boss-1", "u1"),
      taskOf("boss", "boss-2", "u2"),
      taskOf("hr", "hr-1", "u9"),
    ]);
    expect(plan.row).toBe("7");
    expect(plan.actions).toEqual([
      {
        kind: "syncTask",
        taskKey: "boss-1",
        expectedStatus: "pending",
        set: {
          status: "approved",
          assigneeId: "u1",
          previousAssigneeIds: [],
          decidedAt: NOW,
          comment: null,
        },
      },
      {
        kind: "syncTask",
        taskKey: "boss-2",
        expectedStatus: "pending",
        set: {
          status: "cancelled",
          assigneeId: "u2",
          previousAssigneeIds: [],
          decidedAt: null,
          comment: null,
        },
      },
    ]);
  });

  it("列 8:any 阻擋但仍有有效未決承辦人 → 解除;實例回 running、提交 blocked = false", () => {
    let instance = entered(newInstance(LINEAR), "boss", ["u1", "u2"]);
    instance = withStep(instance, "boss", { blocked: true });
    instance = announce({ ...instance, status: "blocked" }, [
      "boss-1",
      "boss-2",
    ]);
    const plan = run(
      LINEAR,
      instance,
      [taskOf("boss", "boss-1", "u1"), taskOf("boss", "boss-2", "u2")],
      reviewingSubmission({ blocked: true }),
    );
    expect(plan.row).toBe("8");
    expect(plan.actions).toEqual([
      {
        kind: "updateInstance",
        condition: {
          editVersion: instance.editVersion,
          statusIn: ["running", "blocked"],
          stepStatus: { boss: "active" },
        },
        update: {
          steps: { boss: { blocked: false } },
          status: "running",
          pushHistory: [{ at: NOW, kind: "unblocked", stepKey: "boss" }],
          incEditVersion: true,
        },
      },
      {
        kind: "updateSubmission",
        condition: expect.anything(),
        set: { blocked: false },
      },
    ]);
  });

  it("列 8b:實例沒阻擋、提交卻還標著阻擋 → 同步提交", () => {
    const instance = announce(entered(newInstance(LINEAR), "boss", ["u1"]), [
      "boss-1",
    ]);
    const plan = run(
      LINEAR,
      instance,
      [taskOf("boss", "boss-1", "u1")],
      reviewingSubmission({ blocked: true }),
    );
    expect(plan).toEqual({
      row: "8b",
      actions: [
        {
          kind: "updateSubmission",
          condition: expect.anything(),
          set: { blocked: false },
        },
      ],
    });
  });

  it("列 9:等人審 → 沒事可做", () => {
    const instance = announce(entered(newInstance(LINEAR), "boss", ["u1"]), [
      "boss-1",
    ]);
    expect(run(LINEAR, instance, [taskOf("boss", "boss-1", "u1")])).toEqual({
      row: "9",
      actions: [],
    });
  });
});

describe("advance:決定順序與全案終局", () => {
  const ALL: WorkflowDefinition = {
    steps: [review("audit", { mode: "all" }), review("final")],
  };

  it("any 兩筆決定:只有第一筆算數,第二筆 late", () => {
    const world = worldOf(LINEAR);
    runAdvance(world, { boss: { kind: "assign", assigneeIds: ["a", "b"] } });
    decideIn(world, "boss-1", "approved");
    decideIn(world, "boss-2", "rejected", "晚到");
    runAdvance(world);
    expect(taskStatusOf(world, "boss-1")).toBe("approved");
    expect(taskStatusOf(world, "boss-2")).toBe("late");
    expect(world.instance.activeStepKeys).toEqual(["hr"]);
  });

  it("all:全員核准才完成", () => {
    const world = worldOf(ALL);
    runAdvance(world, { audit: { kind: "assign", assigneeIds: ["a", "b"] } });
    decideIn(world, "audit-1", "approved");
    runAdvance(world);
    expect(world.instance.activeStepKeys).toEqual(["audit"]);
    decideIn(world, "audit-2", "approved");
    runAdvance(world);
    expect(world.instance.activeStepKeys).toEqual(["final"]);
  });

  it("all:A 核准後 B 駁回(兩筆都在關卡關閉前寫入)→ 終局駁回,A 的投影是 approved 不是 cancelled", () => {
    const world = worldOf(ALL);
    runAdvance(world, {
      audit: { kind: "assign", assigneeIds: ["a", "b", "c"] },
    });
    decideIn(world, "audit-1", "approved");
    decideIn(world, "audit-2", "rejected", "資料不全");
    runAdvance(world);
    expect(world.instance.status).toBe("rejected");
    expect(world.instance.outcome).toMatchObject({ taskKey: "audit-2" });
    expect(taskStatusOf(world, "audit-1")).toBe("approved");
    expect(taskStatusOf(world, "audit-2")).toBe("rejected");
    expect(taskStatusOf(world, "audit-3")).toBe("cancelled");
    expect(world.submission?.status).toBe("rejected");
    expect(world.mails).toContain("result:rejected");
  });

  it("all:空計畫(解析為空)不會被判定完成,也不會自動解除阻擋", () => {
    const world = worldOf(ALL);
    runAdvance(world, { audit: { kind: "assign", assigneeIds: [] } });
    expect(world.instance.status).toBe("blocked");
    expect(runAdvance(world)).toEqual(["9"]);
    expect(world.instance.status).toBe("blocked");
  });

  it("all:阻擋中(有失效承辦人)被接受的駁回照樣終局", () => {
    const world = worldOf(ALL);
    runAdvance(world, { audit: { kind: "assign", assigneeIds: ["a", "b"] } });
    // 審核者失效 hook:b 失效、該關與實例阻擋
    world.instance = withStep(world.instance, "audit", {
      blocked: true,
      plan: world.instance.steps[0]?.plan.map((item) =>
        item.assigneeId === "b" ? { ...item, assigneeState: "invalid" } : item,
      ),
    });
    world.instance.status = "blocked";
    runAdvance(world);
    expect(taskStatusOf(world, "audit-2")).toBe("blocked");
    decideIn(world, "audit-1", "rejected", "不行");
    runAdvance(world);
    expect(world.instance.status).toBe("rejected");
    expect(taskStatusOf(world, "audit-2")).toBe("cancelled");
  });

  it("all 兩人都失效:改派一人仍阻擋、兩人都改派才解除", () => {
    const world = worldOf(ALL);
    runAdvance(world, { audit: { kind: "assign", assigneeIds: ["a", "b"] } });
    const invalidAll = world.instance.steps[0]?.plan.map((item) => ({
      ...item,
      assigneeState: "invalid" as const,
    }));
    world.instance = withStep(world.instance, "audit", {
      blocked: true,
      plan: invalidAll,
    });
    world.instance.status = "blocked";
    const reassign = (taskKey: string, to: string): void => {
      const plan = world.instance.steps[0]?.plan.map((item) =>
        item.taskKey === taskKey
          ? {
              ...item,
              assigneeId: to,
              previousAssigneeIds: [
                ...item.previousAssigneeIds,
                item.assigneeId,
              ],
              assigneeState: "active" as const,
            }
          : item,
      );
      world.instance = withStep(world.instance, "audit", { plan });
    };
    reassign("audit-1", "x");
    runAdvance(world);
    expect(world.instance.status).toBe("blocked");
    reassign("audit-2", "y");
    runAdvance(world);
    expect(world.instance.status).toBe("running");
    expect(
      world.tasks.find((task) => task.taskKey === "audit-2"),
    ).toMatchObject({
      assigneeId: "y",
      previousAssigneeIds: ["b"],
      status: "pending",
    });
  });

  it("平行:財務駁回與法務退回交錯 → 只採接受順序最早的一筆為 outcome,另一筆 late,先前有效的核准保留;重試不變", () => {
    const world = worldOf(PURCHASE);
    runAdvance(world, {
      init: { kind: "assign", assigneeIds: ["i"] },
      finance: { kind: "assign", assigneeIds: ["f1", "f2"] },
      legal: { kind: "assign", assigneeIds: ["l1", "l2"] },
      purchase: { kind: "assign", assigneeIds: ["p1"] },
    });
    decideIn(world, "init-1", "approved");
    runAdvance(world, {
      finance: { kind: "assign", assigneeIds: ["f1", "f2"] },
      legal: { kind: "assign", assigneeIds: ["l1", "l2"] },
      purchase: { kind: "assign", assigneeIds: ["p1"] },
    });
    expect(world.instance.activeStepKeys).toEqual([
      "finance",
      "legal",
      "purchase",
    ]);
    decideIn(world, "purchase-1", "approved");
    decideIn(world, "legal-1", "returned", "補件");
    decideIn(world, "finance-1", "rejected", "超預算");
    runAdvance(world);
    expect(world.instance.status).toBe("returned");
    expect(world.instance.outcome).toMatchObject({
      kind: "returned",
      taskKey: "legal-1",
    });
    expect(taskStatusOf(world, "legal-1")).toBe("returned");
    expect(taskStatusOf(world, "finance-1")).toBe("late");
    expect(taskStatusOf(world, "finance-2")).toBe("cancelled");
    expect(taskStatusOf(world, "legal-2")).toBe("cancelled");
    expect(taskStatusOf(world, "init-1")).toBe("approved");
    const before = clone(world);
    expect(runAdvance(world)).toEqual(["3"]);
    expect(world).toEqual(before);
  });

  it("平行:any 關卡內被第一筆核准蓋掉的駁回不算候選", () => {
    const world = worldOf(PURCHASE);
    runAdvance(world);
    decideIn(world, "init-1", "approved");
    runAdvance(world, {
      finance: { kind: "assign", assigneeIds: ["f1", "f2"] },
    });
    // 兩筆都在關卡關閉前被接受:先核准、後駁回(交錯)
    decideIn(world, "finance-1", "approved");
    decideIn(world, "finance-2", "rejected", "晚到的駁回");
    runAdvance(world);
    const financeState = world.instance.steps.find(
      (step) => step.stepKey === "finance",
    );
    expect(financeState?.decisions.map((decision) => decision.taskKey)).toEqual(
      ["finance-1", "finance-2"],
    );
    expect(financeState?.status).toBe("completed");
    expect(world.instance.outcome).toBeNull();
    expect(world.instance.status).toBe("running");
    expect(taskStatusOf(world, "finance-1")).toBe("approved");
    expect(taskStatusOf(world, "finance-2")).toBe("late");
  });

  it("決定找不到對應的歷程事件 → invalidState(不猜接受順序、不寫 outcome)", () => {
    let instance = entered(newInstance(LINEAR), "boss", ["u1"]);
    instance = decide(instance, "boss", "boss-1", "rejected", "否");
    instance.history = instance.history.filter(
      (event) => event.kind !== "rejected",
    );
    const plan = run(LINEAR, instance);
    expect(plan).toEqual({
      row: "invalid",
      actions: [
        {
          kind: "invalidState",
          reason: "accepted decision has no matching history event",
          stepKey: "boss",
          taskKey: "boss-1",
        },
      ],
    });
    const world = worldOf(LINEAR, instance);
    expect(applyActions(world, plan.actions)).toEqual([false]);
    expect(world.instance).toEqual(instance);
  });

  it("執行合約:updateInstance 的 CAS 失敗就中止本輪,後面的動作(同步提交)不做", () => {
    const stale = newInstance(LINEAR);
    const plan = advance({
      definition: LINEAR,
      instance: stale,
      tasks: [],
      submission: reviewingSubmission(),
      now: NOW,
      stepEntries: { boss: { kind: "assign", assigneeIds: [] } },
    });
    expect(kindsOf(plan.actions)).toEqual([
      "updateInstance",
      "updateSubmission",
    ]);
    // 別的入口已先推進(editVersion 變了)
    const world = worldOf(LINEAR, { ...stale, editVersion: 2 });
    expect(applyActions(world, plan.actions)).toEqual([false]);
    expect(world.submission?.blocked).toBe(false);
  });
});

function purchaseWorld() {
  const world = worldOf(PURCHASE);
  runAdvance(world);
  decideIn(world, "init-1", "approved");
  runAdvance(world);
  return world;
}

describe("advance:後繼啟動與匯合", () => {
  it("分流後三個部門同時收到任務;財務 any 一人核准不會讓法務 / 採購略過", () => {
    const world = purchaseWorld();
    expect(world.tasks.map((task) => task.taskKey)).toEqual([
      "init-1",
      "finance-1",
      "legal-1",
      "purchase-1",
    ]);
    decideIn(world, "finance-1", "approved");
    runAdvance(world);
    expect(world.instance.activeStepKeys).toEqual(["legal", "purchase"]);
    expect(historyKinds(world.instance)).toContain("join_waiting:merge");
  });

  it("全部分支通過才進匯合 → 最後確認關卡(與初審不同 key,各自建任務)", () => {
    const world = purchaseWorld();
    decideIn(world, "finance-1", "approved");
    decideIn(world, "legal-1", "approved");
    runAdvance(world);
    expect(world.instance.activeStepKeys).toEqual(["purchase"]);
    decideIn(world, "purchase-1", "approved");
    runAdvance(world);
    expect(world.instance.activeStepKeys).toEqual(["confirm"]);
    expect(taskStatusOf(world, "confirm-1")).toBe("pending");
    expect(taskStatusOf(world, "init-1")).toBe("approved");
  });

  it("最後兩條分支同時完成:兩個入口依同一份快照算出的動作只有一個成功,匯合與其後續只啟動一次", () => {
    const world = purchaseWorld();
    decideIn(world, "finance-1", "approved");
    runAdvance(world);
    decideIn(world, "legal-1", "approved");
    decideIn(world, "purchase-1", "approved");
    const input = {
      definition: PURCHASE,
      instance: clone(world.instance),
      tasks: world.tasks,
      submission: world.submission,
      now: NOW,
    };
    const first = advance(input);
    const second = advance(input);
    expect(applyActions(world, first.actions)).toEqual([true]);
    // 另一個入口拿舊快照算出的同一個動作:CAS(editVersion)不成立,什麼都不做
    expect(applyActions(world, second.actions)).toEqual([false]);
    runAdvance(world);
    const mergeStarts = world.instance.history.filter(
      (event) => event.kind === "step_completed" && event.stepKey === "merge",
    );
    expect(mergeStarts).toHaveLength(1);
    expect(world.instance.activeStepKeys).toEqual(["confirm"]);
    expect(
      world.tasks.filter((task) => task.stepKey === "confirm"),
    ).toHaveLength(1);
  });

  it("整條分支被跳過仍算完成,匯合照樣成立", () => {
    const world = worldOf(PURCHASE);
    runAdvance(world, { purchase: { kind: "skip" } });
    decideIn(world, "init-1", "approved");
    runAdvance(world, { purchase: { kind: "skip" } });
    decideIn(world, "finance-1", "approved");
    decideIn(world, "legal-1", "approved");
    runAdvance(world);
    expect(world.instance.activeStepKeys).toEqual(["confirm"]);
    expect(historyKinds(world.instance)).toContain("step_skipped:purchase");
  });

  it("一條分支阻擋時其他分支照審,匯合等它", () => {
    const world = worldOf(PURCHASE);
    runAdvance(world);
    decideIn(world, "init-1", "approved");
    runAdvance(world, { purchase: { kind: "assign", assigneeIds: [] } });
    expect(world.instance.status).toBe("blocked");
    expect(world.submission?.blocked).toBe(true);
    decideIn(world, "finance-1", "approved");
    decideIn(world, "legal-1", "approved");
    runAdvance(world);
    expect(world.instance.activeStepKeys).toEqual(["purchase"]);
    expect(world.instance.status).toBe("blocked");
  });

  it("全部關卡都跳過 → 直接完成,歷程有每一關的 step_skipped", () => {
    const world = worldOf(LINEAR);
    runAdvance(world, { boss: { kind: "skip" }, hr: { kind: "skip" } });
    expect(world.instance.status).toBe("approved");
    expect(world.submission?.status).toBe("completed");
    expect(historyKinds(world.instance)).toEqual(
      expect.arrayContaining(["step_skipped:boss", "step_skipped:hr"]),
    );
    expect(world.instance.finishedAt).toEqual(NOW);
  });

  it("join 節點不會被列 5 當審核關卡派人", () => {
    const definition: WorkflowDefinition = {
      steps: [review("a"), review("b"), review("c"), join("j")],
      edges: [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
        { from: "b", to: "j" },
        { from: "c", to: "j" },
      ],
    };
    const world = worldOf(definition);
    runAdvance(world);
    decideIn(world, "a-1", "approved");
    runAdvance(world);
    decideIn(world, "b-1", "approved");
    decideIn(world, "c-1", "approved");
    runAdvance(world);
    expect(world.tasks.some((task) => task.stepKey === "j")).toBe(false);
    expect(world.instance.status).toBe("approved");
  });

  it("4c 恢復之後照樣走列 2 寄核准信;重試推進不重寄", () => {
    let instance = { ...newInstance(LINEAR), activeStepKeys: [] as string[] };
    instance = withStep(instance, "boss", { status: "completed" });
    instance = withStep(instance, "hr", { status: "completed" });
    const world = worldOf(LINEAR, instance);
    expect(runAdvance(world)).toEqual(["4c", "2", "3"]);
    expect(world.mails).toEqual(["result:approved"]);
    runAdvance(world);
    expect(world.mails).toEqual(["result:approved"]);
  });
});
