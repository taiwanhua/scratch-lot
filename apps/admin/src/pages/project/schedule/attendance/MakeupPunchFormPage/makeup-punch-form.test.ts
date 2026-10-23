import { describe, expect, it } from "@jest/globals";

import {
  EMPTY_MAKEUP_PUNCH,
  invalidFieldsOf,
  makeupPunchStateOf,
  makeupPunchStoredValues,
  withPunchAtOrOrg,
} from "./makeup-punch-form";

const TZ = "Asia/Taipei";
const LA = "America/Los_Angeles";

const filled = {
  ...EMPTY_MAKEUP_PUNCH,
  // 台北 11/3 08:31
  punchAt: "2026-11-03T00:31:00.000Z",
  orgId: "org-1",
  entry: "entry-1",
  entryLabel: "早 08:30–14:30",
  type: "in" as const,
  reasonKey: "forgot-punch",
  reasonLabel: "忘記打卡",
};

describe("補打卡申請的新增頁(規格 14.8)", () => {
  it("改了補打卡時間的日期或分店 → 對應排班清空,重新選;同一天只改時刻不清", () => {
    // 台北 11/4 08:31
    expect(
      withPunchAtOrOrg(filled, { punchAt: "2026-11-04T00:31:00.000Z" }, TZ),
    ).toMatchObject({ entry: "", entryLabel: "" });
    expect(withPunchAtOrOrg(filled, { orgId: "org-2" }, TZ).entry).toBe("");
    // 台北 11/3 23:59:同一天
    expect(
      withPunchAtOrOrg(filled, { punchAt: "2026-11-03T15:59:00.000Z" }, TZ)
        .entry,
    ).toBe("entry-1");
  });

  it("「同一天」照租戶時區判斷(洛杉磯)", () => {
    // 台北 11/3 08:31 與 11/3 23:59 在洛杉磯是 11/2 與 11/3 → 換了一天
    expect(
      withPunchAtOrOrg(filled, { punchAt: "2026-11-03T15:59:00.000Z" }, LA)
        .entry,
    ).toBe("");
  });

  it("沒選對應排班 → 擋下(欄位 entry);補打卡時間、原因必填;選「其他」說明必填", () => {
    expect(invalidFieldsOf(filled)).toEqual([]);
    expect(invalidFieldsOf({ ...filled, entry: "" })).toEqual(["entry"]);
    expect(invalidFieldsOf({ ...filled, punchAt: "x" })).toEqual(["punchAt"]);
    expect(
      invalidFieldsOf({ ...filled, reasonKey: "other", note: " " }),
    ).toEqual(["note"]);
    expect(invalidFieldsOf(EMPTY_MAKEUP_PUNCH)).toEqual([
      "punchAt",
      "orgId",
      "entry",
      "reasonKey",
    ]);
  });

  it("存值:補打卡時間就是那個時點、原因帶名稱;讀回同一份狀態", () => {
    const values = makeupPunchStoredValues(filled);
    expect(values).toEqual({
      punch_at: "2026-11-03T00:31:00.000Z",
      branch: "org-1",
      entry: "entry-1",
      entry_label: "早 08:30–14:30",
      punch_type: "in",
      reason: { value: "forgot-punch", label: "忘記打卡" },
      note: null,
    });
    expect(
      makeupPunchStateOf({
        ...values,
        branch: { id: "org-1", label: "中山店" },
      }),
    ).toEqual(filled);
  });

  it("「沒有排班(臨時代班)」存 none、讀回 none", () => {
    const values = makeupPunchStoredValues({ ...filled, entry: "none" });
    expect(values.entry).toBe("none");
    expect(makeupPunchStateOf(values).entry).toBe("none");
  });
});
