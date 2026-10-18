import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Types } from "mongoose";

import type { RealtimePublishRequest } from "@repo/domain/realtime";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { TransactionService } from "../../database/transaction";
import { call, ok } from "../../forms/test-support/form-fixtures";
import { RealtimeTransport } from "../../realtime/realtime-transport";
import { interruptAt } from "../test-support/hooks-fixture";
import {
  DECIDE,
  type Person,
  REASSIGN,
  WITHDRAW,
  WORKFLOW_TEST_TIMEOUT_MS,
  type World,
  currentInstance,
  decideOn,
  pendingTaskOf,
  setupWorld,
  submitLeave,
  useWorkflow,
  usersStep,
} from "../test-support/workflow-fixtures";
import { WorkflowEngineService } from "./workflow-engine.service";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

/**
 * 流程任務的側欄計數信號:任務建立 / 結束 / 改派時,交易提交後對相關審核者送
 * `badge:apply-center`,一次 `/publish` 帶多個 `user:` 頻道;交易回復不送。`badge:*` 不合併,每次都送。
 * 即時通道在測試裡是停用的(記錄用 adapter),這裡攔它的 `send`。
 */
describe("流程任務 → badge:apply-center", () => {
  let api: AuthTestApp;
  let world: World;
  let a: Person;
  let b: Person;
  let c: Person;
  const sent: RealtimePublishRequest[] = [];
  const topicOf = (who: Person) => `user:${String(who.userId)}`;

  /** 從第 `from` 筆起的 badge:apply-center 送出(每次送出的頻道)。 */
  const badgesSince = (from: number): string[][] =>
    sent
      .slice(from)
      .filter((request) => request.signal.type === "badge:apply-center")
      .map((request) => request.topics);

  beforeAll(async () => {
    api = await startAuthTestApp("workflow_realtime_badge", {
      WORKFLOW_MAIL_ENABLED: "false",
    });
    world = await setupWorld(api, api.connection, 3);
    [a, b, c] = world.staff as [Person, Person, Person];
    await useWorkflow(world, "badge_flow", {
      steps: [usersStep("one", [a, b])],
    });
    const transport = api.app.get(RealtimeTransport, { strict: false });
    jest.spyOn(transport, "send").mockImplementation((request) => {
      sent.push(request);
      return Promise.resolve();
    });
  });

  afterAll(async () => {
    await api.close();
  });

  it("流程任務建立給 A、B → 一次送出到 user:A、user:B", async () => {
    const from = sent.length;
    await submitLeave(world);
    const badges = badgesSince(from);
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveLength(2);
    expect(badges[0]).toEqual(expect.arrayContaining([topicOf(a), topicOf(b)]));
  });

  it("任務結束(A 核准,B 的任務因關卡結束取消)→ 對 A、B 送", async () => {
    const submitted = await submitLeave(world);
    const from = sent.length;
    await decideOn(world, a, submitted.id, "APPROVE");
    expect(badgesSince(from).flat()).toEqual(
      expect.arrayContaining([topicOf(a), topicOf(b)]),
    );
  });

  it("任務改派 A → C → 對 A、C 送", async () => {
    const submitted = await submitLeave(world);
    const task = await pendingTaskOf(world, a, submitted.id);
    const from = sent.length;
    await ok(api, world.admin.token, REASSIGN, {
      input: { taskId: task.id, toUserId: String(c.userId) },
    });
    expect(badgesSince(from).flat()).toEqual(
      expect.arrayContaining([topicOf(a), topicOf(c)]),
    );
  });

  it("申請人撤回(任務取消)→ 對審核者送", async () => {
    const submitted = await submitLeave(world);
    const from = sent.length;
    await ok(api, world.applicant.token, WITHDRAW, {
      input: { id: submitted.id, expectedEditVersion: submitted.editVersion },
    });
    expect(badgesSince(from).flat()).toEqual(
      expect.arrayContaining([topicOf(a), topicOf(b)]),
    );
  });

  it("交易回復(決定後的推進中途失敗)→ 不送信號", async () => {
    const submitted = await submitLeave(world);
    const task = await pendingTaskOf(world, a, submitted.id);
    const from = sent.length;
    const restore = interruptAt(api, "action:updateInstance");
    try {
      const result = await call(api, a.token, DECIDE, {
        input: {
          taskId: task.id,
          expectedEditVersion: task.editVersion,
          decision: "APPROVE",
        },
      });
      expect(result.errors).toBeDefined();
    } finally {
      restore();
    }
    expect(badgesSince(from)).toEqual([]);
  });

  it("沒有外層交易時直接呼叫 advance(重試推進、排程等)→ advance 自己的交易提交後送出", async () => {
    const submitted = await submitLeave(world);
    const instance = await currentInstance(world, submitted.id);
    const engine = api.app.get(WorkflowEngineService, { strict: false });
    const from = sent.length;
    await engine.advance(new Types.ObjectId(instance.id));
    expect(badgesSince(from).flat()).toEqual(
      expect.arrayContaining([topicOf(a), topicOf(b)]),
    );
  });

  it("在外層交易內呼叫 advance、外層之後回復 → 不送(登記在外層交易上,跟著回復)", async () => {
    const submitted = await submitLeave(world);
    const instance = await currentInstance(world, submitted.id);
    const engine = api.app.get(WorkflowEngineService, { strict: false });
    const transactions = api.app.get(TransactionService, { strict: false });
    const from = sent.length;
    await expect(
      transactions.withTransaction(async () => {
        await engine.advance(new Types.ObjectId(instance.id));
        throw new Error("外層後面一步失敗");
      }),
    ).rejects.toThrow("外層後面一步失敗");
    expect(badgesSince(from)).toEqual([]);
  });
});
