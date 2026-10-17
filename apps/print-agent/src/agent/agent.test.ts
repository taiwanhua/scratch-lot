import { describe, expect, it } from "@jest/globals";

import {
  PRINT_AGENT_HEARTBEAT_INTERVAL_MS,
  PRINT_AGENT_POLL_INTERVAL_MS,
  PRINT_SIGNALS,
} from "@repo/domain/printing";
import {
  REALTIME_PING_INTERVAL_MS,
  REALTIME_PONG_TIMEOUT_MS,
} from "@repo/domain/realtime";

import { PrintAgentApiError } from "../api-client/api-client";
import { RealtimeLink } from "../realtime/realtime-link";
import {
  FakeAgentApi,
  FakeSocket,
  ManualTimers,
  MemoryLogger,
  RecordingTransport,
} from "../test-support/fakes";
import { PrintAgent } from "./agent";

function setup() {
  const api = new FakeAgentApi();
  const transport = new RecordingTransport();
  const logger = new MemoryLogger();
  const timers = new ManualTimers();
  const sockets: FakeSocket[] = [];
  const agent = new PrintAgent({
    api,
    transport,
    logger,
    timers,
    version: "1.2.3",
    createRealtime: (options) =>
      new RealtimeLink({
        ...options,
        createSocket: (url) => {
          const socket = new FakeSocket(url);
          sockets.push(socket);
          return socket;
        },
      }),
  });
  const socket = () => {
    const last = sockets.at(-1);
    if (last === undefined) {
      throw new Error("還沒建立連線");
    }
    return last;
  };
  return { api, transport, logger, timers, agent, socket, sockets };
}

