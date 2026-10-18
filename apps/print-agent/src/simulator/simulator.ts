import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PrintAgentPrinter, PrinterStatus } from "@repo/domain/printing";

import {
  ESC,
  FEED_AND_CUT,
  GS,
  INITIALIZE,
  type MonoBitmap,
  concatChunks,
} from "../escpos/commands";
import { encodeMonoPng } from "../escpos/png";
import type { PrintOutcome, PrinterTransport } from "../escpos/transport";

/**
 * 模擬印表機(`simulator`):不送出,把收到的 ESC/POS 指令**解回點陣圖**存成 PNG。
 * 存的是「收據機會印出來的樣子」,不是原始圖片 —— 順便驗證指令本身排得對(開發、測試用)。
 * 啟用:`print-agent run --simulator <目錄>`(所有印表機都改送到這裡)。
 */
export class EscPosParseError extends Error {
  override readonly name = "EscPosParseError";
}

export interface ParsedPrint {
  bitmap: MonoBitmap;
  /** 最後有沒有切紙指令。 */
  cut: boolean;
}

const startsWith = (bytes: Uint8Array, at: number, prefix: Uint8Array) =>
  prefix.every((value, index) => bytes[at + index] === value);

const isRaster = (bytes: Uint8Array, at: number) =>
  bytes[at] === GS && bytes[at + 1] === 0x76 && bytes[at + 2] === 0x30;

/** 讀一段 `GS v 0 m xL xH yL yH d…`:回這段的每列寬(bytes)、各列與下一個指令的位置。 */
function readRaster(
  bytes: Uint8Array,
  at: number,
): { bytesPerRow: number; rows: Uint8Array[]; next: number } {
  const x = (bytes[at + 4] ?? 0) | ((bytes[at + 5] ?? 0) << 8);
  const y = (bytes[at + 6] ?? 0) | ((bytes[at + 7] ?? 0) << 8);
  const start = at + 8;
  const next = start + x * y;
  if (next > bytes.length) {
    throw new EscPosParseError("點陣圖資料不完整");
  }
  const rows = Array.from({ length: y }, (_, row) =>
    bytes.subarray(start + row * x, start + (row + 1) * x),
  );
  return { bytesPerRow: x, rows, next };
}

/** 解析本代理程式產生的指令子集(`ESC @`、`GS v 0`、`GS V 66 n`);不認得的指令丟錯。 */
export function parseEscPos(bytes: Uint8Array): ParsedPrint {
  const rows: Uint8Array[] = [];
  let bytesPerRow: number | null = null;
  let cut = false;
  let at = 0;
  while (at < bytes.length) {
    if (startsWith(bytes, at, INITIALIZE)) {
      at += INITIALIZE.length;
      continue;
    }
    if (isRaster(bytes, at)) {
      const band = readRaster(bytes, at);
      if (bytesPerRow !== null && bytesPerRow !== band.bytesPerRow) {
        throw new EscPosParseError("各段點陣圖寬度不一致");
      }
      bytesPerRow = band.bytesPerRow;
      rows.push(...band.rows);
      at = band.next;
      continue;
    }
    if (startsWith(bytes, at, FEED_AND_CUT.subarray(0, 3))) {
      cut = true;
      at += FEED_AND_CUT.length;
      continue;
    }
    throw new EscPosParseError(
      `不認得的指令 0x${(bytes[at] ?? 0).toString(16)}${bytes[at] === ESC ? "(ESC)" : ""},位置 ${String(at)}`,
    );
  }
  const width = (bytesPerRow ?? 0) * 8;
  return {
    bitmap: {
      width,
      height: rows.length,
      bytesPerRow: bytesPerRow ?? 0,
      data: concatChunks(rows),
    },
    cut,
  };
}

export interface SimulatorOptions {
  dir: string;
  now?: () => Date;
}

export class SimulatorTransport implements PrinterTransport {
  private sequence = 0;

  constructor(private readonly options: SimulatorOptions) {}

  async print(
    printer: PrintAgentPrinter,
    chunks: readonly Uint8Array[],
  ): Promise<PrintOutcome> {
    let parsed: ParsedPrint;
    try {
      parsed = parseEscPos(concatChunks(chunks));
    } catch (error) {
      return {
        ok: false,
        error: "other",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    if (!parsed.cut) {
      return { ok: false, error: "other", detail: "指令沒有切紙" };
    }
    await mkdir(this.options.dir, { recursive: true });
    this.sequence += 1;
    const stamp = (this.options.now ?? (() => new Date()))()
      .toISOString()
      .replaceAll(/[:.]/g, "-");
    const file = path.join(
      this.options.dir,
      `${stamp}-${String(this.sequence)}-${printer.id}.png`,
    );
    await writeFile(file, encodeMonoPng(parsed.bitmap));
    return { ok: true };
  }

  status(): Promise<PrinterStatus> {
    return Promise.resolve("ok");
  }
}
