import { describe, expect, it } from "@jest/globals";

import { decodePng, makeRgba } from "./png-test-support";
import {
  type ReceiptRasterizer,
  renderReceiptToPng,
} from "./render-receipt-to-png";

/** jsdom 的 Blob 沒有 `arrayBuffer()`,用 FileReader 讀回位元組。 */
const readBlob = (blob: Blob): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      resolve(new Uint8Array(reader.result as ArrayBuffer));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("read failed"));
    });
    // eslint-disable-next-line unicorn/prefer-blob-reading-methods -- jsdom 的 Blob 沒有 arrayBuffer()
    reader.readAsArrayBuffer(blob);
  });

/**
 * 模擬瀏覽器把節點畫出來的結果(jsdom 沒有 canvas):灰階漸層 + 彩色 + 半透明,寬度可指定。
 * 真正的點陣化(modern-screenshot)只在瀏覽器跑,由 Storybook 的測試頁 story 實看。
 */
const fakeRaster =
  (width: number, height: number): ReceiptRasterizer =>
  () =>
    Promise.resolve(
      makeRgba(width, height, (x, y) => [
        (x * 7) % 256,
        (y * 13) % 256,
        (x + y) % 256,
        (x * 3) % 256,
      ]),
    );

describe("renderReceiptToPng", () => {
  it("產出 PNG 寬度恰為 384、只有黑白兩色", async () => {
    const blob = await renderReceiptToPng(document.createElement("div"), {
      rasterize: fakeRaster(384, 120),
    });

    expect(blob.type).toBe("image/png");
    const png = decodePng(await readBlob(blob));
    expect(png.width).toBe(384);
    expect(png.height).toBe(120);
    expect(png.bitDepth).toBe(1);
    expect(png.colorType).toBe(0);
    expect(new Set(png.pixels)).toEqual(new Set([0, 1]));
  });

  it("點陣化結果不是 384 寬(例:高解析度螢幕 2 倍)時,也縮成 384 寬", async () => {
    const blob = await renderReceiptToPng(document.createElement("div"), {
      rasterize: fakeRaster(768, 400),
    });

    const png = decodePng(await readBlob(blob));
    expect(png.width).toBe(384);
    expect(png.height).toBe(200);
  });
});
