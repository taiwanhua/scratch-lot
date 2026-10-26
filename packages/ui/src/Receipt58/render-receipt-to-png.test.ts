import { describe, expect, it } from "@jest/globals";

import { decodePng, makeRgba, readBlob } from "./png-test-support";
import {
  type ReceiptRasterizer,
  renderReceiptToPng,
} from "./render-receipt-to-png";

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

/** 假的版面位置(jsdom 不排版)。 */
const rectOf = (top: number, height: number) =>
  ({ top, bottom: top + height, left: 0, width: 384 }) as DOMRect;

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
    expect(png.texts).toEqual({});
  });

  it("好幾聯排在一起:切紙位置(Receipt58Cut 的下緣)寫進 tEXt「cut-rows」;最下面那一個不記", async () => {
    const node = document.createElement("div");
    node.getBoundingClientRect = () => rectOf(100, 1000);
    const cuts = [
      [500, 20],
      [800, 20],
      [1080, 20],
    ].map(([top = 0, height = 0]) => {
      const cut = document.createElement("div");
      cut.dataset.receipt58Cut = "";
      cut.getBoundingClientRect = () => rectOf(top, height);
      node.append(cut);
      return cut;
    });
    expect(cuts).toHaveLength(3);

    const blob = await renderReceiptToPng(node, {
      rasterize: fakeRaster(384, 1000),
    });

    const png = decodePng(await readBlob(blob));
    // 520 − 100、820 − 100;1100 − 100 = 1000 = 高度(本來就會切)不記
    expect(png.texts).toEqual({ "cut-rows": "420,720" });
  });
});
