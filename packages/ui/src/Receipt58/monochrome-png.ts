/**
 * 384 點黑白 PNG 的純函式部分(不碰 DOM / canvas,瀏覽器與測試共用):
 * RGBA 點陣 → 縮放到指定寬 → 二值化 → 1-bit 灰階 PNG。
 *
 * 輸出格式:PNG 色彩類型 0(灰階)、位元深度 1 —— 檔案格式本身只能表示黑、白兩色;
 * 代理程式以純 JavaScript 的 PNG 解碼器讀回,再轉 ESC/POS 點陣指令。
 * 壓縮用瀏覽器內建的 `CompressionStream("deflate")`(即 zlib 格式,PNG IDAT 要的就是它),不另加套件。
 */

/** 與 `ImageData` 同形狀的 RGBA 點陣(每點 4 個位元組)。 */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** 二值化後的點陣:每點一個位元組,`1` = 黑(要印)、`0` = 白。 */
export interface MonochromeImage {
  width: number;
  height: number;
  dots: Uint8Array;
}

/** 預設門檻:合成白底後的亮度低於它就印黑。 */
export const DEFAULT_THRESHOLD = 128;

/** 最近鄰縮放到指定寬度(高度等比、四捨五入,至少 1);寬度已相同時原樣回傳。 */
export const resizeToWidth = (image: RgbaImage, width: number): RgbaImage => {
  if (image.width === width) return image;
  const height = Math.max(1, Math.round((image.height * width) / image.width));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(
      image.height - 1,
      Math.floor((y * image.height) / height),
    );
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(
        image.width - 1,
        Math.floor((x * image.width) / width),
      );
      const from = (sourceY * image.width + sourceX) * 4;
      data.set(image.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
};

/** 二值化:先把半透明合成到白底,再以亮度(ITU-R BT.601)與門檻比較。 */
export const toMonochrome = (
  image: RgbaImage,
  threshold = DEFAULT_THRESHOLD,
): MonochromeImage => {
  const dots = new Uint8Array(image.width * image.height);
  for (let index = 0; index < dots.length; index += 1) {
    const offset = index * 4;
    const red = image.data[offset] ?? 0;
    const green = image.data[offset + 1] ?? 0;
    const blue = image.data[offset + 2] ?? 0;
    const alpha = (image.data[offset + 3] ?? 0) / 255;
    const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
    const onWhite = luminance * alpha + 255 * (1 - alpha);
    dots[index] = onWhite < threshold ? 1 : 0;
  }
  return { width: image.width, height: image.height, dots };
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xff_ff_ff_ff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const body = new Uint8Array(4 + data.length);
  for (let index = 0; index < 4; index += 1) {
    body[index] = type.codePointAt(index) ?? 0;
  }
  body.set(data, 4);
  const out = new Uint8Array(8 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc32(body));
  return out;
};

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const concatBytes = (parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/** zlib 格式壓縮(PNG IDAT 的內容)。 */
const zlibDeflate = async (
  raw: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array> => {
  const compression = new CompressionStream("deflate");
  const writer = compression.writable.getWriter();
  // 寫入與讀出同時進行(資料大於串流緩衝時,先等寫完會互等);任一邊失敗都由 Promise.all 拋出
  const writing = (async () => {
    await writer.write(raw);
    await writer.close();
  })();
  const reading = (async () => {
    const reader = compression.readable.getReader();
    const parts: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return parts;
      parts.push(value);
    }
  })();
  const [, parts] = await Promise.all([writing, reading]);
  return concatBytes(parts);
};

/**
 * 中段切紙位置的 `tEXt` keyword:與 `@repo/domain/printing` 的 `PRINT_IMAGE_CUT_ROWS_KEYWORD` 同值
 * (本套件不依賴 domain;代理程式以那一份讀)。
 */
export const RECEIPT58_CUT_ROWS_KEYWORD = "cut-rows";

/** `tEXt` 區塊:keyword + NUL + 文字(只用 ASCII)。 */
const textChunk = (keyword: string, text: string): Uint8Array =>
  chunk(
    "tEXt",
    Uint8Array.from(`${keyword}\0${text}`, (char) => char.codePointAt(0) ?? 0),
  );

export interface EncodeMonochromePngOptions {
  /**
   * 中段切紙位置(列號;`0 < 列 < 高度`):寫進 `tEXt`「cut-rows」,代理程式印到那一列就切紙。
   * 沒給或空陣列 → 不寫(只在最後切紙)。
   */
  cutRows?: readonly number[];
}

/** 編成 1-bit 灰階 PNG:灰階值 0 = 黑、1 = 白(每列一個 filter 位元組 + 位元打包)。 */
export const encodeMonochromePng = async (
  { width, height, dots }: MonochromeImage,
  { cutRows = [] }: EncodeMonochromePngOptions = {},
): Promise<Uint8Array<ArrayBuffer>> => {
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 1; // 位元深度
  header[9] = 0; // 色彩類型:灰階
  // 10–12:壓縮、濾波、交錯皆 0

  const rowBytes = Math.ceil(width / 8);
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (rowBytes + 1); // 第一個位元組是 filter 0(None)
    for (let x = 0; x < width; x += 1) {
      const isWhite = dots[y * width + x] === 0;
      if (isWhite) {
        const at = rowStart + 1 + (x >> 3);
        raw[at] = (raw[at] ?? 0) | (0x80 >> (x & 7));
      }
    }
  }

  return concatBytes([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    ...(cutRows.length === 0
      ? []
      : [textChunk(RECEIPT58_CUT_ROWS_KEYWORD, cutRows.join(","))]),
    chunk("IDAT", await zlibDeflate(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
};
