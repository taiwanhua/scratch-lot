/**
 * 把幾張 PNG 包成一個 `.ico`(ICO 容器直接內嵌 PNG,現行瀏覽器與 Windows 都支援)。
 * 純函式:輸入 `{ size, png }`,輸出整個檔案的 Buffer;不讀檔、不依賴影像套件,方便單獨測試。
 */
const HEADER_BYTES = 6;
const ENTRY_BYTES = 16;
const MAX_SIZE = 256;

export function packIco(images) {
  if (images.length === 0) {
    throw new Error("packIco 至少要一張圖");
  }
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt16LE(0, 0); // 保留
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = HEADER_BYTES + ENTRY_BYTES * images.length;
  const entries = images.map(({ size, png }) => {
    if (!Number.isInteger(size) || size < 1 || size > MAX_SIZE) {
      throw new Error(`ico 尺寸必須是 1–${MAX_SIZE} 的整數:${size}`);
    }
    const entry = Buffer.alloc(ENTRY_BYTES);
    // 寬高各一個位元組,256 以 0 表示
    entry.writeUInt8(size % MAX_SIZE, 0);
    entry.writeUInt8(size % MAX_SIZE, 1);
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}
