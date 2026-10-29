import {
  PRINT_IMAGE_MAX_BYTES,
  PRINT_IMAGE_MAX_HEIGHT_DOTS,
  readPngDimensions,
} from "@repo/domain/printing";

/** base64 解回的位元組數(去掉結尾的 `=` 補位)。 */
const base64ByteLength = (base64: string): number => {
  let padding = 0;
  while (padding < 2 && base64.at(-1 - padding) === "=") {
    padding += 1;
  }
  return Math.floor((base64.length * 3) / 4) - padding;
};

/**
 * 這張列印影像(base64 PNG)會不會被 api 擋下:高度超過 `PRINT_IMAGE_MAX_HEIGHT_DOTS` 或大小超過
 * `PRINT_IMAGE_MAX_BYTES`(和 api 收圖、代理程式開印前同一組上限;`docs/modules/printers.md`「列印工作」)。
 * 多聯的單據接成一張圖,上限算各聯加總,明細很長時可能超過。讀不出 IHDR 的不算(交給 api 判斷)。
 */
export const isPrintImageTooLarge = (base64: string): boolean => {
  if (base64ByteLength(base64) > PRINT_IMAGE_MAX_BYTES) {
    return true;
  }
  // IHDR 在前 24 bytes(32 個 base64 字元)
  let head: Uint8Array;
  try {
    head = Uint8Array.from(
      atob(base64.slice(0, 32)),
      (char) => char.codePointAt(0) ?? 0,
    );
  } catch {
    return false;
  }
  const size = readPngDimensions(head);
  return size !== null && size.height > PRINT_IMAGE_MAX_HEIGHT_DOTS;
};
