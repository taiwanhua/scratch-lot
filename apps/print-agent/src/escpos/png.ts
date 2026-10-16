import { PNG } from "pngjs";

import type { MonoBitmap } from "./commands";

/**
 * PNG → 單色點陣。用純 JavaScript 的 `pngjs`(不含原生模組,打包單一執行檔才簡單;底座規格第 6 章)。
 * 瀏覽器已轉成黑白,這裡只做保險的門檻判斷:透明當白底,亮度 < 128 為黑點。
 */
export class PrintImageError extends Error {
  override readonly name = "PrintImageError";
}

/** 亮度門檻(0–255):低於它算黑點。 */
export const BLACK_THRESHOLD = 128;

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA,每像素 4 bytes。 */
  rgba: Uint8Array;
}

export function decodePng(buffer: Uint8Array): RgbaImage {
  let png: PNG;
  try {
    png = PNG.sync.read(
      Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    );
  } catch (error) {
    throw new PrintImageError(
      `圖片不是可讀的 PNG:${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    width: png.width,
    height: png.height,
    rgba: new Uint8Array(
      png.data.buffer,
      png.data.byteOffset,
      png.data.byteLength,
    ),
  };
}

/** 透明部分疊在白底上的亮度(ITU-R BT.601)。 */
function luminanceOnWhite(r: number, g: number, b: number, a: number): number {
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return (luminance * a + 255 * (255 - a)) / 255;
}

/** 轉單色點陣;寬度超過紙寬點數直接拒絕(不裁切,避免少印內容)。 */
export function toMonoBitmap(image: RgbaImage, maxWidth: number): MonoBitmap {
  if (image.width > maxWidth) {
    throw new PrintImageError(
      `圖片寬 ${String(image.width)} 點,超過紙寬 ${String(maxWidth)} 點`,
    );
  }
  const bytesPerRow = Math.ceil(image.width / 8);
  const data = new Uint8Array(bytesPerRow * image.height);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const value = luminanceOnWhite(
        image.rgba[offset] ?? 255,
        image.rgba[offset + 1] ?? 255,
        image.rgba[offset + 2] ?? 255,
        image.rgba[offset + 3] ?? 0,
      );
      if (value < BLACK_THRESHOLD) {
        const index = y * bytesPerRow + (x >> 3);
        data[index] = (data[index] ?? 0) | (0x80 >> (x & 7));
      }
    }
  }
  return { width: image.width, height: image.height, bytesPerRow, data };
}

/** 單色點陣 → PNG(模擬印表機存檔、測試用):黑點黑、其他白。 */
export function encodeMonoPng(bitmap: MonoBitmap): Uint8Array {
  const png = new PNG({
    width: Math.max(bitmap.width, 1),
    height: Math.max(bitmap.height, 1),
  });
  png.data.fill(255);
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const byte = bitmap.data[y * bitmap.bytesPerRow + (x >> 3)] ?? 0;
      if ((byte & (0x80 >> (x & 7))) !== 0) {
        const offset = (y * png.width + x) * 4;
        png.data[offset] = 0;
        png.data[offset + 1] = 0;
        png.data[offset + 2] = 0;
      }
    }
  }
  return new Uint8Array(PNG.sync.write(png));
}
