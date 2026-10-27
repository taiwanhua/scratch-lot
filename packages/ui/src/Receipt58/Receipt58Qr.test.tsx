import { describe, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react";
import {
  BinaryBitmap,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} from "@zxing/library";

import { Receipt58 } from "./Receipt58";
import { Receipt58Qr } from "./Receipt58Qr";
import { type DecodedPng, decodePng, readBlob } from "./png-test-support";
import { RECEIPT58_DOTS, RECEIPT58_QR_QUIET_ZONE } from "./receipt58-tokens";
import {
  type ReceiptRasterizer,
  renderReceiptToPng,
  screenshotSizeOf,
} from "./render-receipt-to-png";
import { qrModules } from "./symbol-modules";

/** 使用者實測掃不出來的測試頁網址。 */
const URL_VALUE = "https://erp-dev.scratch-lot.com/system/printers";
/** 單據版面高(CSS px)與 QR 在單據裡的位置(CSS px)。 */
const PAPER_HEIGHT = 400;
const QR_TOP = 40;

const rectOf = (left: number, top: number, width: number, height: number) =>
  ({
    left,
    top,
    width,
    height,
    x: left,
    y: top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  }) as DOMRect;

/** 掛上一張只有 QR 的單據,並替 jsdom 補上排版位置(jsdom 不排版,`getBoundingClientRect` 全是 0)。 */
const mountReceipt = (displayScale = 1) => {
  const { container } = render(
    <Receipt58>
      <Receipt58Qr value={URL_VALUE} />
    </Receipt58>,
  );
  const paper = container.querySelector<HTMLElement>("[data-receipt58]");
  const qr = container.querySelector<SVGSVGElement>("svg[data-receipt58-qr]");
  if (paper === null || qr === null) throw new Error("找不到單據或 QR");
  const side = Number(qr.getAttribute("width"));
  const qrLeft = (RECEIPT58_DOTS - side) / 2;
  // displayScale ≠ 1:預覽被祖先 transform 縮放顯示(畫面上的大小變了,版面寬仍是 384)
  jest
    .spyOn(paper, "getBoundingClientRect")
    .mockReturnValue(
      rectOf(
        10,
        20,
        RECEIPT58_DOTS * displayScale,
        PAPER_HEIGHT * displayScale,
      ),
    );
  jest
    .spyOn(qr, "getBoundingClientRect")
    .mockReturnValue(
      rectOf(
        10 + qrLeft * displayScale,
        20 + QR_TOP * displayScale,
        side * displayScale,
        side * displayScale,
      ),
    );
  return { paper, side, qrLeft, unit: Number(qr.dataset.moduleDots) };
};

/** 一個像素被 [start, start + size) 蓋住的比例。 */
const coverage = (start: number, size: number, pixel: number) =>
  Math.max(0, Math.min(pixel + 1, start + size) - Math.max(pixel, start));

/** 以覆蓋比例畫一個邊界落在小數像素上的黑色模組(邊緣變灰)。 */
const inkModule = (
  image: { width: number; data: Uint8ClampedArray },
  left: number,
  top: number,
  size: number,
) => {
  for (let y = Math.floor(top); y < Math.ceil(top + size); y += 1) {
    for (let x = Math.floor(left); x < Math.ceil(left + size); x += 1) {
      const ink = coverage(left, size, x) * coverage(top, size, y);
      const at = (y * image.width + x) * 4;
      const value = Math.round((image.data[at] ?? 255) - 255 * ink);
      image.data.fill(value, at, at + 3);
    }
  }
};

/**
 * 模擬「截圖沒有對齊整數點」的瀏覽器結果(jsdom 沒有 canvas):以 `pixelRatio` 倍的解析度畫出整張單據,
 * QR 的模組邊界落在小數像素上、以覆蓋比例畫成灰邊,再位移半個像素 ——
 * 這就是 devicePixelRatio 1.25 / 1.5 時模組變成 4 / 5 點不均的來源。
 */
const blurryRaster =
  (pixelRatio: number, qrLeft: number, unit: number): ReceiptRasterizer =>
  () => {
    const matrix = qrModules(URL_VALUE);
    const width = Math.round(RECEIPT58_DOTS * pixelRatio);
    const height = Math.round(PAPER_HEIGHT * pixelRatio);
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const moduleSize = unit * pixelRatio;
    const originX =
      (qrLeft + RECEIPT58_QR_QUIET_ZONE * unit) * pixelRatio + 0.5;
    const originY =
      (QR_TOP + RECEIPT58_QR_QUIET_ZONE * unit) * pixelRatio + 0.5;
    for (const [my, row] of matrix.entries()) {
      for (const [mx, isDark] of row.entries()) {
        if (isDark) {
          inkModule(
            { width, data },
            originX + mx * moduleSize,
            originY + my * moduleSize,
            moduleSize,
          );
        }
      }
    }
    return Promise.resolve({ width, height, data });
  };

/** 用 QR 解碼器(ZXing)讀回 1-bit PNG 的內容。 */
const decodeQr = (png: DecodedPng): string => {
  const luminance = Uint8ClampedArray.from(png.pixels, (pixel) =>
    pixel === 0 ? 0 : 255,
  );
  const source = new RGBLuminanceSource(luminance, png.width, png.height);
  return new QRCodeReader()
    .decode(new BinaryBitmap(new HybridBinarizer(source)))
    .getText();
};

/** 點陣某一列從 `x` 起連續黑點的長度。 */
const darkRun = (png: DecodedPng, x: number, y: number): number => {
  let length = 0;
  while (png.pixels[y * png.width + x + length] === 0) length += 1;
  return length;
};

describe("renderReceiptToPng 的 QR code", () => {
  it.each([
    { pixelRatio: 1, displayScale: 1 },
    { pixelRatio: 1.25, displayScale: 1 },
    { pixelRatio: 1.5, displayScale: 1 },
    { pixelRatio: 1.25, displayScale: 0.8 },
  ])(
    "devicePixelRatio $pixelRatio、顯示縮放 $displayScale:每模組恰好 6 點,解碼器讀回原網址",
    async ({ pixelRatio, displayScale }) => {
      const { paper, qrLeft, unit } = mountReceipt(displayScale);
      expect(unit).toBe(6);

      const blob = await renderReceiptToPng(paper, {
        rasterize: blurryRaster(pixelRatio, qrLeft, unit),
      });
      const png = decodePng(await readBlob(blob));

      expect(png.width).toBe(RECEIPT58_DOTS);
      expect(decodeQr(png)).toBe(URL_VALUE);
      // 左上定位框:第一列(與第 3 列中心)整條 7 模組黑 = 42 點,起點落在整數點
      const finderX = qrLeft + RECEIPT58_QR_QUIET_ZONE * unit;
      const finderY = QR_TOP + RECEIPT58_QR_QUIET_ZONE * unit;
      expect(png.pixels[finderY * png.width + finderX - 1]).toBe(1);
      for (let dy = 0; dy < unit; dy += 1) {
        expect(darkRun(png, finderX, finderY + dy)).toBe(7 * unit);
      }
      // 第 2 模組列:黑 1 模組 → 白 5 模組 → 黑 1 模組
      expect(darkRun(png, finderX, finderY + unit)).toBe(unit);
      expect(darkRun(png, finderX + 6 * unit, finderY + unit)).toBe(unit);
    },
  );

  it("截圖尺寸以版面寬高指定,canvas 寬恰為 384 點(不讀受縮放影響的 getBoundingClientRect)", () => {
    const node = document.createElement("div");
    Object.defineProperty(node, "offsetWidth", { value: RECEIPT58_DOTS });
    Object.defineProperty(node, "offsetHeight", { value: 731 });

    const size = screenshotSizeOf(node);

    expect(size).toEqual({ width: RECEIPT58_DOTS, height: 731, scale: 1 });
    expect(Math.floor(size.width * size.scale)).toBe(RECEIPT58_DOTS);
  });
});
