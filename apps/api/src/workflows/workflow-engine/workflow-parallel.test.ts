import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { setUserEnabled } from "../../auth/test-support/fixtures";
import { ok } from "../../forms/test-support/form-fixtures";
import { interleaveAt, interruptAt } from "../test-support/hooks-fixture";
import {
  ADD_ASSIGNEE,
  ASSIGN_WORKFLOW,
  CREATE_WORKFLOW,
  DECIDE,
  type DefinitionShape,
  FORK_WORKFLOW,
  PUBLISH_WORKFLOW,
  type Person,
  WORKFLOW_TEST_TIMEOUT_MS,
  WORKFLOW_VERSION,
  type WorkflowVersionRow,
  type World,
  bindForm,
  byText,
  currentInstance,
  decide,
  decideOn,
  joinStep,
  pendingTaskOf,
  publishWorkflowDraft,
  rawTasks,
  retryAdvance,
  reviewStep,
  saveWorkflowDraft,
  setupWorld,
  stepOfRow,
  submissionStatus,
  submitLeave,
  taskStatuses,
  useWorkflow,
  usersStep,
} from "../test-support/workflow-fixtures";
import { WorkflowEngineService } from "./workflow-engine.service";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

/**
 * 平行分支(真 Mongo,Spec 6b §5「流程結構」、§6 判斷表的後繼啟動 / 匯合 / 全案終局):
 * 採購單 = 原部門初審 → 分流(財務 any / 法務 all / 採購)→ 匯合 → 原部門確認。
 */
