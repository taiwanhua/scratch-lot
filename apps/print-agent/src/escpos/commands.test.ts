import { describe, expect, it } from "@jest/globals";

import { pngFromRows } from "../test-support/fakes";
import {
  FEED_AND_CUT,
  INITIALIZE,
  type MonoBitmap,
  PAPER_STATUS_REQUEST,
  buildPrintCommands,
  concatChunks,
  parsePaperStatus,
  rasterBand,
} from "./commands";
import { PrintImageError, decodePng, toMonoBitmap } from "./png";

const bytes = (data: Uint8Array) => [...data];

describe("ESC/POS 指令位元組", () => {
  it("固定指令:ESC @、GS V 66 0、DLE EOT 4", () => {
    expect(bytes(INITIALIZE)).toEqual([0x1b, 0x40]);
    expect(bytes(FEED_AND_CUT)).toEqual([0x1d, 0x56, 0x42, 0x00]);
    expect(bytes(PAPER_STATUS_REQUEST)).toEqual([0x10, 0x04, 0x04]);
  });

  it("GS v 0 的表頭:m=0、xL xH = 每列 bytes、yL yH = 列數,後面接點陣資料", () => {
    const bitmap: MonoBitmap = {
      width: 16,
      height: 3,
      bytesPerRow: 2,
      data: Uint8Array.of(0xff, 0x00, 0x0f, 0xf0, 0x80, 0x01),
    };
    expect(bytes(rasterBand(bitmap, 1, 2))).toEqual([
      0x1d, 0x76, 0x30, 0x00, 0x02, 0x00, 0x02, 0x00, 0x0f, 0xf0, 0x80, 0x01,
    ]);
  });

  it("384 點寬:xL xH = 48 0;300 列分成 128 / 128 / 44 三段", () => {
    const bitmap: MonoBitmap = {
      width: 384,
      height: 300,
      bytesPerRow: 48,
      data: new Uint8Array(48 * 300),
    };
    const chunks = buildPrintCommands(bitmap);
    expect(chunks).toHaveLength(5);
    expect(bytes(chunks[0] ?? new Uint8Array())).toEqual(bytes(INITIALIZE));
    const headers = chunks
      .slice(1, 4)
      .map((chunk) => bytes(chunk.subarray(0, 8)));
    expect(headers).toEqual([
      [0x1d, 0x76, 0x30, 0, 48, 0, 128, 0],
      [0x1d, 0x76, 0x30, 0, 48, 0, 128, 0],
      [0x1d, 0x76, 0x30, 0, 48, 0, 44, 0],
    ]);
    expect(chunks.slice(1, 4).map((chunk) => chunk.length)).toEqual([
      8 + 48 * 128,
      8 + 48 * 128,
      8 + 48 * 44,
    ]);
    expect(bytes(chunks.at(-1) ?? new Uint8Array())).toEqual(
      bytes(FEED_AND_CUT),
    );
  });

  it("空白圖片(高度 0)只有初始化與切紙", () => {
    const chunks = buildPrintCommands({
      width: 0,
      height: 0,
      bytesPerRow: 0,
      data: new Uint8Array(),
    });
    expect(bytes(concatChunks(chunks))).toEqual([
      ...bytes(INITIALIZE),
      ...bytes(FEED_AND_CUT),
    ]);
  });

  it("DLE EOT 4 回應:0x12 正常、0x72 缺紙(bit5/6)、近端(bit2/3)仍算正常、格式不對 unknown", () => {
    expect(parsePaperStatus(0x12)).toBe("ok");
    expect(parsePaperStatus(0x1e)).toBe("ok");
    expect(parsePaperStatus(0x72)).toBe("paper-out");
    expect(parsePaperStatus(0x32)).toBe("paper-out");
    expect(parsePaperStatus(0x00)).toBe("unknown");
    expect(parsePaperStatus(0xff)).toBe("unknown");
  });
});

describe("PNG → 單色點陣", () => {
  it("黑點 = 1、高位元在左;寬度不是 8 的倍數時補到整個 byte", () => {
    const bitmap = toMonoBitmap(
      decodePng(pngFromRows(["#.#.......", "........##"])),
      384,
    );
    expect(bitmap.width).toBe(10);
    expect(bitmap.bytesPerRow).toBe(2);
    expect(bytes(bitmap.data)).toEqual([0b1010_0000, 0x00, 0x00, 0b1100_0000]);
  });

  it("產生的指令與 PNG 逐 byte 對得上", () => {
    const rows = ["########", "#......#", "########"];
    const chunks = buildPrintCommands(
      toMonoBitmap(decodePng(pngFromRows(rows)), 384),
    );
    expect(bytes(concatChunks(chunks))).toEqual([
      0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, 0x01, 0x00, 0x03, 0x00, 0xff, 0x81,
      0xff, 0x1d, 0x56, 0x42, 0x00,
    ]);
  });

  it("超過紙寬的圖片拒絕(不裁切)、不是 PNG 的資料拒絕", () => {
    const wide = decodePng(pngFromRows(["#"], 385));
    expect(() => toMonoBitmap(wide, 384)).toThrow(PrintImageError);
    expect(() => decodePng(Uint8Array.of(1, 2, 3))).toThrow(PrintImageError);
  });
});
