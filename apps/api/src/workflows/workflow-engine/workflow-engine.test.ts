import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { call, createDraft, ok } from "../../forms/test-support/form-fixtures";
import { MailService } from "../../mail/mail.service";
import { RecordingMailService } from "../../mail/recording-mail.service";
import { interleaveAt, interruptAt } from "../test-support/hooks-fixture";
import {
  DECIDE,
  FORM_KEY,
  REASSIGN,
  SAVE_SUBMISSION,
  SUBMIT_SUBMISSION,
  UNBIND,
  VOID,
  WITHDRAW,
  WORKFLOW_TEST_TIMEOUT_MS,
  type WfSubmissionRow,
  type World,
  activeStepsOf,
  byText,
  currentInstance,
  decide,
  decideOn,
  errorCode,
  errorReason,
  pendingTaskOf,
  person,
  rawInstances,
  rawSubmissionDoc,
  rawTasks,
  retryAdvance,
  reviewStep,
  setupWorld,
  stepOfRow,
  submission,
  submissionStatus,
  submitExisting,
  submitLeave,
  taskStatusOf,
  taskStatuses,
  tasksOf,
  useWorkflow,
  usersStep,
} from "../test-support/workflow-fixtures";
import { WorkflowEngineHooks } from "./workflow-engine.service";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

async function draftOf(
  world: World,
  title = "中斷測試",
): Promise<WfSubmissionRow> {
  const row = await createDraft(world.api, world.applicant.token, FORM_KEY, {
    title,
    days: 3,
  });
  return row as unknown as WfSubmissionRow;
}

async function trySubmit(world: World, row: WfSubmissionRow): Promise<unknown> {
  return call(world.api, world.applicant.token, SUBMIT_SUBMISSION, {
    input: { id: row.id, expectedEditVersion: row.editVersion },
  });
}

/**
 * 審核流程引擎(真 Mongo,Spec 6b §10「api 真 Mongo」):送出與決定各是一個交易(中斷 → 全部回復)、直線流程、
 * 會簽模式與決定的交錯、跳過條件、再送出、通知信(開啟)。
 */
