import JsBarcode from "jsbarcode";
import { create as createQr } from "qrcode";

/**
 * 一維條碼與 QR code 的「模組」計算(純函式,不碰 DOM):元件拿結果畫成 SVG 的黑色方塊。
 * 自己畫而不用套件的 DOM / canvas 輸出,是為了讓每個模組對齊整數點 —— 轉成 384 點黑白圖時不會糊成灰邊。
 */

/** Code128 的條紋:每個字元 `1` = 黑、`0` = 白,一個字元一個模組寬。 */
export const code128Modules = (value: string): string => {
  // JsBarcode 收到普通物件時走 ObjectRenderer:不畫圖,只把編碼結果寫回 `encodings`
  const target: { encodings?: { data: string }[] } = {};
  JsBarcode(target, value, { format: "CODE128", displayValue: false });
  return (target.encodings ?? []).map((encoding) => encoding.data).join("");
};

/** QR code 的模組矩陣:`size × size`,`true` = 黑。容錯等級 M(套件預設)。 */
export const qrModules = (value: string): boolean[][] => {
  const { modules } = createQr(value, { errorCorrectionLevel: "M" });
  return Array.from({ length: modules.size }, (_, row) =>
    Array.from({ length: modules.size }, (__, col) =>
      Boolean(modules.get(row, col)),
    ),
  );
};

/** 在 `maxDots` 點內放得下的最大整數模組寬(至少 1)。 */
export const moduleDots = (moduleCount: number, maxDots: number): number =>
  Math.max(1, Math.floor(maxDots / Math.max(1, moduleCount)));
