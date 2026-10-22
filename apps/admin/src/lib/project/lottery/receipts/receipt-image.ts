import { renderReceiptToPng } from "@repo/ui/receipt58";

/**
 * 畫面上的單據節點(`ReceiptDocument`)→ 384 點黑白 PNG(底座 `renderReceiptToPng`)。
 * 獨立成一支,元件測試以 `jest.unstable_mockModule` 換掉(jsdom 不會畫 canvas;先例 `test-page-image.ts`)。
 */
export const receiptPngOf = (node: HTMLElement): Promise<Blob> =>
  renderReceiptToPng(node);
