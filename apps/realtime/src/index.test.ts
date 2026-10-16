import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  REALTIME_CLOSE_CODES,
  signRealtimePublish,
} from "@repo/domain/realtime";

import { nowSeconds } from "./env";
import type { ConnectionAttachment } from "./tenant-hub";
import {
  connect,
  connectWith,
  hubStub,
  issueTicket,
  publish,
  publishMany,
  publishRaw,
  statusOf,
} from "./test-support";

describe("/connect 驗證訂閱憑證", () => {
  it("有效憑證 → 101,初始訂閱自己的 user: 頻道", async () => {
    const conn = await connect(
      await issueTicket("tenant-a", { userId: "u1" }, []),
    );
    await expect(
      publish("tenant-a", "user:u1", { type: "notification" }),
    ).resolves.toBe(1);
    await expect(conn.next()).resolves.toEqual({
      op: "signal",
      topic: "user:u1",
      signal: { type: "notification" },
    });
    conn.ws.close();
  });

  it("代理程式的初始訂閱是 print-agent:<自己>", async () => {
    const conn = await connect(
      await issueTicket("tenant-a", { agentId: "a1" }, []),
    );
    await publish("tenant-a", "print-agent:a1", {
      type: "print-job",
      id: "j1",
    });
    await expect(conn.next()).resolves.toEqual({
      op: "signal",
      topic: "print-agent:a1",
      signal: { type: "print-job", id: "j1" },
    });
    conn.ws.close();
  });

  it("過期、竄改或缺少的憑證 → 401", async () => {
    const expired = await issueTicket(
      "tenant-a",
      { userId: "u1" },
      [],
      nowSeconds() - 1,
    );
    expect(await statusOf(connectWith(expired))).toBe(401);
    expect(await statusOf(connectWith("not-a-ticket"))).toBe(401);
    const valid = await issueTicket("tenant-a", { userId: "u1" }, []);
    expect(await statusOf(connectWith(`${valid}x`))).toBe(401);
  });

  it("不是 WebSocket 升級請求 → 426", async () => {
    const ticket = await issueTicket("tenant-a", { userId: "u1" }, []);
    const response = await exports.default.fetch(
      `https://rt.test/connect?ticket=${ticket}`,
    );
    expect(response.status).toBe(426);
  });
});

describe("租戶與個人頻道隔離", () => {
  it("租戶 A 的憑證無法訂閱別人的 user: 頻道(即使憑證列了也不放行)", async () => {
    const conn = await connect(
      await issueTicket("tenant-a", { userId: "u1" }, ["user:u2", "board:b1"]),
    );
    conn.send({ op: "subscribe", topic: "user:u2" });
    await expect(conn.next()).resolves.toEqual({
      op: "rejected",
      reason: "not-allowed",
    });
    await expect(
      publish("tenant-a", "user:u2", { type: "notification" }),
    ).resolves.toBe(0);
    conn.ws.close();
  });

  it("租戶 A 的連線收不到租戶 B 的信號(同名頻道也一樣)", async () => {
    const conn = await connect(
      await issueTicket("tenant-a", { userId: "u1" }, ["board:b1"]),
    );
    conn.send({ op: "subscribe", topic: "board:b1" });
    await expect(conn.next()).resolves.toEqual({
      op: "subscribed",
      topic: "board:b1",
    });

    await expect(
      publish("tenant-b", "user:u1", { type: "notification" }),
    ).resolves.toBe(0);
    await expect(
      publish("tenant-b", "board:b1", { type: "board" }),
    ).resolves.toBe(0);
    await expect(
      publish("tenant-a", "board:b1", { type: "board" }),
    ).resolves.toBe(1);
    // 下一則就是租戶 A 的信號:租戶 B 的兩次送出沒有任何東西推到這條連線
    await expect(conn.next()).resolves.toEqual({
      op: "signal",
      topic: "board:b1",
      signal: { type: "board" },
    });
    conn.ws.close();
  });

  it("租戶 A 的憑證無法換成租戶 B 的憑證(換發要同租戶同持有者)", async () => {
    const conn = await connect(
      await issueTicket("tenant-a", { userId: "u1" }, []),
    );
    conn.send({
      op: "renew",
      ticket: await issueTicket("tenant-b", { userId: "u1" }, ["board:b9"]),
    });
    await expect(conn.next()).resolves.toEqual({
      op: "rejected",
      reason: "ticket-mismatch",
    });
    conn.send({
      op: "renew",
      ticket: await issueTicket("tenant-a", { userId: "u2" }, []),
    });
    await expect(conn.next()).resolves.toEqual({
      op: "rejected",
      reason: "ticket-mismatch",
    });
    conn.ws.close();
  });
});

