import { crc32 } from "node:zlib";

import { describe, expect, it } from "@jest/globals";

import {
  PRINT_IMAGE_MAX_HEIGHT_DOTS,
  PRINT_JOB_RESULT_TIMEOUT_MS,
} from "@repo/domain/printing";

import { FEED_AND_CUT } from "../escpos/commands";
import {
  FakeAgentApi,
  ManualTimers,
  MemoryLogger,
  RecordingTransport,
  pngFromRows,
  samplePrinter,
} from "../test-support/fakes";
import {
  JobRunner,
  PRINT_START_MARGIN_MS,
  RESULT_RETRY_DELAYS_MS,
} from "./job-runner";

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

/** 在 IHDR 後面插一個 `tEXt`「cut-rows」區塊(CRC 要對:pngjs 會驗)。 */
function withCutRows(png: Uint8Array, rows: string): Uint8Array {
  const body = Buffer.from(`tEXtcut-rows\0${rows}`, "latin1");
  const chunk = Buffer.alloc(body.length + 8);
  chunk.writeUInt32BE(body.length - 4, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), body.length + 4);
  // 簽章 8 + IHDR 25
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}

async function claim(api: FakeAgentApi, id: string) {
  const claimed = await api.claim(id);
  if (claimed === null) {
    throw new Error("claim failed");
  }
  return claimed;
}

describe("佇列", () => {
  it("認領已超過結果逾時才輪到:不印,回報失敗", async () => {
    const { api, transport, timers, runner } = setup();
    api.addJob("late");
    const claimed = await claim(api, "late");
    await timers.advance(PRINT_JOB_RESULT_TIMEOUT_MS + 1);
    await runner.enqueue(claimed.printer, claimed.job, 0);
    await runner.idle();
    expect(transport.printed).toHaveLength(0);
    expect(api.results).toEqual([
      { jobId: "late", body: { status: "failed", error: "other" } },
    ]);
  });

  it("結果逾時剩不到「總期限 + 回報餘裕」(約 45 秒)就不開印;剛好夠才印", async () => {
    expect(PRINT_START_MARGIN_MS).toBe(45_000);
    const { api, transport, timers, runner } = setup();
    api.addJob("tight");
    api.addJob("enough");
    const tight = await claim(api, "tight");
    const enough = await claim(api, "enough");
    await timers.advance(PRINT_JOB_RESULT_TIMEOUT_MS - PRINT_START_MARGIN_MS);
    // tight 早 1ms 認領:剩 44.999 秒
    await runner.enqueue(tight.printer, tight.job, -1);
    await runner.enqueue(enough.printer, enough.job, 0);
    await runner.idle();
    expect(transport.printed).toHaveLength(1);
    expect(api.results).toEqual([
      { jobId: "tight", body: { status: "failed", error: "other" } },
      { jobId: "enough", body: { status: "printed" } },
    ]);
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

  it("圖片帶中段切紙位置(tEXt「cut-rows」,一次印兩聯):印到那一列先切紙,再接著印", async () => {
    const { api, transport, timers, runner } = setup();
    api.addJob("copies", withCutRows(pngFromRows(["#", "#", "#", "#"]), "2"));
    const claimed = await claim(api, "copies");
    await runner.enqueue(claimed.printer, claimed.job, timers.now());
    await runner.idle();
    const cut = [...FEED_AND_CUT].join(",");
    const cuts = (transport.printed[0]?.chunks ?? []).filter(
      (chunk) => [...chunk].join(",") === cut,
    );
    expect(cuts).toHaveLength(2);
    expect(api.results).toEqual([
      { jobId: "copies", body: { status: "printed" } },
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
