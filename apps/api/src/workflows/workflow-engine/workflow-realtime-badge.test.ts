import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

import type { RealtimePublishRequest } from "@repo/domain/realtime";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { RealtimeTransport } from "../../realtime/realtime-transport";
import {
  type Person,
  WORKFLOW_TEST_TIMEOUT_MS,
  type World,
  decideOn,
  setupWorld,
  submitLeave,
  useWorkflow,
  usersStep,
} from "../test-support/workflow-fixtures";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

/**
 * 流程任務的側欄計數信號(底座規格 10.4):任務建立 / 結束時,交易後對相關審核者送 `badge:apply-center`,
 * 一次 `/publish` 帶多個 `user:` 頻道。即時通道在測試裡是停用的(記錄用 adapter),這裡攔它的 `send`。
 */
describe("流程任務 → badge:apply-center", () => {
  let api: AuthTestApp;
  let world: World;
  let reviewers: Person[];
  const sent: RealtimePublishRequest[] = [];

  function badgeTopics(): string[][] {
    return sent
      .filter((request) => request.signal.type === "badge:apply-center")
      .map((request) => request.topics);
  }

  beforeAll(async () => {
    api = await startAuthTestApp("workflow_realtime_badge", {
      WORKFLOW_MAIL_ENABLED: "false",
    });
    world = await setupWorld(api, api.connection, 2);
    reviewers = world.staff.slice(0, 2);
    await useWorkflow(world, "badge_flow", {
      steps: [usersStep("one", reviewers)],
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

  it("任務建立給 A、B → 一次送出到 user:A、user:B;核准後對兩人再送一次(2 秒合併後的窗尾)", async () => {
    const userTopics = reviewers.map((one) => `user:${String(one.userId)}`);
    const submitted = await submitLeave(world);
    expect(badgeTopics()).toEqual([expect.arrayContaining(userTopics)]);
    expect(badgeTopics()[0]).toHaveLength(2);

    const [first] = reviewers;
    if (first === undefined) {
      throw new Error("缺審核者");
    }
    await decideOn(world, first, submitted.id, "APPROVE");
    // 送出後 2 秒內的第二次由送出端合併成窗尾一次
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const later = badgeTopics().slice(1).flat();
    expect(later).toEqual(expect.arrayContaining(userTopics));
  });
});