describe("訂閱 / 取消訂閱", () => {
  it("可訂閱頻道內才加入;取消後不再收到", async () => {
    const conn = await connect(
      await issueTicket("tenant-a", { userId: "u1" }, ["board:b1"]),
    );
    conn.send({ op: "subscribe", topic: "board:b2" });
    await expect(conn.next()).resolves.toEqual({
      op: "rejected",
      reason: "not-allowed",
    });
    conn.send({ op: "subscribe", topic: "board:b1" });
    await expect(conn.next()).resolves.toEqual({
      op: "subscribed",
      topic: "board:b1",
    });
    conn.send({ op: "unsubscribe", topic: "board:b1" });
    await expect(conn.next()).resolves.toEqual({
      op: "unsubscribed",
      topic: "board:b1",
    });
    await expect(
      publish("tenant-a", "board:b1", { type: "board" }),
    ).resolves.toBe(0);
    conn.ws.close();
  });

  it("格式錯誤的訊息 → rejected bad-message,連線不中斷", async () => {
    const conn = await connect(
      await issueTicket("tenant-a", { userId: "u1" }, []),
    );
    conn.ws.send("hello");
    await expect(conn.next()).resolves.toEqual({
      op: "rejected",
      reason: "bad-message",
    });
    await publish("tenant-a", "user:u1", { type: "notification" });
    await expect(conn.next()).resolves.toMatchObject({ op: "signal" });
    conn.ws.close();
  });
});

/** 把該租戶所有連線的憑證到期時間改成已過(模擬 10 分鐘過去)。 */
async function expireAll(tenantId: string): Promise<void> {
  await runInDurableObject(hubStub(tenantId), (_instance, state) => {
    for (const ws of state.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as ConnectionAttachment;
      ws.serializeAttachment({ ...attachment, exp: nowSeconds() - 1 });
    }
  });
}

describe("憑證到期與換發", () => {
  it("過期憑證的連線在下一次推送時被關閉、不收到信號", async () => {
    const conn = await connect(
      await issueTicket("tenant-exp", { userId: "u1" }, []),
    );
    await expireAll("tenant-exp");

    await expect(
      publish("tenant-exp", "user:u1", { type: "notification" }),
    ).resolves.toBe(0);
    await expect(conn.closed).resolves.toEqual({
      code: REALTIME_CLOSE_CODES.ticketExpired,
      reason: "ticket expired",
    });
    expect(conn.pending()).toBe(0);
  });

  it("過期後送 subscribe 也直接關閉連線", async () => {
    const conn = await connect(
      await issueTicket("tenant-exp2", { userId: "u1" }, ["board:b1"]),
    );
    await expireAll("tenant-exp2");
    conn.send({ op: "subscribe", topic: "board:b1" });
    await expect(conn.closed).resolves.toMatchObject({
      code: REALTIME_CLOSE_CODES.ticketExpired,
    });
  });

  it("在原連線上換發:更新到期時間與可訂閱頻道,已訂閱但不再允許的頻道移除", async () => {
    const conn = await connect(
      await issueTicket("tenant-renew", { userId: "u1" }, [
        "board:b1",
        "board:b2",
      ]),
    );
    conn.send({ op: "subscribe", topic: "board:b1" });
    await conn.next();
    conn.send({ op: "subscribe", topic: "board:b2" });
    await conn.next();

    const exp = nowSeconds() + 1200;
    conn.send({
      op: "renew",
      ticket: await issueTicket(
        "tenant-renew",
        { userId: "u1" },
        ["board:b2", "board:b3"],
        exp,
      ),
    });
    await expect(conn.next()).resolves.toEqual({ op: "renewed", exp });

    await expect(
      publish("tenant-renew", "board:b1", { type: "board" }),
    ).resolves.toBe(0);
    await expect(
      publish("tenant-renew", "board:b2", { type: "board" }),
    ).resolves.toBe(1);
    await expect(conn.next()).resolves.toMatchObject({ topic: "board:b2" });
    conn.send({ op: "subscribe", topic: "board:b3" });
    await expect(conn.next()).resolves.toEqual({
      op: "subscribed",
      topic: "board:b3",
    });
    conn.ws.close();
  });

  it("換發用的憑證無效 → rejected invalid-ticket,原憑證照舊有效", async () => {
    const conn = await connect(
      await issueTicket("tenant-renew2", { userId: "u1" }, []),
    );
    conn.send({ op: "renew", ticket: "forged.ticket" });
    await expect(conn.next()).resolves.toEqual({
      op: "rejected",
      reason: "invalid-ticket",
    });
    await publish("tenant-renew2", "user:u1", { type: "notification" });
    await expect(conn.next()).resolves.toMatchObject({ op: "signal" });
    conn.ws.close();
  });
});

