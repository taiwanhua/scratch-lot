import { describe, expect, it } from "@jest/globals";

import { SHARED_FIELD_CATEGORY_KEYS } from "@repo/domain/project/reason-note";
import { MAKEUP_PUNCH_FIELD_KEYS } from "@repo/domain/project/schedule-settings";

import { assembleSeedRegistry } from "../registry";
import { projectSeedSource } from "./registry";
import { seed as makeupPunchForm } from "./revisions/makeup_punch.r4.seed";
import { projectSeedSettings } from "./settings";

const fieldOf = (key: string) =>
  makeupPunchForm.definition.fields.find((field) => field.key === key);

/** 補打卡申請的受管表單(規格 14.8;正本 `docs/modules/project/schedule.md`「出勤紀錄與補打卡」)。 */
describe("受管表單 補打卡申請(makeup_punch r4)", () => {
  it("登記進專案來源,與底座一起組裝不衝突(定義檢查與可攜性檢查都過)", () => {
    expect(projectSeedSource.seeds).toContain(makeupPunchForm);
    expect(() =>
      assembleSeedRegistry(projectSeedSettings, projectSeedSource),
    ).not.toThrow();
  });

  it("沒有草稿、單號 M-0001、作廢原因 = 刮刮樂與排班共用的「作廢原因」", () => {
    expect(makeupPunchForm).toMatchObject({
      key: "makeup_punch",
      moduleKey: "schedule.attendance",
      allowDraft: false,
      voidReasonCategoryKey: SHARED_FIELD_CATEGORY_KEYS.voidReason,
      // 依欄位共用:分店欄指到的分店也看得到(唯讀)
      sharedByFieldKeys: ["branch"],
      serial: { prefix: "M", period: "none", digits: 4 },
    });
  });

  it("存排班 id 的「對應排班」唯讀時不顯示(詳情 / 申請中心只看對應排班的文字)", () => {
    expect(fieldOf(MAKEUP_PUNCH_FIELD_KEYS.entry)?.widget).toMatchObject({
      hideWhenReadonly: true,
    });
    expect(fieldOf(MAKEUP_PUNCH_FIELD_KEYS.entryLabel)).toMatchObject({
      label: "對應排班",
    });
    expect(
      fieldOf(MAKEUP_PUNCH_FIELD_KEYS.entryLabel)?.widget,
    ).not.toHaveProperty("hideWhenReadonly");
  });

  it("補打卡時間是一個日期時間欄(存打卡的時點);沒有日期與 HH:mm 文字欄", () => {
    expect(fieldOf(MAKEUP_PUNCH_FIELD_KEYS.punchAt)).toMatchObject({
      type: "datetime",
      widget: { kind: "dateTimePicker" },
      rules: { required: true },
    });
    expect(fieldOf("date")).toBeUndefined();
    expect(fieldOf("time")).toBeUndefined();
    expect(makeupPunchForm.definition.summaryMap.date).toBe(
      MAKEUP_PUNCH_FIELD_KEYS.punchAt,
    );
  });
});
