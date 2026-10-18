"use client";

/** `@repo/ui/receipt58` 的出口:58mm 單據的版面零件、測試頁與轉 384 點黑白 PNG(列印流程見 `docs/modules/printers.md`)。 */
export * from "./Receipt58/Receipt58";
export * from "./Receipt58/Receipt58Header";
export * from "./Receipt58/Receipt58Row";
export * from "./Receipt58/Receipt58Table";
export * from "./Receipt58/Receipt58TableRow";
export * from "./Receipt58/Receipt58Range";
export * from "./Receipt58/Receipt58Divider";
export * from "./Receipt58/Receipt58Total";
export * from "./Receipt58/Receipt58Signature";
export * from "./Receipt58/Receipt58Qr";
export * from "./Receipt58/Receipt58ReprintMark";
export * from "./Receipt58/Receipt58Text";
export * from "./Receipt58/Receipt58Barcode";
export * from "./Receipt58/Receipt58Cut";
export * from "./Receipt58/PrinterTestPage";
export {
  formatNumberRanges,
  type NumberRangeFormat,
} from "./Receipt58/number-range";
export type { RgbaImage } from "./Receipt58/monochrome-png";
export {
  renderReceiptToPng,
  type ReceiptRasterizer,
  type RenderReceiptToPngOptions,
} from "./Receipt58/render-receipt-to-png";
export { RECEIPT58_DOTS } from "./Receipt58/receipt58-tokens";
