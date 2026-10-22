import { describe, expect, it } from "@jest/globals";

import { purchaseTone } from "./dealer-labels";

describe("purchaseTone(距批購 N 天的標籤色)", () => {
  it("無紀錄 = 一般色(規格 5.2:不加警告色,側欄數字也不算)", () => {
    expect(purchaseTone(null)).toBe("grey");
  });

  it("150 天以內一般色、超過 150 天警告、超過 180 天錯誤", () => {
    expect(purchaseTone(150)).toBe("grey");
    expect(purchaseTone(151)).toBe("warning");
    expect(purchaseTone(180)).toBe("warning");
    expect(purchaseTone(181)).toBe("error");
  });
});
