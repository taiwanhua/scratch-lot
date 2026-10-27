import { inflateSync } from "node:zlib";

/** 測試用:讀回 1-bit 灰階 PNG 的表頭與點陣(只支援本套件產出的格式:filter 0)。 */
export interface DecodedPng {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  /** 每點的灰階值(1-bit:0 = 黑、1 = 白)。 */
  pixels: number[];
  /** `tEXt` 區塊:keyword → 文字。 */
  texts: Record<string, string>;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

export const decodePng = (bytes: Uint8Array): DecodedPng => {
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new Error("not a PNG");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];
  const texts: Record<string, string> = {};
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCodePoint(
      ...bytes.subarray(offset + 4, offset + 8),
    );
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
    }
    if (type === "IDAT") idat.push(data);
    if (type === "tEXt") {
      const [keyword = "", text = ""] = String.fromCodePoint(...data).split(
        "\0",
      );
      texts[keyword] = text;
    }
    offset += 12 + length;
  }
  const raw = inflateSync(concat(idat));
  const rowBytes = Math.ceil((width * bitDepth) / 8);
  const pixels: number[] = [];
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (rowBytes + 1);
    if (raw[rowStart] !== 0) throw new Error("unexpected filter");
    for (let x = 0; x < width; x += 1) {
      const byte = raw[rowStart + 1 + (x >> 3)] ?? 0;
      pixels.push((byte >> (7 - (x & 7))) & 1);
    }
  }
  return { width, height, bitDepth, colorType, pixels, texts };
};

type Rgba = readonly [number, number, number, number];

/** 測試用:做一張 RGBA 點陣,每點顏色由 `colorAt` 決定。 */
export const makeRgba = (
  width: number,
  height: number,
  colorAt: (x: number, y: number) => Rgba,
) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(colorAt(x, y), (y * width + x) * 4);
    }
  }
  return { width, height, data };
};

/** jsdom 的 Blob 沒有 `arrayBuffer()`,用 FileReader 讀回位元組。 */
export const readBlob = (blob: Blob): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      resolve(new Uint8Array(reader.result as ArrayBuffer));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("read failed"));
    });
    // eslint-disable-next-line unicorn/prefer-blob-reading-methods -- jsdom 的 Blob 沒有 arrayBuffer()
    reader.readAsArrayBuffer(blob);
  });