describe("推送時單一連線出錯", () => {
  it("一條連線失敗只略過它,其他連線照收、/publish 不回 500", async () => {
    const broken = await connect(
      await issueTicket("tenant-s2", { userId: "u1" }, []),
    );
    const healthy = await connect(
      await issueTicket("tenant-s2", { userId: "u2" }, []),
    );
    // 把 u1 連線的 attachment 弄壞(subscribedTopics 不是陣列):推送它時會拋錯
    await runInDurableObject(hubStub("tenant-s2"), (_instance, state) => {
      for (const ws of state.getWebSockets()) {
        const attachment = ws.deserializeAttachment() as ConnectionAttachment;
        if (attachment.userId === "u1") {
          ws.serializeAttachment({ ...attachment, subscribedTopics: null });
        }
      }
    });

    for (const topic of ["user:u1", "user:u2"]) {
      const body = JSON.stringify({
        tenantId: "tenant-s2",
        topics: [topic],
        signal: { type: "notification" },
      });
      const response = await publishRaw(
        body,
        await signRealtimePublish(body, env.REALTIME_PUBLISH_SECRET),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        delivered: topic === "user:u2" ? 1 : 0,
      });
    }
    await expect(healthy.next()).resolves.toEqual({
      op: "signal",
      topic: "user:u2",
      signal: { type: "notification" },
    });
    expect(broken.pending()).toBe(0);
    broken.ws.close();
    healthy.ws.close();
  });
});

describe("/publish", () => {
  const body = JSON.stringify({
    tenantId: "tenant-a",
    topics: ["user:u1"],
    signal: { type: "notification" },
  });

  it("簽章錯誤 → 401", async () => {
    const wrong = await signRealtimePublish(body, "wrong-secret");
    expect(await statusOf(publishRaw(body, wrong))).toBe(401);
  });

  it("沒有簽章 → 401", async () => {
    expect(await statusOf(publishRaw(body, null))).toBe(401);
  });

  it("信號夾帶資料 → 400(信號只有類型與編號)", async () => {
    const withData = JSON.stringify({
      tenantId: "tenant-a",
      topic: "user:u1",
      signal: { type: "task", data: { count: 3 } },
    });
    const response = await publishRaw(
      withData,
      await signRealtimePublish(withData, env.REALTIME_PUBLISH_SECRET),
    );
    expect(response.status).toBe(400);
  });

  it("不是 POST → 405;未知路徑 → 404", async () => {
    expect(
      await statusOf(exports.default.fetch("https://rt.test/publish")),
    ).toBe(405);
    expect(await statusOf(exports.default.fetch("https://rt.test/other"))).toBe(
      404,
    );
  });

  it("信號不保存:送出時沒有連線訂閱,之後連上的連線也收不到", async () => {
    await expect(
      publish("tenant-late", "user:u1", { type: "notification" }),
    ).resolves.toBe(0);
    const conn = await connect(
      await issueTicket("tenant-late", { userId: "u1" }, []),
    );
    await publish("tenant-late", "user:u1", { type: "notification" });
    await expect(conn.next()).resolves.toEqual({
      op: "signal",
      topic: "user:u1",
      signal: { type: "notification" },
    });
    conn.ws.close();
  });
});

