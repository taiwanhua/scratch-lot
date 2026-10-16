import {
  DEFAULT_THRESHOLD,
  type RgbaImage,
  encodeMonochromePng,
  resizeToWidth,
  toMonochrome,
} from "./monochrome-png";
import { RECEIPT58_DOTS } from "./receipt58-tokens";

/** 把畫面上的節點畫成 RGBA 點陣;預設用 `modern-screenshot`,測試可注入替身。 */
export type ReceiptRasterizer = (node: HTMLElement) => Promise<RgbaImage>;

export interface RenderReceiptToPngOptions {
  /** 換掉預設的點陣化(測試用;或日後改用別的轉圖方式)。 */
  rasterize?: ReceiptRasterizer;
  /** 二值化門檻(0–255);預設 128。 */
  threshold?: number;
}

/**
 * 預設點陣化:把節點(`Receipt58`,寬 384 CSS px)以 1:1 畫到 canvas。
 * 節點寬度不是 384 時以 `scale` 換算,canvas 寬仍是 384 點。
 * 套件在第一次列印時才載入,不進後台的首屏 bundle。
 */
const rasterizeWithCanvas: ReceiptRasterizer = async (node) => {
  const { domToCanvas } = await import("modern-screenshot");
  // offsetWidth 是版面寬(不受祖先 transform 縮放影響),預覽被縮小顯示時仍以實際 384 計算
  const cssWidth = node.offsetWidth || RECEIPT58_DOTS;
  const canvas = await domToCanvas(node, {
    scale: RECEIPT58_DOTS / cssWidth,
    // 底色不是品牌色:熱感紙的白,轉圖時把透明處補白
    backgroundColor: "white",
  });
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("renderReceiptToPng: canvas 2d context unavailable");
  }
  return context.getImageData(0, 0, canvas.width, canvas.height);
};

/**
 * 把 58mm 單據轉成寬 384 點的黑白 PNG(瀏覽器端;規格第 6 章「架構」):
 * 預覽中的 `Receipt58` 節點 → 點陣化 → 縮放到 384 寬 → 二值化 → 1-bit PNG。
 * 回傳的 Blob 直接作為列印工作的圖片上傳。
 */
export const renderReceiptToPng = async (
  node: HTMLElement,
  {
    rasterize = rasterizeWithCanvas,
    threshold = DEFAULT_THRESHOLD,
  }: RenderReceiptToPngOptions = {},
): Promise<Blob> => {
  const rgba = resizeToWidth(await rasterize(node), RECEIPT58_DOTS);
  const png = await encodeMonochromePng(toMonochrome(rgba, threshold));
  return new Blob([png], { type: "image/png" });
};
