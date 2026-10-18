import { describe, expect, it } from "@jest/globals";

import { buildPlan } from "./plan";
import type { WorkflowDefinition } from "./types";
import {
  APPLICANT,
  review,
  runAdvance,
  worldOf,
} from "./workflow-test-support";

describe("代理人:派任計畫記原審核者與代理人", () => {
  it("buildPlan:delegatorOf 有記的那一項帶 delegatorIds,其他項沒有", () => {
    expect(
      buildPlan("boss", ["delegate", "u2"], APPLICANT, {
        delegatorOf: { delegate: ["original"] },
      }),
    ).toEqual([
      {
        taskKey: "boss-1",
        assigneeId: "delegate",
        previousAssigneeIds: [],
        assigneeState: "active",
        delegatorIds: ["original"],
      },
      {
        taskKey: "boss-2",
        assigneeId: "u2",
        previousAssigneeIds: [],
        assigneeState: "active",
      },
    ]);
  });

  it("進關帶 delegatorOf → 任務派給代理人,task_created 事件帶原審核者(時間軸「由 X 代理 Y」)", () => {
    const definition: WorkflowDefinition = { steps: [review("boss")] };
    const world = worldOf(definition);
    runAdvance(world, {
      boss: {
        kind: "assign",
        assigneeIds: ["delegate"],
        delegatorOf: { delegate: ["original"] },
      },
    });
    const boss = world.instance.steps.find((step) => step.stepKey === "boss");
    expect(boss?.plan).toEqual([
      expect.objectContaining({
        assigneeId: "delegate",
        delegatorIds: ["original"],
      }),
    ]);
    expect(world.tasks.map((task) => task.assigneeId)).toEqual(["delegate"]);
    expect(
      world.instance.history.find((event) => event.kind === "task_created"),
    ).toMatchObject({
      taskKey: "boss-1",
      userId: "delegate",
      delegatorIds: ["original"],
    });
    expect(world.mails).toEqual(["task:boss-1:delegate"]);
  });

  it("會簽兩位委託同一位代理人 → 合成一項、一張任務,記兩位被代理者", () => {
    const definition: WorkflowDefinition = {
      steps: [review("boss", { mode: "all" })],
    };
    const world = worldOf(definition);
    runAdvance(world, {
      boss: {
        kind: "assign",
        assigneeIds: ["delegate", "delegate"],
        delegatorOf: { delegate: ["a", "b"] },
      },
    });
    const boss = world.instance.steps.find((step) => step.stepKey === "boss");
    expect(boss?.plan).toEqual([
      expect.objectContaining({
        taskKey: "boss-1",
        assigneeId: "delegate",
        delegatorIds: ["a", "b"],
      }),
    ]);
    expect(world.tasks).toHaveLength(1);
  });

  it("代理人自動通過(已在前關核准過)→ approved 事件也帶被代理者", () => {
    const definition: WorkflowDefinition = {
      steps: [review("boss", { autoApprove: { priorApprover: true } })],
    };
    const world = worldOf(definition);
    runAdvance(world, {
      boss: {
        kind: "assign",
        assigneeIds: ["delegate"],
        delegatorOf: { delegate: ["a"] },
        autoApprovals: [
          { assigneeId: "delegate", reason: "auto_prior_approver" },
        ],
      },
    });
    expect(
      world.instance.history.find((event) => event.kind === "approved"),
    ).toMatchObject({ userId: "delegate", delegatorIds: ["a"] });
  });

  it("沒有代理 → 計畫項目與 task_created 都不帶 delegatorIds", () => {
    const definition: WorkflowDefinition = { steps: [review("boss")] };
    const world = worldOf(definition);
    runAdvance(world, { boss: { kind: "assign", assigneeIds: ["u1"] } });
    const boss = world.instance.steps.find((step) => step.stepKey === "boss");
    expect(boss?.plan[0]?.delegatorIds).toBeUndefined();
    expect(
      world.instance.history.find((event) => event.kind === "task_created")
        ?.delegatorIds,
    ).toBeUndefined();
  });
});
