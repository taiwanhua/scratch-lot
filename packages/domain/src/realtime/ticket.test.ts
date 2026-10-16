import { describe, expect, it } from "@jest/globals";

import { encodeBase64Url, encodeUtf8, signHmac } from "./hmac";
import {
  REALTIME_TICKET_TTL_SECONDS,
  type RealtimeTicket,
  parseRealtimeTicket,
  realtimeAllowedTopics,
  realtimeSelfTopic,
  realtimeTicketHolder,
  signRealtimeTicket,
  verifyRealtimeTicket,
} from "./ticket";

const SECRET = "ticket-secret";
const NOW = 1_800_000_000;

function userTicket(overrides: Partial<RealtimeTicket> = {}): RealtimeTicket {
  return {
    tenantId: "tenant-a",
    userId: "u1",
    exp: NOW + REALTIME_TICKET_TTL_SECONDS,
    topics: ["user:u1", "board:b1"],
    ...overrides,
  } as RealtimeTicket;
}

describe("訂閱憑證簽章與驗證", () => {
  it("簽出的憑證在到期前驗證通過,內容原樣取回", async () => {
    const ticket = userTicket();
    const token = await signRealtimeTicket(ticket, SECRET);
    await expect(verifyRealtimeTicket(token, SECRET, NOW)).resolves.toEqual({
      ok: true,
      ticket,
    });
  });

  it("效期是 10 分鐘", () => {
    expect(REALTIME_TICKET_TTL_SECONDS).toBe(600);
  });

  it("exp 等於現在即視為過期", async () => {
    const token = await signRealtimeTicket(userTicket({ exp: NOW }), SECRET);
    await expect(verifyRealtimeTicket(token, SECRET, NOW)).resolves.toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("用不同密鑰簽的憑證 → bad-signature", async () => {
    const token = await signRealtimeTicket(userTicket(), "other-secret");
    await expect(verifyRealtimeTicket(token, SECRET, NOW)).resolves.toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("竄改內容(改租戶)但沿用舊簽章 → bad-signature", async () => {
    const token = await signRealtimeTicket(userTicket(), SECRET);
    const [, signature] = token.split(".");
    const forged = encodeBase64Url(
      encodeUtf8(JSON.stringify(userTicket({ tenantId: "tenant-b" }))),
    );
    await expect(
      verifyRealtimeTicket(`${forged}.${signature ?? ""}`, SECRET, NOW),
    ).resolves.toEqual({ ok: false, reason: "bad-signature" });
  });

  it("不是兩段式字串 → malformed", async () => {
    await expect(verifyRealtimeTicket("abc", SECRET, NOW)).resolves.toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("簽章正確但內容不是合法憑證(多欄位夾帶資料)→ malformed", async () => {
    const body = encodeBase64Url(
      encodeUtf8(JSON.stringify({ ...userTicket(), data: { secret: 1 } })),
    );
    const token = `${body}.${await signHmac(SECRET, body)}`;
    await expect(verifyRealtimeTicket(token, SECRET, NOW)).resolves.toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("空密鑰不允許簽章", async () => {
    await expect(signRealtimeTicket(userTicket(), "")).rejects.toThrow();
  });
});

describe("訂閱憑證內容形狀", () => {
  it("userId 與 agentId 恰好一個", () => {
    expect(parseRealtimeTicket({ ...userTicket(), agentId: "a1" })).toBeNull();
    expect(
      parseRealtimeTicket({ tenantId: "t", exp: NOW, topics: [] }),
    ).toBeNull();
    expect(
      parseRealtimeTicket({
        tenantId: "t",
        agentId: "a1",
        exp: NOW,
        topics: [],
      }),
    ).toEqual({ tenantId: "t", agentId: "a1", exp: NOW, topics: [] });
  });

  it("頻道格式不對 → 拒絕", () => {
    expect(parseRealtimeTicket(userTicket({ topics: ["admin"] }))).toBeNull();
  });
});

describe("可訂閱頻道", () => {
  it("使用者的個人頻道是 user:<自己>,代理程式是 print-agent:<自己>", () => {
    expect(realtimeSelfTopic(userTicket())).toBe("user:u1");
    expect(
      realtimeSelfTopic({ tenantId: "t", agentId: "a1", exp: NOW, topics: [] }),
    ).toBe("print-agent:a1");
  });

  it("剔除別人的個人頻道、補上自己的,其他頻道照憑證", () => {
    const ticket = userTicket({
      topics: ["user:u2", "print-agent:a9", "board:b1", "board:b1"],
    });
    expect(realtimeAllowedTopics(ticket)).toEqual(["user:u1", "board:b1"]);
  });

  it("持有者識別包含租戶與個人頻道", () => {
    expect(realtimeTicketHolder(userTicket())).toBe("tenant-a/user:u1");
  });
});
