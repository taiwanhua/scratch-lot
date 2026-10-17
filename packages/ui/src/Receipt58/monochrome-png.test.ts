import { describe, expect, it } from "@jest/globals";

import {
  encodeMonochromePng,
  resizeToWidth,
  toMonochrome,
} from "./monochrome-png";
import { decodePng, makeRgba } from "./png-test-support";

type Rgba = readonly [number, number, number, number];

const pick =
  (colors: readonly Rgba[]) =>
  (x: number): Rgba =>
    colors[x] ?? [255, 255, 255, 255];

describe("toMonochrome", () => {
  it("亮度低於門檻印黑、其餘印白;灰階、彩色都只剩兩種值", () => {
    const image = makeRgba(
      4,
      1,
      pick([
        [0, 0, 0, 255],
        [100, 100, 100, 255],
        [200, 200, 200, 255],
        [255, 0, 0, 255],
      ]),
    );

    expect([...toMonochrome(image).dots]).toEqual([1, 1, 0, 1]);
  });

  it("透明處視為白紙,半透明的黑依透明度合成白底後再判斷", () => {
    const image = makeRgba(
      3,
      1,
      pick([
        [0, 0, 0, 0],
        [0, 0, 0, 64],
        [0, 0, 0, 200],
      ]),
    );

    expect([...toMonochrome(image).dots]).toEqual([0, 0, 1]);
  });

  it("門檻可調", () => {
    const image = makeRgba(1, 1, () => [150, 150, 150, 255]);

    expect(toMonochrome(image, 128).dots[0]).toBe(0);
    expect(toMonochrome(image, 200).dots[0]).toBe(1);
  });
});

describe("resizeToWidth", () => {
  it("寬度不同時最近鄰縮放到指定寬,高度等比", () => {
    const image = makeRgba(768, 100, (x) =>
      x < 384 ? [0, 0, 0, 255] : [255, 255, 255, 255],
    );

    const resized = resizeToWidth(image, 384);

    expect(resized.width).toBe(384);
    expect(resized.height).toBe(50);
    expect(resized.data).toHaveLength(384 * 50 * 4);
    // 左半黑、右半白
    expect(resized.data[0]).toBe(0);
    expect(resized.data[383 * 4]).toBe(255);
  });

  it("寬度已是目標寬時原樣回傳", () => {
    const image = makeRgba(384, 2, () => [0, 0, 0, 255]);

    expect(resizeToWidth(image, 384)).toBe(image);
  });
});

describe("encodeMonochromePng", () => {
  it("產出 1-bit 灰階 PNG:格式本身只有黑白兩色,點陣與輸入一致", async () => {
    const width = 384;
    const height = 3;
    const dots = new Uint8Array(width * height);
    for (let x = 0; x < width; x += 1) dots[x] = 1;
    dots[width + 5] = 1;
    dots[2 * width + 383] = 1;

    const png = decodePng(await encodeMonochromePng({ width, height, dots }));

    expect(png.width).toBe(384);
    expect(png.height).toBe(3);
    expect(png.bitDepth).toBe(1);
    expect(png.colorType).toBe(0);
    expect(new Set(png.pixels)).toEqual(new Set([0, 1]));
    // PNG 灰階 0 = 黑:與「要印」的點相反
    expect(png.pixels.map((value) => 1 - value)).toEqual([...dots]);
  });

  it("寬度不是 8 的倍數時,每列尾端補位不影響點陣", async () => {
    const dots = new Uint8Array([1, 0, 1, 0, 1, 0, 1, 0, 1, 1]);

    const png = decodePng(
      await encodeMonochromePng({ width: 10, height: 1, dots }),
    );

    expect(png.pixels.map((value) => 1 - value)).toEqual([...dots]);
  });
});