describe("審核流程引擎", () => {
  let api: AuthTestApp;
  let world: World;
  let sequence = 0;

  /** 每個情境自己的流程 key(綁定是整張表單一筆,情境之間用換綁的)。 */
  function nextKey(prefix: string): string {
    sequence += 1;
    return `${prefix}_${String(sequence)}`;
  }

  function mail(): RecordingMailService {
    const service = api.app.get(MailService);
    if (!(service instanceof RecordingMailService)) {
      throw new TypeError("測試應使用記錄用寄信 adapter");
    }
    return service;
  }

  function staff(index: number): World["staff"][number] {
    const found = world.staff[index];
    if (!found) {
      throw new Error(`staff[${String(index)}] 不存在`);
    }
    return found;
  }

  async function bossThenHr(): Promise<void> {
    await useWorkflow(world, nextKey("boss_hr"), {
      steps: [
        reviewStep("boss", { kind: "manager", level: 1 }),
        reviewStep(
          "hr",
          { kind: "role", roleId: String(world.hrRoleId), placeholder: null },
          { skipWhen: { "<=": [{ var: "days" }, 1] } },
        ),
      ],
    });
  }

  beforeAll(async () => {
    api = await startAuthTestApp("workflow_engine", {
      WORKFLOW_MAIL_ENABLED: "true",
    });
    world = await setupWorld(api, api.connection);
  });

  afterAll(async () => {
    await api.close();
  });

  describe("直線流程", () => {
    beforeAll(async () => {
      await bossThenHr();
    });

    it("送出直接進 reviewing(不經 completed),主管收到任務、摘要讀實例快照", async () => {
      const submitted = await submitLeave(world);
      expect(submitted.status).toBe("REVIEWING");
      expect(submitted.revision).toBe(1);
      const instance = await currentInstance(world, submitted.id);
      expect(instance.status).toBe("RUNNING");
      expect(instance.activeStepKeys).toEqual(["boss"]);
      expect(instance.history.map((event) => event.kind)).toContain("started");
      const task = await pendingTaskOf(world, world.manager, submitted.id);
      expect(task.summary?.title).toBe("病假三天");
      const raw = await rawSubmissionDoc(world.connection, submitted.id);
      expect(raw?.status).toBe("reviewing");
      expect(await rawInstances(world.connection, submitted.id)).toHaveLength(
        1,
      );
    });

    it("主管核准 → 人資(any)一人核准 → approved / completed,其餘任務 cancelled、最後一位核准者投影 approved", async () => {
      const submitted = await submitLeave(world);
      await decideOn(world, world.manager, submitted.id, "APPROVE");
      const [hr1, hr2] = world.hr;
      await pendingTaskOf(world, hr2, submitted.id);
      await decideOn(world, hr1, submitted.id, "APPROVE");
      const instance = await currentInstance(world, submitted.id);
      expect(instance.status).toBe("APPROVED");
      expect(instance.finishedAt).not.toBeNull();
      expect(await taskStatuses(world.connection, instance.id)).toEqual({
        "boss-1": "approved",
        "hr-1": "approved",
        "hr-2": "cancelled",
      });
      const after = await submission(world, world.applicant, submitted.id);
      expect(after.status).toBe("COMPLETED");
      expect(after.abilities).toMatchObject({ canEdit: false, canVoid: true });
    });

    it("跳過條件成立 → 最後一關跳過,主管核准即 approved、提交 completed", async () => {
      const submitted = await submitLeave(world, { title: "半天", days: 1 });
      await decideOn(world, world.manager, submitted.id, "APPROVE");
      const instance = await currentInstance(world, submitted.id);
      expect(instance.status).toBe("APPROVED");
      expect(stepOfRow(instance, "hr").status).toBe("SKIPPED");
      const hrTasks = await tasksOf(world, world.hr[0]);
      expect(hrTasks.some((one) => one.submissionId === submitted.id)).toBe(
        false,
      );
      const after = await submission(world, world.applicant, submitted.id);
      expect(after.status).toBe("COMPLETED");
    });

    it("全部關卡都跳過 → 直接完成,歷程有每一關的 step_skipped", async () => {
      await useWorkflow(world, nextKey("all_skip"), {
        steps: [
          usersStep("first", [staff(0)], {
            skipWhen: { "<=": [{ var: "days" }, 5] },
          }),
          usersStep("second", [staff(1)], {
            skipWhen: { "<=": [{ var: "days" }, 5] },
          }),
        ],
      });
      const submitted = await submitLeave(world, { title: "全跳", days: 2 });
      expect(submitted.status).toBe("COMPLETED");
      const instance = await currentInstance(world, submitted.id);
      expect(instance.status).toBe("APPROVED");
      const skipped = instance.history
        .filter((event) => event.kind === "step_skipped")
        .map((event) => event.stepKey);
      expect(skipped).toEqual(["first", "second"]);
      await bossThenHr();
    });

    it("駁回 → rejected;不可再改;結果信與任務信都有寄", async () => {
      const before = mail().sent.length;
      const submitted = await submitLeave(world);
      const { result } = await decideOn(
        world,
        world.manager,
        submitted.id,
        "REJECT",
      );
      expect(result).toBe("ACCEPTED");
      const after = await submission(world, world.applicant, submitted.id);
      expect(after.status).toBe("REJECTED");
      expect(after.abilities.canEdit).toBe(false);
      const kinds = mail()
        .sent.slice(before)
        .map((message) => message.notificationType);
      expect(kinds).toContain("workflow.task-created");
      expect(kinds).toContain("workflow.result");
    });

    it("退回修改 → returned;改完再送出修訂 +1、新實例從頭、舊實例 superseded 並收尾", async () => {
      const submitted = await submitLeave(world);
      const before = mail().sent.length;
      await decideOn(world, world.manager, submitted.id, "RETURN");
      const returned = await submission(world, world.applicant, submitted.id);
      expect(returned.status).toBe("RETURNED");
      const subjects = mail()
        .sent.slice(before)
        .map((message) => message.subject);
      expect(subjects.some((subject) => subject.includes("已退回修改"))).toBe(
        true,
      );
      expect(returned.abilities.canEdit).toBe(true);
      const saved = await ok<{
        saveFormDraft: { submission: WfSubmissionRow };
      }>(api, world.applicant.token, SAVE_SUBMISSION, {
        input: {
          id: submitted.id,
          expectedEditVersion: returned.editVersion,
          values: { title: "改成四天", days: 4 },
        },
      });
      const resubmitted = await submitExisting(
        world,
        saved.saveFormDraft.submission,
      );
      expect(resubmitted.status).toBe("REVIEWING");
      expect(resubmitted.revision).toBe(2);
      const instances = await rawInstances(world.connection, submitted.id);
      expect(instances.map((one) => one.status)).toEqual([
        "superseded",
        "running",
      ]);
      expect(instances[0]?.finishedAt).not.toBeNull();
      const task = await pendingTaskOf(world, world.manager, submitted.id);
      expect(task.revision).toBe(2);
      expect(task.summary?.title).toBe("改成四天");
    });

    it("沒有綁定 → 6a 行為(送出即 completed、不建實例)", async () => {
      await ok(api, world.admin.token, UNBIND, {
        input: { formKey: FORM_KEY },
      });
      const submitted = await submitLeave(world);
      expect(submitted.status).toBe("COMPLETED");
      expect(submitted.currentInstanceId).toBeNull();
      expect(await rawInstances(world.connection, submitted.id)).toHaveLength(
        0,
      );
      await bossThenHr();
    });
  });

  describe("會簽模式與決定的交錯", () => {
    it("all:全部核准才進下一關", async () => {
      await useWorkflow(world, nextKey("all_pass"), {
        steps: [
          usersStep("pair", [staff(0), staff(1)], { mode: "all" }),
          usersStep("last", [staff(2)]),
        ],
      });
      const submitted = await submitLeave(world);
      await decideOn(world, staff(0), submitted.id, "APPROVE");
      expect(await activeStepsOf(world, submitted.id)).toEqual(["pair"]);
      await decideOn(world, staff(1), submitted.id, "APPROVE");
      expect(await activeStepsOf(world, submitted.id)).toEqual(["last"]);
    });

    it("all:A 寫入決定前 B 的駁回已提交 → A 的交易寫入衝突、重跑後得 stepClosed;結果駁回", async () => {
      await useWorkflow(world, nextKey("all_interleave"), {
        steps: [usersStep("pair", [staff(0), staff(1)], { mode: "all" })],
      });
      const submitted = await submitLeave(world);
      const taskB = await pendingTaskOf(world, staff(1), submitted.id);
      const restore = interleaveAt(api, "decide:before-write", async () => {
        await decide(world, staff(1), taskB, "REJECT", "不同意");
      });
      let result: Awaited<ReturnType<typeof decideOn>>;
      try {
        result = await decideOn(world, staff(0), submitted.id, "APPROVE");
      } finally {
        restore();
      }
      expect(result.result).toBe("STEP_CLOSED");
      const instance = await currentInstance(world, submitted.id);
      expect(instance.status).toBe("REJECTED");
      expect(stepOfRow(instance, "pair").decisions).toHaveLength(1);
      expect(await taskStatuses(world.connection, instance.id)).toEqual({
        "pair-1": "cancelled",
        "pair-2": "rejected",
      });
      expect(await submissionStatus(world, submitted.id)).toBe("REJECTED");
    });

    it("any:兩人同時核准同一關(B 在 A 寫入前提交)→ B 成功、A 重跑後得 stepClosed,全案只核准一次", async () => {
      await useWorkflow(world, nextKey("any_both"), {
        steps: [usersStep("either", [staff(0), staff(1)])],
      });
      const submitted = await submitLeave(world);
      const taskB = await pendingTaskOf(world, staff(1), submitted.id);
      let other: Awaited<ReturnType<typeof decide>> | undefined;
      const restore = interleaveAt(api, "decide:before-write", async () => {
        other = await decide(world, staff(1), taskB, "APPROVE");
      });
      let mine: Awaited<ReturnType<typeof decideOn>>;
      try {
        mine = await decideOn(world, staff(0), submitted.id, "APPROVE");
      } finally {
        restore();
      }
      expect(other?.result).toBe("ACCEPTED");
      expect(mine.result).toBe("STEP_CLOSED");
      const instance = await currentInstance(world, submitted.id);
      expect(instance.status).toBe("APPROVED");
      expect(stepOfRow(instance, "either").decisions).toHaveLength(1);
      expect(await taskStatuses(world.connection, instance.id)).toEqual({
        "either-1": "cancelled",
        "either-2": "approved",
      });
      expect(
        instance.history.filter((event) => event.kind === "notified"),
      ).toHaveLength(1);
    });

    it("any:A 先寫且推進已前進關卡後 B 才到 → B 得 stepClosed、任務不變", async () => {
      await useWorkflow(world, nextKey("any_closed"), {
        steps: [usersStep("either", [staff(0), staff(1)])],
      });
      const submitted = await submitLeave(world);
      const taskB = await pendingTaskOf(world, staff(1), submitted.id);
      await decideOn(world, staff(0), submitted.id, "APPROVE");
      const late = await decide(world, staff(1), taskB, "APPROVE");
      expect(late.result).toBe("STEP_CLOSED");
      expect(late.task.status).toBe("CANCELLED");
    });

    it("舊實例 / 已決定的任務 / 已被改派走的承辦人 → stepClosed 且任務不變", async () => {
      await useWorkflow(world, nextKey("closed_cases"), {
        steps: [usersStep("one", [staff(0), staff(1)], { mode: "all" })],
      });
      const submitted = await submitLeave(world);
      const taskA = await pendingTaskOf(world, staff(0), submitted.id);
      const decided = await decide(world, staff(0), taskA, "APPROVE");
      // 已決定的 taskKey:同一個人再送一次(新的 editVersion)
      const again = await decide(world, staff(0), decided.task, "APPROVE");
      expect(again.result).toBe("STEP_CLOSED");
      // 被改派走:staff(1) 的任務改給 staff(2),原承辦人再送
      const taskB = await pendingTaskOf(world, staff(1), submitted.id);
      await ok(api, world.admin.token, REASSIGN, {
        input: { taskId: taskB.id, toUserId: String(staff(2).userId) },
      });
      const moved = await decide(world, staff(1), taskB, "APPROVE");
      expect(moved.result).toBe("STEP_CLOSED");
      // 舊實例:退回後再送出,舊修訂的任務
      await decideOn(world, staff(2), submitted.id, "RETURN");
      const returned = await submission(world, world.applicant, submitted.id);
      await submitExisting(world, returned);
      const old = await decide(
        world,
        staff(0),
        { id: taskA.id, editVersion: decided.task.editVersion },
        "APPROVE",
      );
      expect(old.result).toBe("STEP_CLOSED");
    });

    it("撤回與決定交錯(撤回讀到無決定後決定才寫入)→ 撤回失敗「已有審核意見」", async () => {
      await useWorkflow(world, nextKey("withdraw_race"), {
        steps: [usersStep("one", [staff(0), staff(1)], { mode: "all" })],
      });
      const submitted = await submitLeave(world);
      const task = await pendingTaskOf(world, staff(0), submitted.id);
      const restore = interleaveAt(api, "withdraw:before-write", async () => {
        await decide(world, staff(0), task, "APPROVE");
      });
      let result: Awaited<ReturnType<typeof call>>;
      try {
        result = await call(api, world.applicant.token, WITHDRAW, {
          input: {
            id: submitted.id,
            expectedEditVersion: submitted.editVersion,
          },
        });
      } finally {
        restore();
      }
      expect(errorCode(result)).toBe("CONFLICT");
      expect(errorReason(result)).toBe("HAS_DECISIONS");
      expect(await submissionStatus(world, submitted.id)).toBe("REVIEWING");
    });

    it("看得到這張單、但不是申請人 → FORBIDDEN(NOT_APPLICANT),單子照舊審核中", async () => {
      await useWorkflow(world, nextKey("withdraw_not_applicant"), {
        steps: [usersStep("one", [staff(0)])],
      });
      const submitted = await submitLeave(world);
      // 同在廚房部的同事:可見範圍含這張單、有同一組模組權限,但不是申請人
      const colleague = await person(
        api,
        world.connection,
        world.kitchen,
        world.tenant,
      );
      const result = await call(api, colleague.token, WITHDRAW, {
        input: { id: submitted.id, expectedEditVersion: submitted.editVersion },
      });
      expect(errorCode(result)).toBe("FORBIDDEN");
      expect(errorReason(result)).toBe("NOT_APPLICANT");
      expect(await submissionStatus(world, submitted.id)).toBe("REVIEWING");
    });

    it("別人的草稿:撤回回 NOT_FOUND,不透露草稿存在", async () => {
      const draft = await createDraft(api, world.applicant.token, FORM_KEY, {
        title: "還沒送出的草稿",
        days: 1,
      });
      const colleague = await person(
        api,
        world.connection,
        world.kitchen,
        world.tenant,
      );
      const result = await call(api, colleague.token, WITHDRAW, {
        input: { id: draft.id, expectedEditVersion: draft.editVersion },
      });
      expect(errorCode(result)).toBe("NOT_FOUND");
    });

    it("沒有決定前撤回 → withdrawn;可改後再送出(修訂 +1)", async () => {
      await useWorkflow(world, nextKey("withdraw_ok"), {
        steps: [usersStep("one", [staff(0)])],
      });
      const submitted = await submitLeave(world);
      const withdrawn = await ok<{
        withdrawSubmission: { submission: WfSubmissionRow };
      }>(api, world.applicant.token, WITHDRAW, {
        input: { id: submitted.id, expectedEditVersion: submitted.editVersion },
      });
      expect(withdrawn.withdrawSubmission.submission.status).toBe("WITHDRAWN");
      const instance = await currentInstance(world, submitted.id);
      expect(instance.status).toBe("WITHDRAWN");
      expect(await taskStatuses(world.connection, instance.id)).toEqual({
        "one-1": "cancelled",
      });
      const again = await submitExisting(
        world,
        withdrawn.withdrawSubmission.submission,
      );
      expect(again.revision).toBe(2);
      expect(again.status).toBe("REVIEWING");
    });

    it("改派與決定交錯(改派讀到無決定後決定才寫入)→ 改派失敗「此任務已決定」", async () => {
      await useWorkflow(world, nextKey("reassign_race"), {
        steps: [usersStep("one", [staff(0), staff(1)], { mode: "all" })],
      });
      const submitted = await submitLeave(world);
      const task = await pendingTaskOf(world, staff(0), submitted.id);
      const restore = interleaveAt(api, "reassign:before-write", async () => {
        await decide(world, staff(0), task, "APPROVE");
      });
      let result: Awaited<ReturnType<typeof call>>;
      try {
        result = await call(api, world.admin.token, REASSIGN, {
          input: { taskId: task.id, toUserId: String(staff(3).userId) },
        });
      } finally {
        restore();
      }
      expect(errorCode(result)).toBe("CONFLICT");
      expect(errorReason(result)).toBe("ALREADY_DECIDED");
    });
  });

  describe("送出是一個交易:中斷 → 全部回復", () => {
    beforeAll(async () => {
      await useWorkflow(world, nextKey("submit_steps"), {
        steps: [usersStep("one", [staff(4)])],
      });
    });

    for (const [label, checkpoint, nth] of [
      ["第 2 步(建實例)", "submit:instance-created", 1],
      ["第 3 步(提交連上實例)", "submit:submission-linked", 1],
      ["推進建第一筆任務前", "action:createTask", 1],
    ] as const) {
      it(`${label}之後中斷 → 提交維持草稿、實例與任務都不存在;重送 = 一次成功`, async () => {
        const row = await draftOf(world);
        const before = await rawSubmissionDoc(world.connection, row.id);
        const restore = interruptAt(api, checkpoint, nth);
        try {
          const failed = (await trySubmit(world, row)) as {
            errors?: unknown[];
          };
          expect(failed.errors).toBeDefined();
        } finally {
          restore();
        }
        expect(await rawInstances(world.connection, row.id)).toEqual([]);
        expect(
          await world.connection
            .collection("workflow_tasks")
            .countDocuments({ submissionId: new Types.ObjectId(row.id) }),
        ).toBe(0);
        const after = await rawSubmissionDoc(world.connection, row.id);
        expect(after?.status).toBe("draft");
        expect(after?.revision).toBe(before?.revision);
        expect(after?.editVersion).toBe(before?.editVersion);
        expect(after?.currentInstanceId ?? null).toBeNull();
        const retried = await submitExisting(world, row);
        expect(retried.status).toBe("REVIEWING");
        expect(retried.revision).toBe(1);
        const instances = await rawInstances(world.connection, row.id);
        expect(instances).toHaveLength(1);
        expect(instances[0]?.status).toBe("running");
        await pendingTaskOf(world, staff(4), row.id);
      });
    }

    it("同一草稿兩次並發送出(另一次在本次建實例前提交)→ 一次成功,另一次 CONFLICT(EDIT_VERSION_MISMATCH),只有一個實例與修訂", async () => {
      const row = await draftOf(world);
      let other: unknown;
      const restore = interleaveAt(api, "submit:before-write", async () => {
        other = await trySubmit(world, row);
      });
      let mine: Awaited<ReturnType<typeof call>>;
      try {
        mine = (await trySubmit(world, row)) as Awaited<
          ReturnType<typeof call>
        >;
      } finally {
        restore();
      }
      expect((other as { errors?: unknown[] }).errors).toBeUndefined();
      expect(errorCode(mine)).toBe("CONFLICT");
      expect(errorReason(mine)).toBe("EDIT_VERSION_MISMATCH");
      const instances = await rawInstances(world.connection, row.id);
      expect(instances).toHaveLength(1);
      const after = await rawSubmissionDoc(world.connection, row.id);
      expect(after?.revision).toBe(1);
      expect(after?.status).toBe("reviewing");
      expect(
        await world.connection.collection("audit_logs").countDocuments({
          action: "submission.submit",
          targetId: new Types.ObjectId(row.id),
        }),
      ).toBe(1);
      await pendingTaskOf(world, staff(4), row.id);
    });

    it("重複送出(提交已是審核中)→ 對原實例再推進一次:不增加修訂、不另建實例,稽核標記 resumed", async () => {
      const row = await draftOf(world);
      await submitExisting(world, row);
      const again = await submitExisting(world, row);
      expect(again.status).toBe("REVIEWING");
      expect(again.revision).toBe(1);
      expect(await rawInstances(world.connection, row.id)).toHaveLength(1);
      const resumed = await world.connection
        .collection("audit_logs")
        .countDocuments({
          action: "submission.submit",
          targetId: new Types.ObjectId(row.id),
          "after.resumed": true,
        });
      expect(resumed).toBe(1);
      await pendingTaskOf(world, staff(4), row.id);
    });
  });

  describe("決定是一個交易:中斷 → 全部回復", () => {
    it("決定寫入後、推進前中斷 → 決定不存在、任務仍待審;再決定一次照常終局", async () => {
      await useWorkflow(world, nextKey("rollback_decide"), {
        steps: [usersStep("one", [staff(0)])],
      });
      const submitted = await submitLeave(world);
      const task = await pendingTaskOf(world, staff(0), submitted.id);
      const restore = interruptAt(api, "decide:accepted");
      try {
        const result = await call(api, staff(0).token, DECIDE, {
          input: {
            taskId: task.id,
            expectedEditVersion: task.editVersion,
            decision: "REJECT",
            comment: "中斷",
          },
        });
        expect(result.errors).toBeDefined();
      } finally {
        restore();
      }
      const instance = await currentInstance(world, submitted.id);
      expect(instance.status).toBe("RUNNING");
      expect(stepOfRow(instance, "one").decisions).toHaveLength(0);
      expect(await taskStatuses(world.connection, instance.id)).toEqual({
        "one-1": "pending",
      });
      expect(
        await world.connection.collection("audit_logs").countDocuments({
          action: "task.decide",
          targetId: new Types.ObjectId(task.id),
        }),
      ).toBe(0);
      const again = await decide(world, staff(0), task, "REJECT", "再一次");
      expect(again.result).toBe("ACCEPTED");
      expect(await submissionStatus(world, submitted.id)).toBe("REJECTED");
    });

    it("推進同步提交之後中斷 → 已寫的提交狀態也一起回復", async () => {
      await useWorkflow(world, nextKey("rollback_after_submission"), {
        steps: [usersStep("one", [staff(0)])],
      });
      const submitted = await submitLeave(world);
      const task = await pendingTaskOf(world, staff(0), submitted.id);
      const hooks = api.app.get(WorkflowEngineHooks);
      let isSubmissionSynced = false;
      let failedAt: string | null = null;
      const spy = jest
        .spyOn(hooks, "reached")
        .mockImplementation((reached: string) => {
          if (reached === "action:updateSubmission") {
            isSubmissionSynced = true;
          } else if (isSubmissionSynced && failedAt === null) {
            failedAt = reached;
            return Promise.reject(new Error(`模擬中斷:${reached}`));
          }
          return Promise.resolve();
        });
      try {
        const result = await call(api, staff(0).token, DECIDE, {
          input: {
            taskId: task.id,
            expectedEditVersion: task.editVersion,
            decision: "APPROVE",
          },
        });
        expect(result.errors).toBeDefined();
      } finally {
        spy.mockRestore();
      }
      expect(failedAt).not.toBeNull();
      const raw = await rawSubmissionDoc(world.connection, submitted.id);
      expect(raw?.status).toBe("reviewing");
      const instance = await currentInstance(world, submitted.id);
      expect(instance.status).toBe("RUNNING");
      expect(stepOfRow(instance, "one").decisions).toHaveLength(0);
      expect(await taskStatuses(world.connection, instance.id)).toEqual({
        "one-1": "pending",
      });
    });

    it("推進同步提交前中斷 → 實例、任務、提交都維持決定前", async () => {
      await useWorkflow(world, nextKey("rollback_submission"), {
        steps: [usersStep("one", [staff(0)])],
      });
      const submitted = await submitLeave(world);
      const task = await pendingTaskOf(world, staff(0), submitted.id);
      const restore = interruptAt(api, "action:updateSubmission");
      try {
        await call(api, staff(0).token, DECIDE, {
          input: {
            taskId: task.id,
            expectedEditVersion: task.editVersion,
            decision: "APPROVE",
          },
        });
      } finally {
        restore();
      }
      const raw = await rawSubmissionDoc(world.connection, submitted.id);
      expect(raw?.status).toBe("reviewing");
      const instance = await currentInstance(world, submitted.id);
      expect(instance.status).toBe("RUNNING");
      expect(stepOfRow(instance, "one").decisions).toHaveLength(0);
      expect(await taskStatuses(world.connection, instance.id)).toEqual({
        "one-1": "pending",
      });
    });

    it("任務投影被弄亂(人工造出)→ 重試推進補回;角色名單變了也依原計畫補建(不重新解析)", async () => {
      await useWorkflow(world, nextKey("recover_tasks"), {
        steps: [
          reviewStep("hr", {
            kind: "role",
            roleId: String(world.hrRoleId),
            placeholder: null,
          }),
        ],
      });
      const row = await createDraft(api, world.applicant.token, FORM_KEY, {
        title: "一半",
        days: 3,
      });
      await submitExisting(world, row);
      const [instanceDoc] = await rawInstances(world.connection, row.id);
      const instanceId = String(instanceDoc?._id);
      // 人工刪掉第二筆任務(舊資料或 bug 才會有的落盤狀態)
      await world.connection.collection("workflow_tasks").deleteOne({
        instanceId: new Types.ObjectId(instanceId),
        taskKey: "hr-2",
      });
      expect(await rawTasks(world.connection, instanceId)).toHaveLength(1);
      // 人資 2 被移出角色、新人加入:計畫固定,補建的仍是原本的人資 2
      await world.connection.collection("core_relationships").deleteOne({
        type: "user_role",
        firstId: world.hr[1].userId,
        secondId: world.hrRoleId,
      });
      await world.connection.collection("core_relationships").insertOne({
        type: "user_role",
        firstId: staff(6).userId,
        secondId: world.hrRoleId,
        thirdId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });
      await retryAdvance(world, instanceId);
      const tasks = await rawTasks(world.connection, instanceId);
      expect(
        tasks.map((task) => String(task.assigneeId)).toSorted(byText),
      ).toEqual(
        [String(world.hr[0].userId), String(world.hr[1].userId)].toSorted(
          byText,
        ),
      );
      // 角色移除後既有任務仍可審
      const result = await decideOn(world, world.hr[1], row.id, "APPROVE");
      expect(result.result).toBe("ACCEPTED");
    });

    it("已完成關卡的任務投影不同步 → 列 7 照樣修(不限 active)", async () => {
      await useWorkflow(world, nextKey("fix_projection"), {
        steps: [usersStep("one", [staff(0)]), usersStep("two", [staff(1)])],
      });
      const submitted = await submitLeave(world);
      await decideOn(world, staff(0), submitted.id, "APPROVE");
      const instance = await currentInstance(world, submitted.id);
      await world.connection
        .collection("workflow_tasks")
        .updateOne(
          { instanceId: new Types.ObjectId(instance.id), taskKey: "one-1" },
          { $set: { status: "pending" } },
        );
      await retryAdvance(world, instance.id);
      expect(await taskStatusOf(world, instance.id, "one-1")).toBe("approved");
    });
  });

  describe("再送出、取代與作廢的重試", () => {
    it("舊實例 superseded 的重試不改提交,且不反覆收尾", async () => {
      await useWorkflow(world, nextKey("superseded_retry"), {
        steps: [usersStep("one", [staff(0)])],
      });
      const submitted = await submitLeave(world);
      await decideOn(world, staff(0), submitted.id, "RETURN");
      const returned = await submission(world, world.applicant, submitted.id);
      await submitExisting(world, returned);
      const [old] = await rawInstances(world.connection, submitted.id);
      const before = await rawSubmissionDoc(world.connection, submitted.id);
      const first = await retryAdvance(world, String(old?._id));
      expect(first.status).toBe("SUPERSEDED");
      const second = await retryAdvance(world, String(old?._id));
      expect(second.editVersion).toBe(first.editVersion);
      const after = await rawSubmissionDoc(world.connection, submitted.id);
      expect(after?.revision).toBe(2);
      expect(String(after?.currentInstanceId)).toBe(
        String(before?.currentInstanceId),
      );
      expect(after?.status).toBe("reviewing");
    });

    it("已作廢的提交:重試舊 approved 實例不會被改回 completed,且不反覆", async () => {
      await useWorkflow(world, nextKey("voided_retry"), {
        steps: [usersStep("one", [staff(0)])],
      });
      const submitted = await submitLeave(world);
      await decideOn(world, staff(0), submitted.id, "APPROVE");
      const approved = await submission(world, world.applicant, submitted.id);
      await ok(api, world.applicant.token, VOID, {
        input: {
          id: submitted.id,
          expectedEditVersion: approved.editVersion,
          reason: "日期填錯",
        },
      });
      const instance = await currentInstance(world, submitted.id);
      const first = await retryAdvance(world, instance.id);
      const second = await retryAdvance(world, instance.id);
      expect(second.editVersion).toBe(first.editVersion);
      expect(await submissionStatus(world, submitted.id)).toBe("VOIDED");
    });

    it("再送出時綁定被解除 → 擋(審核流程已移除);換另一個有效流程 → 依新流程重跑", async () => {
      await useWorkflow(world, nextKey("rebind_a"), {
        steps: [usersStep("one", [staff(0)])],
      });
      const submitted = await submitLeave(world);
      await decideOn(world, staff(0), submitted.id, "RETURN");
      const returned = await submission(world, world.applicant, submitted.id);
      await ok(api, world.admin.token, UNBIND, {
        input: { formKey: FORM_KEY },
      });
      const blocked = await call(
        api,
        world.applicant.token,
        SUBMIT_SUBMISSION,
        {
          input: {
            id: submitted.id,
            expectedEditVersion: returned.editVersion,
          },
        },
      );
      expect(errorCode(blocked)).toBe("FORBIDDEN");
      expect(errorReason(blocked)).toBe("WORKFLOW_REMOVED");
      const otherKey = nextKey("rebind_b");
      await useWorkflow(world, otherKey, {
        steps: [usersStep("other", [staff(1)])],
      });
      const again = await submitExisting(world, returned);
      expect(again.revision).toBe(2);
      const [, second] = await rawInstances(world.connection, submitted.id);
      expect(second?.workflowKey).toBe(otherKey);
      await pendingTaskOf(world, staff(1), submitted.id);
    });
  });

  it("最後節點完成與全案核准在同一個交易:交易外任何時刻都看不到「終點已完成但實例仍 running」", async () => {
    await useWorkflow(world, nextKey("atomic_approve"), {
      steps: [usersStep("one", [staff(0)]), usersStep("last", [staff(1)])],
    });
    const submitted = await submitLeave(world);
    await decideOn(world, staff(0), submitted.id, "APPROVE");
    const instance = await currentInstance(world, submitted.id);
    const observed: { status: string; last: string }[] = [];
    const hooks = api.app.get(WorkflowEngineHooks);
    const spy = jest.spyOn(hooks, "reached").mockImplementation(async () => {
      const raw = await world.connection
        .collection("workflow_instances")
        .findOne({ _id: new Types.ObjectId(instance.id) });
      const steps = (raw?.steps ?? []) as { stepKey: string; status: string }[];
      observed.push({
        status: String(raw?.status),
        last: steps.find((step) => step.stepKey === "last")?.status ?? "",
      });
    });
    try {
      await decideOn(world, staff(1), submitted.id, "APPROVE");
    } finally {
      spy.mockRestore();
    }
    expect(observed.length).toBeGreaterThan(0);
    // 交易進行中,交易外只看得到決定前的已提交狀態;提交後一次看到全案核准
    expect(
      observed.filter(
        (one) => !(one.status === "running" && one.last === "active"),
      ),
    ).toEqual([]);
    const after = await world.connection
      .collection("workflow_instances")
      .findOne({ _id: new Types.ObjectId(instance.id) });
    expect(after?.status).toBe("approved");
    expect(
      (after?.steps as { stepKey: string; status: string }[]).find(
        (step) => step.stepKey === "last",
      )?.status,
    ).toBe("completed");
  });

  describe("通知信(WORKFLOW_MAIL_ENABLED = true)", () => {
    it("正常核准寄一次核准信;重試推進不重寄", async () => {
      await useWorkflow(world, nextKey("mail_approve"), {
        steps: [usersStep("one", [staff(0)])],
      });
      const submitted = await submitLeave(world);
      const before = mail().sent.length;
      await decideOn(world, staff(0), submitted.id, "APPROVE");
      const instance = await currentInstance(world, submitted.id);
      await retryAdvance(world, instance.id);
      const results = mail()
        .sent.slice(before)
        .filter((message) => message.notificationType === "workflow.result");
      expect(results).toHaveLength(1);
      expect(results[0]?.subject).toContain("已核准");
      expect(
        instance.history.filter(
          (event) => event.kind === "notified" && event.result === "approved",
        ),
      ).toHaveLength(1);
    });

    it("通知信排在交易提交後:登記寄信之後交易回復 → 不寄;重新決定提交後才寄一次", async () => {
      await useWorkflow(world, nextKey("mail_rollback"), {
        steps: [usersStep("one", [staff(0)])],
      });
      const submitted = await submitLeave(world);
      const task = await pendingTaskOf(world, staff(0), submitted.id);
      const before = mail().sent.length;
      const hooks = api.app.get(WorkflowEngineHooks);
      let isNotifyQueued = false;
      const spy = jest
        .spyOn(hooks, "reached")
        .mockImplementation((reached: string) => {
          if (reached === "action:notifyResult") {
            isNotifyQueued = true;
          } else if (isNotifyQueued && reached === "action:appendHistoryOnce") {
            return Promise.reject(new Error("模擬中斷:寄信已登記之後"));
          }
          return Promise.resolve();
        });
      try {
        const failed = await call(api, staff(0).token, DECIDE, {
          input: {
            taskId: task.id,
            expectedEditVersion: task.editVersion,
            decision: "APPROVE",
          },
        });
        expect(failed.errors).toBeDefined();
      } finally {
        spy.mockRestore();
      }
      expect(isNotifyQueued).toBe(true);
      const resultMails = () =>
        mail()
          .sent.slice(before)
          .filter((message) => message.notificationType === "workflow.result");
      expect(resultMails()).toEqual([]);
      await decide(world, staff(0), task, "APPROVE");
      expect(resultMails()).toHaveLength(1);
    });

    it("4c 恢復(終點已完成但實例仍 running)也會寄核准信,且重試不重寄", async () => {
      await useWorkflow(world, nextKey("mail_4c"), {
        steps: [usersStep("one", [staff(0)])],
      });
      const submitted = await submitLeave(world);
      const instance = await currentInstance(world, submitted.id);
      // 人工造出「終點已完成、實例仍 running」(舊資料或 bug 才會有的落盤狀態)
      await world.connection.collection("workflow_instances").updateOne(
        { _id: new Types.ObjectId(instance.id) },
        {
          $set: {
            activeStepKeys: [],
            "steps.0.status": "completed",
          },
        },
      );
      const before = mail().sent.length;
      const recovered = await retryAdvance(world, instance.id);
      expect(recovered.status).toBe("APPROVED");
      await retryAdvance(world, instance.id);
      const results = mail()
        .sent.slice(before)
        .filter((message) => message.notificationType === "workflow.result");
      expect(results).toHaveLength(1);
      expect(await submissionStatus(world, submitted.id)).toBe("COMPLETED");
    });
  });
});
