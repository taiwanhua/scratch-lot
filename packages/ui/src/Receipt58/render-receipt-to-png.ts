import {
  DEFAULT_THRESHOLD,
  type MonochromeImage,
  type RgbaImage,
  encodeMonochromePng,
  resizeToWidth,
  toMonochrome,
} from "./monochrome-png";
import { RECEIPT58_DOTS, RECEIPT58_QR_QUIET_ZONE } from "./receipt58-tokens";
import { qrModules } from "./symbol-modules";

/** 把畫面上的節點畫成 RGBA 點陣;預設用 `modern-screenshot`,測試可注入替身。 */
export type ReceiptRasterizer = (node: HTMLElement) => Promise<RgbaImage>;

export interface RenderReceiptToPngOptions {
  /** 換掉預設的點陣化(測試用;或日後改用別的轉圖方式)。 */
  rasterize?: ReceiptRasterizer;
  /** 二值化門檻(0–255);預設 128。 */
  threshold?: number;
}

/**
 * 截圖的尺寸:以版面寬高(`offsetWidth` / `offsetHeight`,不受祖先 transform 與螢幕縮放影響)
 * 明確指定給 `modern-screenshot`,canvas 寬 = 版面寬 × scale = 恰好 384 點。
 * 不指定時套件改用 `getBoundingClientRect()`:預覽被縮小顯示時寬度不是 384,之後的縮放會讓模組粗細不均。
 */
export const screenshotSizeOf = (
  node: HTMLElement,
): { width: number; height: number; scale: number } => {
  const width = node.offsetWidth || RECEIPT58_DOTS;
  const height = node.offsetHeight || 1;
  return { width, height, scale: RECEIPT58_DOTS / width };
};

/**
 * 預設點陣化:把節點(`Receipt58`,寬 384 CSS px)畫到寬 384 點的 canvas。
 * 套件在第一次列印時才載入,不進後台的首屏 bundle。
 */
const rasterizeWithCanvas: ReceiptRasterizer = async (node) => {
  const { domToCanvas } = await import("modern-screenshot");
  const canvas = await domToCanvas(node, {
    ...screenshotSizeOf(node),
    // 底色不是品牌色:熱感紙的白,轉圖時把透明處補白
    backgroundColor: "white",
  });
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("renderReceiptToPng: canvas 2d context unavailable");
  }
  return context.getImageData(0, 0, canvas.width, canvas.height);
};

/** 把 QR 模組矩陣(含安靜區)以每模組 `unit` 點寫進點陣的 (left, top);超出點陣的部分略過。 */
const paintQr = (
  image: MonochromeImage,
  matrix: readonly (readonly boolean[])[],
  unit: number,
  { left, top }: { left: number; top: number },
): void => {
  const side = (matrix.length + RECEIPT58_QR_QUIET_ZONE * 2) * unit;
  const fromY = Math.max(0, top);
  const toY = Math.min(image.height, top + side);
  const fromX = Math.max(0, left);
  const toX = Math.min(image.width, left + side);
  for (let row = fromY; row < toY; row += 1) {
    const cells =
      matrix[Math.floor((row - top) / unit) - RECEIPT58_QR_QUIET_ZONE];
    for (let column = fromX; column < toX; column += 1) {
      const isDark =
        cells?.[Math.floor((column - left) / unit) - RECEIPT58_QR_QUIET_ZONE] ??
        false;
      image.dots[row * image.width + column] = isDark ? 1 : 0;
    }
  }
};

/**
 * 把節點裡的 QR code(`Receipt58Qr` 的 `data-receipt58-qr`)以模組矩陣直接寫進黑白點陣:
 * 每模組恰好 `data-module-dots` 點、含安靜區先整塊清白,不經截圖與縮放 ——
 * 截圖在 QR 位置的灰邊、半點偏移一律被蓋掉。位置以畫面上的相對位置換算成點(四捨五入到整數點)。
 * 節點或 QR 沒有排版(寬 0,例:jsdom、display: none)時不動。
 */
const stampQrSymbols = (node: HTMLElement, image: MonochromeImage): void => {
  const box = node.getBoundingClientRect();
  if (box.width <= 0) return;
  const dotsPerPx = image.width / box.width;
  for (const symbol of node.querySelectorAll<SVGSVGElement>(
    "svg[data-receipt58-qr]",
  )) {
    const value = symbol.dataset.receipt58Qr ?? "";
    const unit = Number(symbol.dataset.moduleDots);
    if (value === "" || !Number.isInteger(unit) || unit < 1) continue;
    const rect = symbol.getBoundingClientRect();
    // 沒有排版的 QR(例:被 display: none 藏起來)位置全是 0,寫進去會落在錯的地方
    if (rect.width <= 0) continue;
    paintQr(image, qrModules(value), unit, {
      left: Math.round((rect.left - box.left) * dotsPerPx),
      top: Math.round((rect.top - box.top) * dotsPerPx),
    });
  }
};

/**
 * 把 58mm 單據轉成寬 384 點的黑白 PNG(瀏覽器端):
 * 預覽中的 `Receipt58` 節點 → 點陣化(384 寬)→ 寬度不符時縮放 → 二值化 → QR code 以整數點覆寫 → 1-bit PNG。
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
  const monochrome = toMonochrome(rgba, threshold);
  stampQrSymbols(node, monochrome);
  const png = await encodeMonochromePng(monochrome);
  return new Blob([png], { type: "image/png" });
};
