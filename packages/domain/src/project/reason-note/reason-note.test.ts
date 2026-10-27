import { describe, expect, it } from "@jest/globals";

import { REASON_OTHER_VALUE, requiresReasonNote } from "./index";

describe("requiresReasonNote:選「其他」時說明必填(專案規格第 13 章,全系統一致)", () => {
  it("「其他」的選項代碼是 other", () => {
    expect(REASON_OTHER_VALUE).toBe("other");
  });

  it("other → true", () => {
    expect(requiresReasonNote("other")).toBe(true);
  });

  it.each([
    "customer-return",
    "scan-failed",
    "system-backfill",
    "Other",
    " other",
    "",
  ])("%j → false", (value) => {
    expect(requiresReasonNote(value)).toBe(false);
  });

  it("沒有選(null)→ false", () => {
    expect(requiresReasonNote(null)).toBe(false);
  });
});
