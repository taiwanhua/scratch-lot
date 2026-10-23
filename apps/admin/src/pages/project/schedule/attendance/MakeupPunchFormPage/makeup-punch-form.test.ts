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
  // 選的那一班是台北 11/3 的班(日期 = 11/3 00:00)
  const NOV3 = "2026-11-02T16:00:00.000Z";

  it("改分店 → 對應排班清空;改補打卡時間:選的班還在前後一天範圍內保留,不在才清空", () => {
    expect(
      withPunchAtOrOrg(filled, { orgId: "org-2" }, TZ, NOV3),
    ).toMatchObject({ entry: "", entryLabel: "" });
    // 台北 11/3 23:59:同一天只改時刻 → 保留
    expect(
      withPunchAtOrOrg(
        filled,
        { punchAt: "2026-11-03T15:59:00.000Z" },
        TZ,
        NOV3,
      ).entry,
    ).toBe("entry-1");
    // 台北 11/4 08:31:11/3 的班還在 11/3–11/5 → 保留(例:跨午夜的班改選隔天的時間)
    expect(
      withPunchAtOrOrg(
        filled,
        { punchAt: "2026-11-04T00:31:00.000Z" },
        TZ,
        NOV3,
      ),
    ).toMatchObject({ entry: "entry-1", entryLabel: "早 08:30–14:30" });
    // 台北 11/2 08:31:11/3 的班在 11/1–11/3 → 保留
    expect(
      withPunchAtOrOrg(
        filled,
        { punchAt: "2026-11-02T00:31:00.000Z" },
        TZ,
        NOV3,
      ).entry,
    ).toBe("entry-1");
    // 台北 11/5 08:31:範圍 11/4–11/6,不含 11/3 → 清空
    expect(
      withPunchAtOrOrg(
        filled,
        { punchAt: "2026-11-05T00:31:00.000Z" },
        TZ,
        NOV3,
      ),
    ).toMatchObject({ entry: "", entryLabel: "" });
  });

  it("「沒有排班(臨時代班)」永遠在下拉裡 → 改補打卡時間也保留", () => {
    const none = { ...filled, entry: "none", entryLabel: "沒有排班(臨時代班)" };
    expect(
      withPunchAtOrOrg(none, { punchAt: "2026-11-20T00:31:00.000Z" }, TZ).entry,
    ).toBe("none");
  });

  it("不知道選的班的日期(下拉還沒載到)→ 保守:同一天保留、換了一天清空", () => {
    expect(
      withPunchAtOrOrg(filled, { punchAt: "2026-11-03T15:59:00.000Z" }, TZ)
        .entry,
    ).toBe("entry-1");
    expect(
      withPunchAtOrOrg(filled, { punchAt: "2026-11-04T00:31:00.000Z" }, TZ)
        .entry,
    ).toBe("");
  });

  it("前後一天照租戶時區判斷(洛杉磯)", () => {
    // 那一班的日期是洛杉磯 11/3 00:00(08:00Z)
    const laNov3 = "2026-11-03T08:00:00.000Z";
    // 2026-11-05T07:59Z = 洛杉磯 11/4 23:59 → 範圍 11/3–11/5,保留(照台北算是 11/5,會清空)
    expect(
      withPunchAtOrOrg(
        filled,
        { punchAt: "2026-11-05T07:59:00.000Z" },
        LA,
        laNov3,
      ).entry,
    ).toBe("entry-1");
    // 2026-11-05T08:00Z = 洛杉磯 11/5 00:00 → 範圍 11/4–11/6,清空
    expect(
      withPunchAtOrOrg(
        filled,
        { punchAt: "2026-11-05T08:00:00.000Z" },
        LA,
        laNov3,
      ).entry,
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
