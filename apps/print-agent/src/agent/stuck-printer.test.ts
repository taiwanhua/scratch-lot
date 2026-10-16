import { afterEach, describe, expect, it } from "@jest/globals";

import { FEED_AND_CUT } from "../escpos/commands";
import { TcpPrinterTransport } from "../escpos/tcp-printer";
import {
  FakeAgentApi,
  ManualTimers,
  MemoryLogger,
  samplePrinter,
} from "../test-support/fakes";
import {
  type StuckPrinter,
  startStuckPrinter,
  waitFor,
} from "../test-support/stuck-printer";
import { PrintAgent } from "./agent";

/**
 * 收據機接受連線但不收資料時,不能拖垮整台代理程式:這張到期限回報失敗、下一張照常印、心跳照常送。
 * 假 9100 伺服器是真的 TCP(真實時間);代理程式的輪詢 / 心跳計時用手動計時器。
 */
const printers: StuckPrinter[] = [];
afterEach(async () => {
  await Promise.all(printers.splice(0).map((printer) => printer.close()));
});

async function stuckPrinter(stuckConnections: number): Promise<StuckPrinter> {
  const printer = await startStuckPrinter(stuckConnections);
  printers.push(printer);
  return printer;
}

describe("收據機卡住(接受連線但不讀資料)", () => {
  it("寫到緩衝滿卡住:總期限到就 destroy、回報 other", async () => {
    const fake = await stuckPrinter(1);
    const transport = new TcpPrinterTransport({
      jobTimeoutMs: 500,
      statusTimeoutMs: 50,
    });
    // 32MB:遠超過作業系統的 socket 緩衝,寫入一定會卡住
    const chunks = Array.from({ length: 32 }, () => new Uint8Array(1 << 20));
    const started = Date.now();
    const outcome = await transport.print(
      samplePrinter({ port: fake.port }),
      chunks,
    );
    expect(outcome).toMatchObject({ ok: false, error: "other" });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("這張到期限回報失敗;期間心跳照常送出;下一張照常印", async () => {
    const fake = await stuckPrinter(1);
    const api = new FakeAgentApi();
    api.printers[0] = samplePrinter({ port: fake.port });
    const timers = new ManualTimers();
    const agent = new PrintAgent({
      api,
      // 查紙等 5 秒,但整張只給 400ms:卡住的那條連線一定先撞到總期限
      transport: new TcpPrinterTransport({
        jobTimeoutMs: 400,
        statusTimeoutMs: 5000,
      }),
      logger: new MemoryLogger(),
      timers,
      version: "1.0.0",
      createRealtime: () => ({
        start() {
          // 不連即時通道
        },
        stop() {
          // 同上
        },
      }),
    });

    api.addJob("stuck");
    await agent.start();
    await waitFor(() => fake.connections() === 1);

    // 列印卡住中:心跳不等佇列,用上次的狀態直接送出
    const heartbeatsBefore = api.heartbeats.length;
    await agent.heartbeat();
    expect(api.heartbeats).toHaveLength(heartbeatsBefore + 1);
    expect(api.heartbeats.at(-1)?.printers).toEqual([
      { id: "printer-1", status: "ok" },
    ]);
    expect(api.results).toHaveLength(0);

    await agent.idle();
    expect(api.results).toEqual([
      { jobId: "stuck", body: { status: "failed", error: "other" } },
    ]);

    api.addJob("next");
    await agent.poll();
    await agent.idle();
    expect(api.results.at(-1)).toEqual({
      jobId: "next",
      body: { status: "printed" },
    });
    await waitFor(() => fake.received.length === 1);
    const bytes = fake.received[0] ?? new Uint8Array();
    expect([...bytes.subarray(-FEED_AND_CUT.length)]).toEqual([
      ...FEED_AND_CUT,
    ]);
    await agent.stop();
  });

  it("沒回 DLE EOT 4 的印表機:每台只記一次 warn,照常列印", async () => {
    const fake = await stuckPrinter(2);
    const logger = new MemoryLogger();
    const transport = new TcpPrinterTransport({
      statusTimeoutMs: 50,
      logger,
    });
    const printer = samplePrinter({ port: fake.port });
    await expect(transport.status(printer)).resolves.toBe("ok");
    await expect(transport.status(printer)).resolves.toBe("ok");
    expect(
      logger.lines.filter(
        (line) => line.level === "warn" && line.message.includes("DLE EOT"),
      ),
    ).toHaveLength(1);
  });

  it("查紙途中撞到總期限:回報 other,但不誤記「沒回 DLE EOT」", async () => {
    const fake = await stuckPrinter(1);
    const logger = new MemoryLogger();
    const transport = new TcpPrinterTransport({
      jobTimeoutMs: 200,
      statusTimeoutMs: 5000,
      logger,
    });
    await expect(
      transport.print(samplePrinter({ port: fake.port }), [
        Uint8Array.of(0x1b, 0x40),
      ]),
    ).resolves.toMatchObject({ ok: false, error: "other" });
    // 讓被 destroy 的那條連線把查紙收尾跑完
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(
      logger.lines.filter((line) => line.message.includes("DLE EOT")),
    ).toHaveLength(0);
  });
});
