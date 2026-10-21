import { describe, expect, it } from "@jest/globals";

import {
  EMPTY_MAKEUP_PUNCH,
  invalidFieldsOf,
  makeupPunchStateOf,
  makeupPunchStoredValues,
  withDateOrOrg,
} from "./makeup-punch-form";

const TZ = "Asia/Taipei";

const filled = {
  ...EMPTY_MAKEUP_PUNCH,
  date: "2026-11-03",
  orgId: "org-1",
  entry: "entry-1",
  entryLabel: "早 08:30–14:30",
  type: "in" as const,
  time: "08:31",
  reasonKey: "forgot-punch",
  reasonLabel: "忘記打卡",
};

describe("補打卡申請的新增頁(規格 14.8)", () => {
  it("改了日期或分店 → 對應排班清空,重新選;沒改不清", () => {
    expect(withDateOrOrg(filled, { date: "2026-11-04" })).toMatchObject({
      date: "2026-11-04",
      entry: "",
      entryLabel: "",
    });
    expect(withDateOrOrg(filled, { orgId: "org-2" }).entry).toBe("");
    expect(withDateOrOrg(filled, { date: "2026-11-03" }).entry).toBe("entry-1");
  });

  it("沒選對應排班 → 擋下(欄位 entry);時間格式、原因必填;選「其他」說明必填", () => {
    expect(invalidFieldsOf(filled)).toEqual([]);
    expect(invalidFieldsOf({ ...filled, entry: "" })).toEqual(["entry"]);
    expect(invalidFieldsOf({ ...filled, time: "8:31" })).toEqual(["time"]);
    expect(
      invalidFieldsOf({ ...filled, reasonKey: "other", note: " " }),
    ).toEqual(["note"]);
    expect(invalidFieldsOf(EMPTY_MAKEUP_PUNCH)).toEqual([
      "date",
      "orgId",
      "entry",
      "time",
      "reasonKey",
    ]);
  });

  it("存值:日期是那天 00:00 的時點、原因帶名稱;讀回同一份狀態", () => {
    const values = makeupPunchStoredValues(filled, TZ);
    expect(values).toMatchObject({
      date: "2026-11-02T16:00:00.000Z",
      branch: "org-1",
      entry: "entry-1",
      punch_type: "in",
      time: "08:31",
      reason: { value: "forgot-punch", label: "忘記打卡" },
      note: null,
    });
    expect(
      makeupPunchStateOf(
        { ...values, branch: { id: "org-1", label: "中山店" } },
        TZ,
      ),
    ).toEqual(filled);
  });

  it("「沒有排班(臨時代班)」存 none、讀回 none", () => {
    const values = makeupPunchStoredValues({ ...filled, entry: "none" }, TZ);
    expect(values.entry).toBe("none");
    expect(makeupPunchStateOf(values, TZ).entry).toBe("none");
  });
});
