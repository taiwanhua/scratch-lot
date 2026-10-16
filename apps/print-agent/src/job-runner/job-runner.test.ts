import { describe, expect, it } from "@jest/globals";

import {
  PRINT_IMAGE_MAX_HEIGHT_DOTS,
  PRINT_JOB_RESULT_TIMEOUT_MS,
} from "@repo/domain/printing";

import {
  FakeAgentApi,
  ManualTimers,
  MemoryLogger,
  RecordingTransport,
  pngFromRows,
  samplePrinter,
} from "../test-support/fakes";
import { JobRunner, RESULT_RETRY_DELAYS_MS } from "./job-runner";

function setup() {
  const api = new FakeAgentApi();
  const transport = new RecordingTransport();
  const timers = new ManualTimers();
  const runner = new JobRunner({
    api,
    transport,
    logger: new MemoryLogger(),
    timers,
  });
  return { api, transport, timers, runner };
}

/** 把一張小 PNG 的 IHDR 高度改大(不解碼就該被擋;CRC 不對也無妨)。 */
function tallPng(height: number): Uint8Array {
  const png = pngFromRows(["#"]);
  new DataView(png.buffer, png.byteOffset, png.byteLength).setUint32(
    20,
    height,
  );
  return png;
}

async function claim(api: FakeAgentApi, id: string) {
  const claimed = await api.claim(id);
  if (claimed === null) {
    throw new Error("claim failed");
  }
  return claimed;
}

describe("佇列", () => {
  it("認領已超過結果逾時才輪到:不印、不回報", async () => {
    const { api, transport, timers, runner } = setup();
    api.addJob("late");
    const claimed = await claim(api, "late");
    await timers.advance(PRINT_JOB_RESULT_TIMEOUT_MS + 1);
    await runner.enqueue(claimed.printer, claimed.job, 0);
    await runner.idle();
    expect(transport.printed).toHaveLength(0);
    expect(api.results).toHaveLength(0);
  });

  it("回報結果失敗時依退避重試(總長約 90 秒),不擋下一張", async () => {
    expect(RESULT_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0)).toBe(
      90_000,
    );
    const { api, transport, timers, runner } = setup();
    api.addJob("a");
    api.addJob("b");
    const realResult = api.result.bind(api);
    let failures = 3;
    api.result = (jobId, body) => {
      if (jobId === "a" && failures > 0) {
        failures -= 1;
        return Promise.reject(new Error("network"));
      }
      return realResult(jobId, body);
    };
    const a = await claim(api, "a");
    const b = await claim(api, "b");
    await runner.enqueue(a.printer, a.job, timers.now());
    await runner.enqueue(b.printer, b.job, timers.now());
    // a 還在重試,b 已經印完並回報
    expect(transport.printed).toHaveLength(2);
    expect(api.results.map((entry) => entry.jobId)).toEqual(["b"]);
    await timers.advance(2000 + 4000 + 8000);
    await runner.idle();
    expect(api.results.map((entry) => entry.jobId)).toEqual(["b", "a"]);
  });

  it(`圖片高度超過 ${String(PRINT_IMAGE_MAX_HEIGHT_DOTS)} 點:只讀 IHDR 就擋下,回報 other`, async () => {
    const { api, transport, timers, runner } = setup();
    api.addJob("tall", tallPng(PRINT_IMAGE_MAX_HEIGHT_DOTS + 1));
    const claimed = await claim(api, "tall");
    await runner.enqueue(claimed.printer, claimed.job, timers.now());
    await runner.idle();
    expect(transport.printed).toHaveLength(0);
    expect(api.results).toEqual([
      { jobId: "tall", body: { status: "failed", error: "other" } },
    ]);
  });

  it("佇列忙時查狀態直接回上次的狀態(不等列印)", async () => {
    const { api, transport, timers, runner } = setup();
    const gate: { release: (() => void) | null } = { release: null };
    transport.print = () =>
      new Promise((resolve) => {
        gate.release = () => {
          resolve({ ok: false, error: "paper-out", detail: "缺紙" });
        };
      });
    transport.printerStatus = "offline";
    api.addJob("x");
    const claimed = await claim(api, "x");
    const printer = samplePrinter();
    void runner.enqueue(printer, claimed.job, timers.now());
    await timers.advance(0);
    await expect(runner.probe(printer)).resolves.toBe("ok");
    gate.release?.();
    await runner.idle();
    // 佇列空了:再查才真的問印表機
    await expect(runner.probe(printer)).resolves.toBe("offline");
  });
});
