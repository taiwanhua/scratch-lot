import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "@jest/globals";

import { FEED_AND_CUT, buildPrintCommands } from "../escpos/commands";
import { decodePng, toMonoBitmap } from "../escpos/png";
import { pngFromRows, samplePrinter } from "../test-support/fakes";
import { SimulatorTransport, parseEscPos } from "./simulator";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const rows = ["#......#", ".#....#.", "..####..", "########"];

describe("模擬印表機", () => {
  it("把 ESC/POS 解回點陣圖:與原圖一致、有切紙", () => {
    const bitmap = toMonoBitmap(decodePng(pngFromRows(rows)), 384);
    const parsed = parseEscPos(Buffer.concat(buildPrintCommands(bitmap, 3)));
    expect(parsed.cut).toBe(true);
    expect(parsed.bitmap.height).toBe(4);
    expect([...parsed.bitmap.data]).toEqual([...bitmap.data]);
  });

  it("不認得的指令丟錯;沒有切紙的指令回報失敗", async () => {
    expect(() => parseEscPos(Uint8Array.of(0x1b, 0x21, 0x00))).toThrow(
      "不認得",
    );
    const dir = mkdtempSync(path.join(tmpdir(), "print-agent-sim-"));
    dirs.push(dir);
    const simulator = new SimulatorTransport({ dir });
    const chunks = buildPrintCommands(
      toMonoBitmap(decodePng(pngFromRows(rows)), 384),
    );
    await expect(
      simulator.print(samplePrinter(), chunks.slice(0, -1)),
    ).resolves.toMatchObject({ ok: false });
    expect(chunks.at(-1)).toEqual(FEED_AND_CUT);
  });

  it("存成 PNG,內容就是會印出來的樣子", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "print-agent-sim-"));
    dirs.push(dir);
    const simulator = new SimulatorTransport({ dir });
    const source = toMonoBitmap(decodePng(pngFromRows(rows)), 384);
    await expect(
      simulator.print(samplePrinter(), buildPrintCommands(source)),
    ).resolves.toEqual({ ok: true });
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    const saved = toMonoBitmap(
      decodePng(readFileSync(path.join(dir, files[0] ?? ""))),
      384,
    );
    expect([...saved.data]).toEqual([...source.data]);
  });
});
