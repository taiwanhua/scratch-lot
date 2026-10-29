import { describe, expect, it } from "@jest/globals";

import {
  PRINT_IMAGE_MAX_BYTES,
  PRINT_IMAGE_MAX_HEIGHT_DOTS,
} from "@repo/domain/printing";

import { isPrintImageTooLarge } from "./print-image-limits";

/** 只有簽章 + IHDR 的 PNG(高 `height`)。 */
const pngBase64 = (height: number) => {
  const bytes = new Uint8Array(36);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 384);
  view.setUint32(20, height);
  return btoa(String.fromCodePoint(...bytes));
};

describe("列印影像的上限(兩聯接成一張,上限算加總)", () => {
  it("高度超過上限 → 太大;剛好等於上限 → 可以送", () => {
    expect(isPrintImageTooLarge(pngBase64(PRINT_IMAGE_MAX_HEIGHT_DOTS))).toBe(
      false,
    );
    expect(
      isPrintImageTooLarge(pngBase64(PRINT_IMAGE_MAX_HEIGHT_DOTS + 1)),
    ).toBe(true);
  });

  it("大小超過上限 → 太大;讀不出 IHDR 的交給 api 判斷", () => {
    expect(
      isPrintImageTooLarge(
        // 後面再接超過上限的資料(只看長度)
        pngBase64(100) + "A".repeat(Math.ceil((PRINT_IMAGE_MAX_BYTES * 4) / 3)),
      ),
    ).toBe(true);
    expect(isPrintImageTooLarge(pngBase64(100))).toBe(false);
    expect(isPrintImageTooLarge("not-a-png")).toBe(false);
  });
});