describe("一次送出多個頻道", () => {
  it("一次 /publish 送到 3 個 user: 頻道:3 人各收到一次", async () => {
    const conns = await Promise.all(
      ["u1", "u2", "u3"].map(async (userId) =>
        connect(await issueTicket("tenant-multi", { userId }, [])),
      ),
    );
    await expect(
      publishMany("tenant-multi", ["user:u1", "user:u2", "user:u3"], {
        type: "badge:apply-center",
      }),
    ).resolves.toBe(3);
    for (const [index, conn] of conns.entries()) {
      await expect(conn.next()).resolves.toEqual({
        op: "signal",
        topic: `user:u${String(index + 1)}`,
        signal: { type: "badge:apply-center" },
      });
      expect(conn.pending()).toBe(0);
      conn.ws.close();
    }
  });

  it("同一條連線訂閱了一次送出裡的多個頻道:只推一次", async () => {
    const conn = await connect(
      await issueTicket("tenant-once", { userId: "u1" }, ["board:b1"]),
    );
    conn.send({ op: "subscribe", topic: "board:b1" });
    await conn.next();
    await expect(
      publishMany("tenant-once", ["board:b1", "user:u1"], { type: "board" }),
    ).resolves.toBe(1);
    await expect(conn.next()).resolves.toEqual({
      op: "signal",
      topic: "board:b1",
      signal: { type: "board" },
    });
    // 下一則一定是這次的 notification:上一次送出沒有推第二份
    await publish("tenant-once", "user:u1", { type: "notification" });
    await expect(conn.next()).resolves.toMatchObject({
      signal: { type: "notification" },
    });
    conn.ws.close();
  });
});

describe("看板頻道按需換發", () => {
  it("平常只有 user:<自己>;換發含 board:A 後才能訂閱;切到 B 時 A 的訂閱自動取消", async () => {
    const conn = await connect(
      await issueTicket("tenant-board", { userId: "u1" }, ["user:u1"]),
    );
    conn.send({ op: "subscribe", topic: "board:A" });
    await expect(conn.next()).resolves.toEqual({
      op: "rejected",
      reason: "not-allowed",
    });

    conn.send({
      op: "renew",
      ticket: await issueTicket("tenant-board", { userId: "u1" }, [
        "user:u1",
        "board:A",
      ]),
    });
    await expect(conn.next()).resolves.toMatchObject({ op: "renewed" });
    conn.send({ op: "subscribe", topic: "board:A" });
    await expect(conn.next()).resolves.toEqual({
      op: "subscribed",
      topic: "board:A",
    });

    conn.send({
      op: "renew",
      ticket: await issueTicket("tenant-board", { userId: "u1" }, [
        "user:u1",
        "board:B",
      ]),
    });
    await expect(conn.next()).resolves.toMatchObject({ op: "renewed" });
    await expect(
      publish("tenant-board", "board:A", { type: "board" }),
    ).resolves.toBe(0);
    conn.send({ op: "subscribe", topic: "board:B" });
    await expect(conn.next()).resolves.toEqual({
      op: "subscribed",
      topic: "board:B",
    });

    // 離開看板頁:取消訂閱、換回只含 user:<自己> 的憑證;個人頻道照收
    conn.send({ op: "unsubscribe", topic: "board:B" });
    await expect(conn.next()).resolves.toMatchObject({ op: "unsubscribed" });
    conn.send({
      op: "renew",
      ticket: await issueTicket("tenant-board", { userId: "u1" }, ["user:u1"]),
    });
    await expect(conn.next()).resolves.toMatchObject({ op: "renewed" });
    await expect(
      publish("tenant-board", "user:u1", { type: "notification" }),
    ).resolves.toBe(1);
    conn.ws.close();
  });
});

describe("連線資料寫入失敗", () => {
  it("attachment 超過上限 → 用明確的關閉代碼關閉連線;其他連線與 /publish 不受影響", async () => {
    const big = await connect(
      await issueTicket("tenant-big", { userId: "u1" }, []),
    );
    const other = await connect(
      await issueTicket("tenant-big", { userId: "u2" }, []),
    );
    // 頻道數量不設上限:換發一張頻道多到 attachment 超過 16 KB 的憑證
    const topics = Array.from(
      { length: 1000 },
      (_, index) => `board:branch-${String(index).padStart(6, "0")}`,
    );
    big.send({
      op: "renew",
      ticket: await issueTicket("tenant-big", { userId: "u1" }, topics),
    });
    await expect(big.closed).resolves.toEqual({
      code: REALTIME_CLOSE_CODES.attachmentFailed,
      reason: "attachment failed",
    });
    expect(big.pending()).toBe(0);

    await expect(
      publishMany("tenant-big", ["user:u1", "user:u2"], {
        type: "notification",
      }),
    ).resolves.toBe(1);
    await expect(other.next()).resolves.toMatchObject({ topic: "user:u2" });
    other.ws.close();
  });
});
