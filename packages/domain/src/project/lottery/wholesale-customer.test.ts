import { describe, expect, it } from "@jest/globals";

import { wholesaleCustomerLabel } from "./wholesale-customer";

describe("批售客戶的顯示文字(規格 21.2)", () => {
  it.each([
    ["0223456789", "好運彩券行 · 0223456789"],
    [null, "好運彩券行"],
  ])("電話 %s → %s", (phone, expected) => {
    expect(wholesaleCustomerLabel({ storeName: "好運彩券行", phone })).toBe(
      expected,
    );
  });
});
