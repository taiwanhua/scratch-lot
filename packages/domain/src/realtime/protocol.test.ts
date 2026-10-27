import { describe, expect, it } from "@jest/globals";

import {
  REALTIME_PING,
  REALTIME_PONG,
  isRealtimePublishRequest,
  parseRealtimeClientMessage,
  signRealtimePublish,
  verifyRealtimePublish,
} from "./protocol";
import { REALTIME_PING_INTERVAL_MS, REALTIME_PONG_TIMEOUT_MS } from "./timing";
import { isRealtimeSignal, isRealtimeTopic } from "./topic";

describe("信號只有類型與編號", () => {
  it("接受 { type } 與 { type, id }", () => {
    expect(isRealtimeSignal({ type: "notification" })).toBe(true);
    expect(isRealtimeSignal({ type: "badge:orders", id: "o1" })).toBe(true);
  });

  it("類型的子類型可以是以 . 分段的模組 key(`badge:<模組 key>`)", () => {
    expect(isRealtimeSignal({ type: "badge:group.module" })).toBe(true);
    expect(isRealtimeSignal({ type: "badge:a.b-c.d_e" })).toBe(true);
    expect(isRealtimeSignal({ type: "badge:.module" })).toBe(false);
    expect(isRealtimeSignal({ type: "badge:group." })).toBe(false);
    expect(isRealtimeSignal({ type: "badge:group..module" })).toBe(false);
    expect(isRealtimeSignal({ type: "badge.group" })).toBe(false);
    expect(isRealtimeSignal({ type: "badge:group:module" })).toBe(false);
  });

  it("夾帶任何其他欄位(資料)→ 不是信號", () => {
    expect(
      isRealtimeSignal({ type: "badge:apply-center", data: { count: 3 } }),
    ).toBe(false);
    expect(
      isRealtimeSignal({ type: "notification", id: "1", title: "x" }),
    ).toBe(false);
  });

  it("類型 / 編號格式不對 → 不是信號", () => {
    expect(isRealtimeSignal({ type: "" })).toBe(false);
    expect(isRealtimeSignal({ type: "Notification" })).toBe(false);
    expect(isRealtimeSignal({ type: "notification", id: 1 })).toBe(false);
    expect(isRealtimeSignal("notification")).toBe(false);
  });
});

describe("頻道格式", () => {
  it("只認 user / print-agent / board 三種", () => {
    expect(isRealtimeTopic("user:u1")).toBe(true);
    expect(isRealtimeTopic("print-agent:a1")).toBe(true);
    expect(isRealtimeTopic("board:b1")).toBe(true);
    expect(isRealtimeTopic("tenant:t1")).toBe(false);
    expect(isRealtimeTopic("user:")).toBe(false);
    expect(isRealtimeTopic("user:a b")).toBe(false);
  });
});

describe("/publish 請求", () => {
  const signal = { type: "badge:apply-center" };

  it("形狀:tenantId、topics(一次多個頻道)、signal 三個欄位", () => {
    expect(
      isRealtimePublishRequest({
        tenantId: "t1",
        topics: ["user:u1", "user:u2", "board:b1"],
        signal,
      }),
    ).toBe(true);
    expect(
      isRealtimePublishRequest({
        tenantId: "t1",
        topics: ["user:u1"],
        signal,
        payload: {},
      }),
    ).toBe(false);
    // tenantId 與憑證同一套識別格式(isRealtimeId):格式錯或超過長度上限都拒絕
    for (const tenantId of ["t 1", "", "t".repeat(129)]) {
      expect(
        isRealtimePublishRequest({ tenantId, topics: ["user:u1"], signal }),
      ).toBe(false);
    }
    expect(
      isRealtimePublishRequest({
        tenantId: "t1",
        topics: ["user:u1"],
        signal: { type: "notification", data: 1 },
      }),
    ).toBe(false);
  });

  it("topics 必須是不重複、格式正確的非空陣列(舊的單一 topic 欄位不再接受)", () => {
    for (const topics of [
      [],
      ["user:u1", "user:u1"],
      ["tenant:t1"],
      "user:u1",
    ]) {
      expect(isRealtimePublishRequest({ tenantId: "t1", topics, signal })).toBe(
        false,
      );
    }
    expect(
      isRealtimePublishRequest({ tenantId: "t1", topic: "user:u1", signal }),
    ).toBe(false);
  });

  it("簽章對原始 body 驗證;改一個字或缺簽章都不通過", async () => {
    const body = JSON.stringify({ tenantId: "t1", topics: ["user:u1"] });
    const signature = await signRealtimePublish(body, "publish-secret");
    await expect(
      verifyRealtimePublish(body, signature, "publish-secret"),
    ).resolves.toBe(true);
    await expect(
      verifyRealtimePublish(`${body} `, signature, "publish-secret"),
    ).resolves.toBe(false);
    await expect(
      verifyRealtimePublish(body, signature, "other-secret"),
    ).resolves.toBe(false);
    await expect(
      verifyRealtimePublish(body, null, "publish-secret"),
    ).resolves.toBe(false);
    await expect(
      verifyRealtimePublish(body, "%%%", "publish-secret"),
    ).resolves.toBe(false);
  });
});

describe("連線上的訊息", () => {
  it("解析 subscribe / unsubscribe / renew", () => {
    expect(
      parseRealtimeClientMessage('{"op":"subscribe","topic":"board:b1"}'),
    ).toEqual({ op: "subscribe", topic: "board:b1" });
    expect(
      parseRealtimeClientMessage('{"op":"unsubscribe","topic":"board:b1"}'),
    ).toEqual({ op: "unsubscribe", topic: "board:b1" });
    expect(parseRealtimeClientMessage('{"op":"renew","ticket":"a.b"}')).toEqual(
      { op: "renew", ticket: "a.b" },
    );
  });

  it("不是 JSON、未知 op、頻道格式錯 → null", () => {
    expect(parseRealtimeClientMessage("subscribe board:b1")).toBeNull();
    expect(parseRealtimeClientMessage('{"op":"publish"}')).toBeNull();
    expect(
      parseRealtimeClientMessage('{"op":"subscribe","topic":"x"}'),
    ).toBeNull();
  });
});

describe("偵測半開連線的 ping / pong", () => {
  it("與其他訊息同一格式({ op }),在 Cloudflare 的 2,048 字元上限內", () => {
    expect(JSON.parse(REALTIME_PING)).toEqual({ op: "ping" });
    expect(JSON.parse(REALTIME_PONG)).toEqual({ op: "pong" });
    expect(REALTIME_PING.length).toBeLessThanOrEqual(2048);
    expect(REALTIME_PONG.length).toBeLessThanOrEqual(2048);
  });

  it("ping 不是一般的客戶端訊息(由 auto-response 處理,不進 webSocketMessage)", () => {
    expect(parseRealtimeClientMessage(REALTIME_PING)).toBeNull();
  });

  it("pong 逾時短於送 ping 的間隔:同一時間最多一個 ping 在等回應", () => {
    expect(REALTIME_PONG_TIMEOUT_MS).toBeLessThan(REALTIME_PING_INTERVAL_MS);
  });
});
