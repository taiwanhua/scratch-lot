import { renderReceiptToPng } from "@repo/ui/receipt58";

/** base64 分段轉換的大小(避免 `String.fromCharCode(...大陣列)` 超過引數上限)。 */
const CHUNK = 0x80_00;

const base64Of = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += CHUNK) {
    binary += String.fromCodePoint(...bytes.subarray(start, start + CHUNK));
  }
  return btoa(binary);
};

/**
 * 測試頁(畫面上的 `PrinterTestPage` 節點)→ 384 點黑白 PNG 的 base64,交給 `printPrinterTestPage`。
 * 獨立成一支,元件測試以 `jest.unstable_mockModule` 換掉(jsdom 不會畫 canvas;先例 `regex-safety-loader`)。
 */
export const testPageImageOf = async (node: HTMLElement): Promise<string> =>
  base64Of(await renderReceiptToPng(node));