describe("審核流程引擎:平行分支", () => {
  let api: AuthTestApp;
  let world: World;
  let sequence = 0;

  function nextKey(prefix: string): string {
    sequence += 1;
    return `${prefix}_${String(sequence)}`;
  }

  function staff(index: number): Person {
    const found = world.staff[index];
    if (!found) {
      throw new Error(`staff[${String(index)}] 不存在`);
    }
    return found;
  }

  /** 採購單流程;`withConfirm = false` = 匯合後直接結束。 */
  function purchase(
    options: {
      withConfirm?: boolean;
      purchaseStep?: ReturnType<typeof usersStep>;
    } = {},
  ): DefinitionShape {
    const withConfirm = options.withConfirm ?? true;
    return {
      steps: [
        usersStep("init", [staff(0)]),
        usersStep("finance", [staff(1), staff(2), staff(3)]),
        usersStep("legal", [staff(4), staff(5)], { mode: "all" }),
        options.purchaseStep ?? usersStep("purchase", [staff(6)]),
        joinStep("merge"),
        ...(withConfirm ? [usersStep("confirm", [staff(0)])] : []),
      ],
      edges: [
        { from: "init", to: "finance" },
        { from: "init", to: "legal" },
        { from: "init", to: "purchase" },
        { from: "finance", to: "merge" },
        { from: "legal", to: "merge" },
        { from: "purchase", to: "merge" },
        ...(withConfirm ? [{ from: "merge", to: "confirm" }] : []),
      ],
    };
  }

  beforeAll(async () => {
    api = await startAuthTestApp("workflow_parallel", {
      WORKFLOW_MAIL_ENABLED: "false",
    });
    world = await setupWorld(api, api.connection, 9);
  });

  afterAll(async () => {
    await api.close();
  });

  it("分流後三個部門同時收到任務;部門內 any / all 與跨分支匯合互不混用;全部通過才進匯合後的確認關", async () => {
    await useWorkflow(world, nextKey("purchase"), purchase());
    const submitted = await submitLeave(world);
    await decideOn(world, staff(0), submitted.id, "APPROVE");
    let instance = await currentInstance(world, submitted.id);
    expect(instance.activeStepKeys.toSorted(byText)).toEqual(
      ["finance", "legal", "purchase"].toSorted(byText),
    );
    for (const index of [1, 2, 3, 4, 5, 6]) {
      await pendingTaskOf(world, staff(index), submitted.id);
    }
    // 財務一人核准 = 財務通過;法務 / 採購還在,匯合不啟動
    await decideOn(world, staff(1), submitted.id, "APPROVE");
    instance = await currentInstance(world, submitted.id);
    expect(stepOfRow(instance, "finance").status).toBe("COMPLETED");
    expect(instance.activeStepKeys.toSorted(byText)).toEqual(
      ["legal", "purchase"].toSorted(byText),
    );
    expect(stepOfRow(instance, "merge").status).toBe("PENDING");
    // 法務 all:一人核准不夠
    await decideOn(world, staff(4), submitted.id, "APPROVE");
    await decideOn(world, staff(6), submitted.id, "APPROVE");
    instance = await currentInstance(world, submitted.id);
    expect(instance.activeStepKeys).toEqual(["legal"]);
    await decideOn(world, staff(5), submitted.id, "APPROVE");
    instance = await currentInstance(world, submitted.id);
    expect(instance.activeStepKeys).toEqual(["confirm"]);
    expect(stepOfRow(instance, "merge").status).toBe("COMPLETED");
    // 匯合節點不派人;初審與確認不同 key、各自建任務
    expect(stepOfRow(instance, "merge").plan).toEqual([]);
    const confirm = await pendingTaskOf(world, staff(0), submitted.id);
    expect(confirm.taskKey).toBe("confirm-1");
    await decide(world, staff(0), confirm, "APPROVE");
    instance = await currentInstance(world, submitted.id);
    expect(instance.status).toBe("APPROVED");
    const statuses = await taskStatuses(world.connection, instance.id);
    expect(statuses).toMatchObject({
      "init-1": "approved",
      "finance-1": "approved",
      "finance-2": "cancelled",
      "finance-3": "cancelled",
      "legal-1": "approved",
      "legal-2": "approved",
      "purchase-1": "approved",
      "confirm-1": "approved",
    });
  });

  it("一條分支阻擋(找不到審核者)時其他分支照審,匯合等它;新增審核者後繼續", async () => {
    const ghost = staff(8);
    await setUserEnabled(world.connection, ghost.userId, false);
    await useWorkflow(
      world,
      nextKey("purchase_blocked"),
      purchase({ purchaseStep: usersStep("purchase", [ghost]) }),
    );
    const submitted = await submitLeave(world);
    await decideOn(world, staff(0), submitted.id, "APPROVE");
    let instance = await currentInstance(world, submitted.id);
    expect(instance.status).toBe("BLOCKED");
    expect(stepOfRow(instance, "purchase").blocked).toBe(true);
    expect(await submissionStatus(world, submitted.id)).toBe("REVIEWING");
    await decideOn(world, staff(1), submitted.id, "APPROVE");
    await decideOn(world, staff(4), submitted.id, "APPROVE");
    await decideOn(world, staff(5), submitted.id, "APPROVE");
    instance = await currentInstance(world, submitted.id);
    expect(instance.activeStepKeys).toEqual(["purchase"]);
    expect(stepOfRow(instance, "merge").status).toBe("PENDING");
    const added = await ok<{ addStepAssignee: { task: { taskKey: string } } }>(
      api,
      world.admin.token,
      ADD_ASSIGNEE,
      {
        input: {
          instanceId: instance.id,
          stepKey: "purchase",
          userId: String(staff(6).userId),
        },
      },
    );
    expect(added.addStepAssignee.task.taskKey).toBe("purchase-1");
    instance = await currentInstance(world, submitted.id);
    expect(instance.status).toBe("RUNNING");
    await decideOn(world, staff(6), submitted.id, "APPROVE");
    instance = await currentInstance(world, submitted.id);
    expect(instance.activeStepKeys).toEqual(["confirm"]);
    await setUserEnabled(world.connection, ghost.userId, true);
  });

  it("任一分支駁回 → 全案終局、其他待辦取消、先前已接受的決定保留", async () => {
    await useWorkflow(world, nextKey("purchase_reject"), purchase());
    const submitted = await submitLeave(world);
    await decideOn(world, staff(0), submitted.id, "APPROVE");
    await decideOn(world, staff(1), submitted.id, "APPROVE");
    await decideOn(world, staff(4), submitted.id, "REJECT");
    const instance = await currentInstance(world, submitted.id);
    expect(instance.status).toBe("REJECTED");
    expect(instance.outcome).toMatchObject({
      kind: "rejected",
      stepKey: "legal",
    });
    expect(await taskStatuses(world.connection, instance.id)).toMatchObject({
      "finance-1": "approved",
      "legal-1": "rejected",
      "legal-2": "cancelled",
      "purchase-1": "cancelled",
    });
    expect(await submissionStatus(world, submitted.id)).toBe("REJECTED");
  });

  it("財務駁回與法務退回並發(法務先提交)→ 先提交的那筆為 outcome、財務重跑後得 stepClosed;重試推進後不變", async () => {
    await useWorkflow(world, nextKey("purchase_race"), purchase());
    const submitted = await submitLeave(world);
    await decideOn(world, staff(0), submitted.id, "APPROVE");
    const legalTask = await pendingTaskOf(world, staff(4), submitted.id);
    const restore = interleaveAt(api, "decide:before-write", async () => {
      await decide(world, staff(4), legalTask, "RETURN", "法務退回");
    });
    let finance: Awaited<ReturnType<typeof decideOn>>;
    try {
      finance = await decideOn(world, staff(1), submitted.id, "REJECT");
    } finally {
      restore();
    }
    expect(finance.result).toBe("STEP_CLOSED");
    const instance = await currentInstance(world, submitted.id);
    expect(instance.status).toBe("RETURNED");
    expect(instance.outcome).toMatchObject({
      kind: "returned",
      stepKey: "legal",
      taskKey: "legal-1",
    });
    const before = await taskStatuses(world.connection, instance.id);
    expect(before).toMatchObject({
      "finance-1": "cancelled",
      "legal-1": "returned",
    });
    const retried = await retryAdvance(world, instance.id);
    expect(retried.status).toBe("RETURNED");
    expect(retried.outcome).toEqual(instance.outcome);
    expect(await taskStatuses(world.connection, instance.id)).toEqual(before);
    expect(
      retried.history.filter((event) => event.kind !== "advance_retried"),
    ).toEqual(instance.history);
  });

  it("最後兩條分支同時完成 → 匯合與其後關卡只啟動一次", async () => {
    await useWorkflow(world, nextKey("purchase_concurrent"), purchase());
    const submitted = await submitLeave(world);
    await decideOn(world, staff(0), submitted.id, "APPROVE");
    await decideOn(world, staff(1), submitted.id, "APPROVE");
    await decideOn(world, staff(4), submitted.id, "APPROVE");
    const legalLast = await pendingTaskOf(world, staff(5), submitted.id);
    const restore = interleaveAt(api, "decide:before-write", async () => {
      await decide(world, staff(5), legalLast, "APPROVE");
    });
    try {
      await decideOn(world, staff(6), submitted.id, "APPROVE");
    } finally {
      restore();
    }
    const instance = await currentInstance(world, submitted.id);
    expect(instance.activeStepKeys).toEqual(["confirm"]);
    const entered = instance.history.filter(
      (event) => event.kind === "step_entered" && event.stepKey === "confirm",
    );
    expect(entered).toHaveLength(1);
    const allTasks = await rawTasks(world.connection, instance.id);
    const confirmTasks = allTasks.filter((task) => task.stepKey === "confirm");
    expect(confirmTasks).toHaveLength(1);
  });

  it("兩個推進讀到同一份快照(第一個寫入前插進另一個推進並提交)→ 前者寫入衝突、重跑,各分支只啟動一次", async () => {
    await useWorkflow(world, nextKey("purchase_two_advances"), purchase());
    const submitted = await submitLeave(world);
    const before = await currentInstance(world, submitted.id);
    // init 已完成、但三條分支都沒啟動(人工造出,讓推進的第一個寫入就是 updateInstance)
    await world.connection
      .collection("workflow_instances")
      .updateOne(
        { _id: new Types.ObjectId(before.id) },
        { $set: { activeStepKeys: [], "steps.0.status": "completed" } },
      );
    const engine = api.app.get(WorkflowEngineService);
    const instanceId = new Types.ObjectId(before.id);
    let isInterleaved = false;
    const restore = interleaveAt(api, "action:updateInstance", async () => {
      isInterleaved = true;
      await engine.advance(instanceId);
    });
    try {
      await engine.advance(instanceId);
    } finally {
      restore();
    }
    expect(isInterleaved).toBe(true);
    const instance = await currentInstance(world, submitted.id);
    expect(instance.activeStepKeys.toSorted(byText)).toEqual(
      ["finance", "legal", "purchase"].toSorted(byText),
    );
    for (const stepKey of ["finance", "legal", "purchase"]) {
      expect(
        instance.history.filter(
          (event) => event.kind === "step_entered" && event.stepKey === stepKey,
        ),
      ).toHaveLength(1);
    }
    const tasks = await rawTasks(world.connection, instance.id);
    expect(tasks.filter((task) => task.stepKey === "purchase")).toHaveLength(1);
  });

  it("匯合後建確認關任務時中斷 → 整個決定回復;再決定一次,匯合與其後關卡只啟動一次", async () => {
    await useWorkflow(world, nextKey("purchase_interrupt"), purchase());
    const submitted = await submitLeave(world);
    await decideOn(world, staff(0), submitted.id, "APPROVE");
    await decideOn(world, staff(1), submitted.id, "APPROVE");
    await decideOn(world, staff(4), submitted.id, "APPROVE");
    await decideOn(world, staff(5), submitted.id, "APPROVE");
    const before = await currentInstance(world, submitted.id);
    // 最後一條分支核准後,推進建確認關任務時中斷
    const task = await pendingTaskOf(world, staff(6), submitted.id);
    const restore = interruptAt(api, "action:createTask");
    try {
      await api.graphql(
        DECIDE,
        {
          input: {
            taskId: task.id,
            expectedEditVersion: task.editVersion,
            decision: "APPROVE",
          },
        },
        { accessToken: staff(6).token },
      );
    } finally {
      restore();
    }
    const rolledBack = await currentInstance(world, submitted.id);
    expect(rolledBack.activeStepKeys).toEqual(before.activeStepKeys);
    expect(rolledBack.editVersion).toBe(before.editVersion);
    await decide(world, staff(6), task, "APPROVE");
    const instance = await currentInstance(world, submitted.id);
    expect(instance.activeStepKeys).toEqual(["confirm"]);
    expect(
      instance.history.filter(
        (event) => event.kind === "step_entered" && event.stepKey === "confirm",
      ),
    ).toHaveLength(1);
    const tasks = await rawTasks(world.connection, instance.id);
    expect(tasks.filter((task) => task.stepKey === "confirm")).toHaveLength(1);
  });

  it("前關已完成、後繼未啟動(人工造出)→ 重試推進由列 4b 恢復,前關已不在 active 也能恢復", async () => {
    await useWorkflow(world, nextKey("purchase_4b"), purchase());
    const submitted = await submitLeave(world);
    const instance = await currentInstance(world, submitted.id);
    // init 已完成、但三條分支都沒啟動
    await world.connection
      .collection("workflow_instances")
      .updateOne(
        { _id: new Types.ObjectId(instance.id) },
        { $set: { activeStepKeys: [], "steps.0.status": "completed" } },
      );
    const recovered = await retryAdvance(world, instance.id);
    expect(recovered.activeStepKeys.toSorted(byText)).toEqual(
      ["finance", "legal", "purchase"].toSorted(byText),
    );
    await pendingTaskOf(world, staff(6), submitted.id);
  });

  it("匯合後沒有出線 → 三部門都通過直接結案(不派任何人)", async () => {
    await useWorkflow(
      world,
      nextKey("purchase_no_confirm"),
      purchase({ withConfirm: false }),
    );
    const submitted = await submitLeave(world);
    await decideOn(world, staff(0), submitted.id, "APPROVE");
    await decideOn(world, staff(2), submitted.id, "APPROVE");
    await decideOn(world, staff(4), submitted.id, "APPROVE");
    await decideOn(world, staff(5), submitted.id, "APPROVE");
    await decideOn(world, staff(6), submitted.id, "APPROVE");
    const instance = await currentInstance(world, submitted.id);
    expect(instance.status).toBe("APPROVED");
    expect(stepOfRow(instance, "merge").status).toBe("COMPLETED");
    expect(await submissionStatus(world, submitted.id)).toBe("COMPLETED");
  });

  it("整條分支被跳過仍能匯合", async () => {
    await useWorkflow(
      world,
      nextKey("purchase_skip_branch"),
      purchase({
        purchaseStep: usersStep("purchase", [staff(6)], {
          skipWhen: { "<=": [{ var: "days" }, 5] },
        }),
      }),
    );
    const submitted = await submitLeave(world);
    await decideOn(world, staff(0), submitted.id, "APPROVE");
    let instance = await currentInstance(world, submitted.id);
    expect(stepOfRow(instance, "purchase").status).toBe("SKIPPED");
    await decideOn(world, staff(3), submitted.id, "APPROVE");
    await decideOn(world, staff(4), submitted.id, "APPROVE");
    await decideOn(world, staff(5), submitted.id, "APPROVE");
    instance = await currentInstance(world, submitted.id);
    expect(instance.activeStepKeys).toEqual(["confirm"]);
  });

  it("有 edges 的版本從唯一無入線節點開始(節點陣列順序打亂也一樣)", async () => {
    const shape = purchase();
    await useWorkflow(world, nextKey("purchase_shuffled"), {
      steps: shape.steps.toReversed(),
      edges: shape.edges ?? null,
    });
    const submitted = await submitLeave(world);
    const instance = await currentInstance(world, submitted.id);
    expect(instance.activeStepKeys).toEqual(["init"]);
  });

  it("設計平行流程 → 存草稿 → 重新開啟 → fork → 發布 → 執行,節點 kind 與 edges 全程不遺失", async () => {
    const sharedKey = nextKey("shared_purchase");
    const manager = { kind: "manager", level: 1 };
    const shape: DefinitionShape = {
      steps: [
        reviewStep("init", manager),
        reviewStep("finance", manager),
        reviewStep("legal", manager),
        joinStep("merge"),
      ],
      edges: [
        { from: "init", to: "finance" },
        { from: "init", to: "legal" },
        { from: "finance", to: "merge" },
        { from: "legal", to: "merge" },
      ],
    };
    // root 設計共用流程:存草稿 → 重新開啟(讀草稿)
    await ok(api, world.root, CREATE_WORKFLOW, {
      input: { key: sharedKey, name: "共用採購流程" },
    });
    const published = await publishWorkflowDraft(
      world,
      sharedKey,
      shape,
      null,
      world.root,
    );
    expect(published.edges).toEqual(shape.edges);
    await ok(api, world.root, ASSIGN_WORKFLOW, {
      input: { workflowKey: sharedKey, tenantOrgIds: [String(world.tenant)] },
    });
    // 租戶 fork → 草稿保留結構 → 存(原樣)→ 發布
    const forkKey = nextKey("tenant_purchase");
    await ok(api, world.admin.token, FORK_WORKFLOW, {
      input: {
        sourceKey: sharedKey,
        sourceVersion: 1,
        key: forkKey,
        name: "採購(本租戶)",
      },
    });
    const draft = await ok<{
      workflowVersion: { workflowVersion: WorkflowVersionRow };
    }>(api, world.admin.token, WORKFLOW_VERSION, { workflowKey: forkKey });
    const draftRow = draft.workflowVersion.workflowVersion;
    expect(draftRow.edges).toEqual(shape.edges);
    expect(draftRow.steps.find((step) => step.key === "merge")?.kind).toBe(
      "join",
    );
    const saved = await saveWorkflowDraft(
      world,
      forkKey,
      {
        steps: draftRow.steps as unknown as DefinitionShape["steps"],
        edges: draftRow.edges,
      },
      draftRow.draftRevision,
    );
    const forkPublished = await ok<{
      publishWorkflowVersion: { workflowVersion: WorkflowVersionRow };
    }>(api, world.admin.token, PUBLISH_WORKFLOW, {
      input: {
        workflowKey: forkKey,
        expectedDraftRevision: saved.draftRevision,
        changelog: "fork 發布",
      },
    });
    expect(forkPublished.publishWorkflowVersion.workflowVersion.edges).toEqual(
      shape.edges,
    );
    await bindForm(world, forkKey);
    const submitted = await submitLeave(world);
    await decideOn(world, world.manager, submitted.id, "APPROVE");
    const instance = await currentInstance(world, submitted.id);
    expect(instance.activeStepKeys.toSorted(byText)).toEqual(
      ["finance", "legal"].toSorted(byText),
    );
    expect(stepOfRow(instance, "merge").kind).toBe("join");
  });
});
