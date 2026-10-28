import { describe, expect, it } from "@jest/globals";

import {
  UPGRADE_BATCH_BYTES,
  UPGRADE_BATCH_SIZE,
  upgradeBatchLength,
} from "./form-upgrade.service";

const sized = (...sizes: number[]) => sizes.map((size) => ({ size }));

describe("upgradeBatchLength(每批同時限筆數與總大小)", () => {
  it("都很小:收滿筆數上限就切", () => {
    const candidates = sized(...Array.from({ length: 50 }, () => 1024));
    expect(upgradeBatchLength(candidates)).toBe(UPGRADE_BATCH_SIZE);
  });

  it("不滿筆數也不超過大小:全收", () => {
    expect(upgradeBatchLength(sized(10, 20, 30), 50, 100)).toBe(3);
  });

  it("大小先到:再加一筆會超過就提早切(剛好等於上限仍收)", () => {
    expect(upgradeBatchLength(sized(40, 40, 20, 1), 50, 100)).toBe(3);
    expect(upgradeBatchLength(sized(40, 40, 30), 50, 100)).toBe(2);
  });

  it("單筆就超過上限:自成一批,不卡住", () => {
    expect(upgradeBatchLength(sized(150, 10), 50, 100)).toBe(1);
    expect(upgradeBatchLength(sized(10, 150), 50, 100)).toBe(1);
  });

  it("預設上限:32MB 內的大文件提早切批", () => {
    const eightMb = 8 * 1024 * 1024;
    expect(UPGRADE_BATCH_BYTES).toBe(32 * 1024 * 1024);
    expect(
      upgradeBatchLength(sized(eightMb, eightMb, eightMb, eightMb, 1)),
    ).toBe(4);
  });

  it("大小不是正數(讀不出來)直接丟錯,不當 0 吞掉", () => {
    for (const size of [Number.NaN, 0, -1, null as unknown as number]) {
      expect(() => upgradeBatchLength(sized(10, size), 50, 100)).toThrow(
        "文件大小不合法",
      );
    }
  });

  it("沒有候選:0", () => {
    expect(upgradeBatchLength([])).toBe(0);
  });
});
