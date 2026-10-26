/**
 * ESC/POS 指令(收據機 XP-Q90EC,58mm;`escpos` 模組):
 *
 * ```
 * ESC @                      初始化
 * GS v 0 m xL xH yL yH d…    點陣圖(分段送,每段最多 BAND_ROWS 列)
 * GS V 66 n                  送紙到切刀位置 + n 點後切紙
 * DLE EOT 4                  即時查詢紙張感測器(缺紙)
 * ```
 *
 * 黑白轉換在瀏覽器做(與預覽同一個元件產出 384 點寬黑白 PNG);這裡只把點陣排成指令。
 */

export const ESC = 0x1b;
export const GS = 0x1d;
export const DLE = 0x10;
export const EOT = 0x04;

/** `ESC @`:清除緩衝、回到預設模式。 */
export const INITIALIZE = Uint8Array.of(ESC, 0x40);

/** `GS V 66 n`(Function B):送紙到切刀位置再多送 n 點,然後切紙(本機型為部分切)。 */
export const CUT_FEED_DOTS = 0;
export const FEED_AND_CUT = Uint8Array.of(GS, 0x56, 66, CUT_FEED_DOTS);

/** `DLE EOT 4`:紙張感測器狀態(即時指令,印表機立即回一個 byte)。 */
export const PAPER_STATUS_REQUEST = Uint8Array.of(DLE, EOT, 4);

/** 每段點陣圖的列數:分段送,不讓單一指令塞爆收據機的接收緩衝。 */
export const BAND_ROWS = 128;

/** `GS v 0` 的 m:0 = 一般倍率(不放大)。 */
const RASTER_MODE_NORMAL = 0;

/** 單色點陣:每列 `bytesPerRow` bytes、高位元在左;bit = 1 是黑點(要印)。 */
export interface MonoBitmap {
  width: number;
  height: number;
  bytesPerRow: number;
  data: Uint8Array;
}

/** 一段 `GS v 0`:從第 `startRow` 列起 `rows` 列。 */
export function rasterBand(
  bitmap: MonoBitmap,
  startRow: number,
  rows: number,
): Uint8Array {
  const x = bitmap.bytesPerRow;
  const header = Uint8Array.of(
    GS,
    0x76,
    0x30,
    RASTER_MODE_NORMAL,
    x & 0xff,
    (x >> 8) & 0xff,
    rows & 0xff,
    (rows >> 8) & 0xff,
  );
  const body = bitmap.data.subarray(startRow * x, (startRow + rows) * x);
  const band = new Uint8Array(header.length + body.length);
  band.set(header, 0);
  band.set(body, header.length);
  return band;
}

/**
 * 一張單據的完整指令,分成多段(TCP 依序寫出):初始化 → 各段點陣圖 → 送紙切紙。
 * 空白圖片(高度 0)也照樣切紙。
 *
 * `cutRows`(圖片裡的中段切紙位置,`readPngCutRows`;例:一次印兩聯):印到那一列先送紙切紙,再接著印下一段;
 * 點陣圖在切紙位置一定斷開(那一段不跨過切紙位置)。範圍外的列(`≤ 0`、`≥ 高度`)略過。
 */
export function buildPrintCommands(
  bitmap: MonoBitmap,
  bandRows = BAND_ROWS,
  cutRows: readonly number[] = [],
): Uint8Array[] {
  const chunks: Uint8Array[] = [INITIALIZE];
  const middle = new Set(
    cutRows.filter((row) => row > 0 && row < bitmap.height),
  );
  const stops = [...[...middle].toSorted((a, b) => a - b), bitmap.height];
  let row = 0;
  for (const stop of stops) {
    while (row < stop) {
      const rows = Math.min(bandRows, stop - row);
      chunks.push(rasterBand(bitmap, row, rows));
      row += rows;
    }
    chunks.push(FEED_AND_CUT);
  }
  return chunks;
}

export function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * `DLE EOT 4` 的回應:固定位元 bit1、bit4 = 1,bit0、bit7 = 0;
 * bit5 / bit6 = 紙張用完(paper end)。格式不對(不是這個指令的回應)回 `unknown`。
 */
export type PaperStatus = "ok" | "paper-out" | "unknown";

const FIXED_MASK = 0b1001_0011;
const FIXED_VALUE = 0b0001_0010;
const PAPER_END_BITS = 0b0110_0000;

export function parsePaperStatus(byte: number): PaperStatus {
  if ((byte & FIXED_MASK) !== FIXED_VALUE) {
    return "unknown";
  }
  return (byte & PAPER_END_BITS) === 0 ? "ok" : "paper-out";
}
