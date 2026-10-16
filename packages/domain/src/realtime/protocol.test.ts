import { describe, expect, it } from "@jest/globals";

import {
  isRealtimePublishRequest,
  parseRealtimeClientMessage,
  signRealtimePublish,
  verifyRealtimePublish,
} from "./protocol";
import { isRealtimeSignal, isRealtimeTopic } from "./topic";

describe("信號只有類型與編號", () => {
  it("接受 { type } 與 { type, id }", () => {
    expect(isRealtimeSignal({ type: "task" })).toBe(true);
    expect(isRealtimeSignal({ type: "badge:orders", id: "o1" })).toBe(true);
  });

  it("夾帶任何其他欄位(資料)→ 不是信號", () => {
    expect(isRealtimeSignal({ type: "task", data: { count: 3 } })).toBe(false);
    expect(isRealtimeSignal({ type: "task", id: "1", title: "x" })).toBe(false);
  });

  it("類型 / 編號格式不對 → 不是信號", () => {
    expect(isRealtimeSignal({ type: "" })).toBe(false);
    expect(isRealtimeSignal({ type: "Task" })).toBe(false);
    expect(isRealtimeSignal({ type: "task", id: 1 })).toBe(false);
    expect(isRealtimeSignal("task")).toBe(false);
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
  it("形狀:tenantId、topic、signal 三個欄位", () => {
    expect(
      isRealtimePublishRequest({
        tenantId: "t1",
        topic: "user:u1",
        signal: { type: "task" },
      }),
    ).toBe(true);
    expect(
      isRealtimePublishRequest({
        tenantId: "t1",
        topic: "user:u1",
        signal: { type: "task" },
        payload: {},
      }),
    ).toBe(false);
    expect(
      isRealtimePublishRequest({
        tenantId: "t1",
        topic: "user:u1",
        signal: { type: "task", data: 1 },
      }),
    ).toBe(false);
  });

  it("簽章對原始 body 驗證;改一個字或缺簽章都不通過", async () => {
    const body = JSON.stringify({ tenantId: "t1", topic: "user:u1" });
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
