import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";

import {
  REALTIME_PUBLISH_BODY_MAX_LENGTH,
  type RealtimePublishRequest,
} from "@repo/domain/realtime";

import {
  HOOK_TIMEOUT_MS,
  type TestDatabase,
  openTestDatabase,
} from "../database/test-support/mongo-connection";
import { TransactionService } from "../database/transaction";
import {
  REALTIME_PLATFORM_HUB,
  RealtimePublisher,
  chunkTopics,
} from "./realtime-publisher.service";
import { RealtimeTransport } from "./realtime-transport";

class RecordingTransport extends RealtimeTransport {
  readonly sent: RealtimePublishRequest[] = [];
  failing = false;

  send(request: RealtimePublishRequest): Promise<void> {
    if (this.failing) {
      return Promise.reject(new Error("Worker 連不上"));
    }
    this.sent.push(request);
    return Promise.resolve();
  }
}

/**
 * 送出信號:交易後執行、交易回復不送、盡力而為、一次多頻道。
 * 用真的單一成員 replica set 跑交易,transport 換成記錄用(這裡的信號類型都不合併,看板合併另見 `signal-coalescer.test.ts`)。
 */
describe("RealtimePublisher", () => {
  let database: TestDatabase;
  let transactions: TransactionService;
  let transport: RecordingTransport;
  let publisher: RealtimePublisher;
  let seq = 0;
  const nextUser = () => {
    seq += 1;
    return `u${String(seq)}`;
  };

  beforeAll(async () => {
    database = await openTestDatabase("cookhome-test-realtime-publisher");
    transactions = new TransactionService(database.connection);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  });

  beforeEach(() => {
    transport = new RecordingTransport();
    publisher = new RealtimePublisher(transport);
  });

  it("交易提交後才送出(publishAfterCommit)", async () => {
    const user = nextUser();
    await transactions.withTransaction(async () => {
      publisher.publishAfterCommit("t1", [`user:${user}`], {
        type: "notification",
      });
      expect(transport.sent).toEqual([]);
      await Promise.resolve();
    });
    expect(transport.sent).toEqual([
      {
        tenantId: "t1",
        topics: [`user:${user}`],
        signal: { type: "notification" },
      },
    ]);
  });

  it("交易回復時不送出信號", async () => {
    const user = nextUser();
    await expect(
      transactions.withTransaction(async () => {
        publisher.publishAfterCommit("t1", [`user:${user}`], {
          type: "notification",
        });
        await publisher.publishBadge("t1", "apply-center", [user]);
        throw new Error("後面一步失敗");
      }),
    ).rejects.toThrow("後面一步失敗");
    expect(transport.sent).toEqual([]);
  });

  it("交易內直接呼叫 publish → 拋錯(TX-03:改用 publishAfterCommit)", async () => {
    await expect(
      transactions.withTransaction(() =>
        publisher.publish("t1", [`user:${nextUser()}`], {
          type: "notification",
        }),
      ),
    ).rejects.toThrow(/交易內不得送出即時信號/);
    expect(transport.sent).toEqual([]);
  });

  it("publishBadge:一次 /publish 帶多個 user: 頻道;交易內延到提交後、交易外立即送", async () => {
    const [a, b] = [nextUser(), nextUser()];
    await transactions.withTransaction(async () => {
      await publisher.publishBadge("t1", "apply-center", [a, b]);
      expect(transport.sent).toEqual([]);
    });
    expect(transport.sent).toEqual([
      {
        tenantId: "t1",
        topics: [`user:${a}`, `user:${b}`],
        signal: { type: "badge:apply-center" },
      },
    ]);
    const c = nextUser();
    await publisher.publishBadge(null, "orders", [c]);
    expect(transport.sent[1]).toEqual({
      tenantId: REALTIME_PLATFORM_HUB,
      topics: [`user:${c}`],
      signal: { type: "badge:orders" },
    });
  });

  it("盡力而為:Worker 失敗只記 log,不拋錯", async () => {
    transport.failing = true;
    await expect(
      publisher.publish("t1", [`user:${nextUser()}`], { type: "notification" }),
    ).resolves.toBeUndefined();
  });

  it("信號夾帶資料或頻道格式錯 → 程式錯誤,拋錯", async () => {
    await expect(
      publisher.publish("t1", ["user:x"], {
        type: "notification",
        data: 1,
      } as never),
    ).rejects.toThrow(/信號格式錯誤/);
    await expect(
      publisher.publish("t1", ["tenant:x"], { type: "notification" }),
    ).rejects.toThrow(/頻道格式錯誤/);
  });

  it("頻道多到超過 /publish body 上限時切成多批", () => {
    const topics = Array.from(
      { length: 3000 },
      (_, index) => `user:${String(index).padStart(24, "0")}`,
    );
    const signal = { type: "badge:apply-center" };
    const batches = chunkTopics("t1", topics, signal);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toEqual(topics);
    for (const batch of batches) {
      expect(
        JSON.stringify({ tenantId: "t1", topics: batch, signal }).length,
      ).toBeLessThanOrEqual(REALTIME_PUBLISH_BODY_MAX_LENGTH);
    }
  });
});
