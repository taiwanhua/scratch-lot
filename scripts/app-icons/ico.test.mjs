import assert from "node:assert/strict";
import { test } from "node:test";

import { packIco } from "./ico.mjs";

const fakePng = (length, fill) => Buffer.alloc(length, fill);

test("標頭與目錄:張數、尺寸、長度與位移對得上內嵌的 PNG", () => {
  const small = fakePng(10, 1);
  const large = fakePng(20, 2);
  const ico = packIco([
    { size: 16, png: small },
    { size: 256, png: large },
  ]);

  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 2);

  const firstOffset = 6 + 16 * 2;
  assert.equal(ico.readUInt8(6), 16);
  assert.equal(ico.readUInt32LE(6 + 8), 10);
  assert.equal(ico.readUInt32LE(6 + 12), firstOffset);
  // 256 以 0 表示
  assert.equal(ico.readUInt8(22), 0);
  assert.equal(ico.readUInt32LE(22 + 8), 20);
  assert.equal(ico.readUInt32LE(22 + 12), firstOffset + 10);

  assert.deepEqual(ico.subarray(firstOffset, firstOffset + 10), small);
  assert.deepEqual(ico.subarray(firstOffset + 10), large);
});

test("沒有圖或尺寸超出範圍 → 失敗", () => {
  assert.throws(() => packIco([]), /至少要一張圖/);
  assert.throws(() => packIco([{ size: 512, png: fakePng(1, 0) }]), /尺寸/);
});
