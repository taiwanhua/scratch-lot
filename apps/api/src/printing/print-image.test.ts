import { describe, expect, it } from "@jest/globals";

import {
  PRINT_IMAGE_MAX_BYTES,
  PRINT_IMAGE_MAX_HEIGHT_DOTS,
} from "@repo/domain/printing";

import { decodePrintImage } from "./print-jobs.service";
import { pngBase64 } from "./test-support/printing-fixtures";

/** 執行並取出 `VALIDATION_FAILED` 的 fieldErrors;沒拋錯回 null。 */
function fieldErrorsOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return (error as { extensions?: { fieldErrors?: unknown } }).extensions
      ?.fieldErrors;
  }
  return null;
}

/** 列印影像的驗證(`decodePrintImage`;建立工作與測試列印共用)。 */
describe("列印影像 decodePrintImage", () => {
  it("384 點寬的 PNG(可帶 data URL 前綴)→ 原樣的位元組", () => {
    const base64 = pngBase64();
    expect(decodePrintImage(base64, 58)).toEqual(Buffer.from(base64, "base64"));
    expect(
      decodePrintImage(`data:image/png;base64,${base64}`, 58).length,
    ).toBeGreaterThan(0);
  });

  it("超過 512KB → INVALID_IMAGE", () => {
    const tooLarge = Buffer.alloc(PRINT_IMAGE_MAX_BYTES + 1).toString("base64");
    expect(fieldErrorsOf(() => decodePrintImage(tooLarge, 58))).toEqual([
      expect.objectContaining({ fieldKey: "image", code: "INVALID_IMAGE" }),
    ]);
  });

  it("剛好 512KB 不因大小被擋(改擋在不是 PNG)", () => {
    const atLimit = Buffer.alloc(PRINT_IMAGE_MAX_BYTES).toString("base64");
    expect(fieldErrorsOf(() => decodePrintImage(atLimit, 58))).toEqual([
      expect.objectContaining({
        code: "INVALID_IMAGE",
        message: "image is not a PNG",
      }),
    ]);
  });

  it("高度上限 PRINT_IMAGE_MAX_HEIGHT_DOTS:剛好可以、超過一點 → INVALID_IMAGE", () => {
    expect(
      decodePrintImage(pngBase64(384, PRINT_IMAGE_MAX_HEIGHT_DOTS), 58).length,
    ).toBeGreaterThan(0);
    expect(
      fieldErrorsOf(() =>
        decodePrintImage(pngBase64(384, PRINT_IMAGE_MAX_HEIGHT_DOTS + 1), 58),
      ),
    ).toEqual([
      expect.objectContaining({
        fieldKey: "image",
        code: "INVALID_IMAGE",
        message: expect.stringContaining("height"),
      }),
    ]);
  });
});