describe("代理程式", () => {
  it("啟動:先心跳、再拿一次未完成工作並印出,接著連即時通道", async () => {
    const { api, transport, agent, timers, sockets } = setup();
    api.addJob("job-1");
    await agent.start();
    await timers.advance(0);
    await agent.idle();
    expect(api.calls.slice(0, 2)).toEqual(["heartbeat", "jobs"]);
    expect(transport.printed).toHaveLength(1);
    expect(api.results).toEqual([
      { jobId: "job-1", body: { status: "printed" } },
    ]);
    expect(sockets).toHaveLength(1);
    await agent.stop();
  });

  it("信號與輪詢同時帶來同一張工作:只認領成功一次、只印一次(依 API 的認領)", async () => {
    const { api, transport, agent, timers, socket } = setup();
    await agent.start();
    await timers.advance(0);
    socket().open();
    api.addJob("job-dup");
    // 信號與輪詢幾乎同時到
    socket().message({
      op: "signal",
      topic: "print-agent:agent-1",
      signal: { type: PRINT_SIGNALS.job, id: "job-dup" },
    });
    await agent.poll();
    // 本機去重被清掉的情況(例:另一個行程 / 重啟後):第二次認領由 API 擋下(409)
    const second = new PrintAgent({
      api,
      transport,
      logger: new MemoryLogger(),
      timers,
      version: "1.2.3",
      createRealtime: () => ({
        start() {
          // 這個代理程式只收手動送進來的信號,不連即時通道
        },
        stop() {
          // 同上
        },
      }),
    });
    second.handleSignal({ type: PRINT_SIGNALS.job, id: "job-dup" });
    await agent.idle();
    await second.idle();
    expect(transport.printed).toHaveLength(1);
    expect(
      api.results.filter((entry) => entry.jobId === "job-dup"),
    ).toHaveLength(1);
    expect(
      api.calls.filter((call) => call === "claim:job-dup").length,
    ).toBeGreaterThanOrEqual(2);
    await agent.stop();
  });

  it("即時通道斷線 → 60 秒內輪詢仍拿到工作並印出", async () => {
    const { api, transport, agent, timers, socket } = setup();
    await agent.start();
    await timers.advance(0);
    socket().open();
    expect(api.calls.filter((call) => call === "jobs")).toHaveLength(2); // 啟動 + 連上後補抓

    // Worker 掛了:斷線後重連也一直失敗(拿憑證就失敗)
    api.ticketResponse = { ticket: null, connectUrl: null, expiresAt: null };
    socket().drop();
    api.addJob("job-offline");
    expect(transport.printed).toHaveLength(0);

    // 啟動時排的 60 秒輪詢:到點前不會印
    await timers.advance(PRINT_AGENT_POLL_INTERVAL_MS - 1);
    expect(transport.printed).toHaveLength(0);
    await timers.advance(1);
    await agent.idle();
    expect(transport.printed).toHaveLength(1);
    expect(api.results).toEqual([
      { jobId: "job-offline", body: { status: "printed" } },
    ]);
    await agent.stop();
  });

  it("連著即時通道時不輪詢,但每 60 秒照樣心跳(維持 lastSeenAt)", async () => {
    const { api, agent, timers, socket } = setup();
    await agent.start();
    await timers.advance(0);
    socket().open();
    const jobsBefore = api.calls.filter((call) => call === "jobs").length;
    await timers.advance(PRINT_AGENT_HEARTBEAT_INTERVAL_MS * 3);
    expect(api.calls.filter((call) => call === "jobs")).toHaveLength(
      jobsBefore,
    );
    expect(api.heartbeats).toHaveLength(4); // 啟動 1 次 + 3 分鐘 3 次
    expect(api.heartbeats.at(-1)).toEqual({
      version: "1.2.3",
      printers: [{ id: "printer-1", status: "ok" }],
    });
    await agent.stop();
  });

  it("重新連上即時通道時先補抓一次", async () => {
    const { api, transport, agent, timers, socket } = setup();
    await agent.start();
    await timers.advance(0);
    socket().open();
    socket().drop();
    api.addJob("job-missed");
    await timers.advance(1000); // 第一次重連退避 1 秒
    socket().open();
    await agent.idle();
    expect(transport.printed).toHaveLength(1);
    await agent.stop();
  });

  it("半開連線:ping 10 秒沒有 pong → 重連,重新連上先補抓錯過的工作", async () => {
    const { api, transport, agent, timers, socket, sockets } = setup();
    await agent.start();
    await timers.advance(0);
    socket().open();
    // 連線其實斷了:送得出去但收不到任何東西(信號也收不到)
    socket().autoPong = false;
    api.addJob("job-half-open");
    await timers.advance(REALTIME_PING_INTERVAL_MS + REALTIME_PONG_TIMEOUT_MS);
    expect(sockets[0]?.closed).not.toBeNull();
    expect(transport.printed).toHaveLength(0);
    await timers.advance(0); // 立即重連
    expect(sockets).toHaveLength(2);
    socket().open();
    await agent.idle();
    expect(transport.printed).toHaveLength(1);
    expect(api.results).toEqual([
      { jobId: "job-half-open", body: { status: "printed" } },
    ]);
    await agent.stop();
  });

  it("列印失敗(缺紙)回報 failed + paper-out,心跳回報印表機缺紙", async () => {
    const { api, transport, agent, timers } = setup();
    transport.outcome = { ok: false, error: "paper-out", detail: "缺紙" };
    transport.printerStatus = "paper-out";
    api.addJob("job-paper");
    await agent.start();
    await timers.advance(0);
    await agent.idle();
    expect(api.results).toEqual([
      { jobId: "job-paper", body: { status: "failed", error: "paper-out" } },
    ]);
    await timers.advance(PRINT_AGENT_HEARTBEAT_INTERVAL_MS);
    expect(api.heartbeats.at(-1)?.printers).toEqual([
      { id: "printer-1", status: "paper-out" },
    ]);
    await agent.stop();
  });

  it("圖片壞掉:不送印表機,回報 failed + other", async () => {
    const { api, transport, agent, timers } = setup();
    api.addJob("job-bad", Uint8Array.of(1, 2, 3));
    await agent.start();
    await timers.advance(0);
    await agent.idle();
    expect(transport.printed).toHaveLength(0);
    expect(api.results).toEqual([
      { jobId: "job-bad", body: { status: "failed", error: "other" } },
    ]);
    await agent.stop();
  });

  it("金鑰被撤銷(401):只記一次錯誤,不洗版", async () => {
    const { api, agent, timers, logger } = setup();
    api.failure = new PrintAgentApiError(401, "/print-agent/jobs");
    await agent.start();
    await timers.advance(PRINT_AGENT_POLL_INTERVAL_MS * 3);
    expect(logger.lines.filter((line) => line.level === "error")).toHaveLength(
      1,
    );
    await agent.stop();
  });

  it("不是 print-job 的信號、沒有 id 的信號都不理", async () => {
    const { api, agent, timers } = setup();
    await agent.start();
    await timers.advance(0);
    agent.handleSignal({ type: "notification", id: "x" });
    agent.handleSignal({ type: PRINT_SIGNALS.job });
    await agent.idle();
    expect(api.calls.some((call) => call.startsWith("claim:"))).toBe(false);
    await agent.stop();
  });
});
