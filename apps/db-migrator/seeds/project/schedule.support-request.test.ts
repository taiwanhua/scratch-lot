import { describe, expect, it } from "@jest/globals";

import { type Expression, evaluateCondition } from "@repo/domain/form";
import { definitionSeedShapeIssues } from "@repo/domain/seed";

import { assembleSeedRegistry } from "../registry";
import { projectSeedSource } from "./registry";
import { seed as supportRequestForm } from "./revisions/support_request.r4.seed";
import { projectSeedSettings } from "./settings";

const fieldOf = (key: string) =>
  supportRequestForm.definition.fields.find((field) => field.key === key);

/** 支援需求單的受管表單(規格 14.10;正本 `docs/modules/project/schedule.md`)。 */
describe("受管表單 支援需求單(support_request r4)", () => {
  it("登記進專案來源,與底座一起組裝不衝突(定義檢查與可攜性檢查都過)", () => {
    expect(projectSeedSource.seeds).toContain(supportRequestForm);
    expect(definitionSeedShapeIssues(supportRequestForm)).toEqual([]);
    expect(() =>
      assembleSeedRegistry(projectSeedSettings, projectSeedSource),
    ).not.toThrow();
  });

  it("單號 SP-0001(與盤點確認申請的 ST 分開),不分期間", () => {
    expect(supportRequestForm.serial).toEqual({
      prefix: "SP",
      period: "none",
      digits: 4,
    });
  });

  it("依欄位共用:分店欄指到的分店也看得到(唯讀)", () => {
    expect(supportRequestForm).toMatchObject({
      key: "support_request",
      moduleKey: "schedule.manage",
      sharedByFieldKeys: ["branch"],
    });
  });

  it("開始 / 結束是日期時間欄(存時點);沒有日期與 HH:mm 文字欄", () => {
    expect(fieldOf("start_at")).toMatchObject({
      type: "datetime",
      widget: { kind: "dateTimePicker" },
      rules: { required: true },
    });
    expect(fieldOf("end_at")).toMatchObject({ type: "datetime" });
    for (const key of ["date", "start_time", "end_time"]) {
      expect(fieldOf(key)).toBeUndefined();
    }
    expect(supportRequestForm.definition.summaryMap.date).toBe("start_at");
  });

  describe("結束要晚於開始,而且在同一天(不能跨午夜)", () => {
    // 快照的推論型別是 `and` 兩種形狀的聯集(同 registry 的收窄),這裡當成表達式求值
    const rule = fieldOf("end_at")?.rules.custom as unknown as Expression;
    const passes = (start: string, end: string, timezone = "Asia/Taipei") =>
      evaluateCondition(rule, {
        values: { start_at: start, end_at: end },
        ctx: {
          now: "2026-11-12T00:00:00.000Z",
          timezone,
          user: { id: null, orgId: null, orgIds: [] },
          tenant: { id: null },
        },
      });

    it.each([
      [
        "17:00–21:00",
        "2026-11-12T09:00:00.000Z",
        "2026-11-12T13:00:00.000Z",
        true,
      ],
      [
        "一樣 → 擋",
        "2026-11-12T09:00:00.000Z",
        "2026-11-12T09:00:00.000Z",
        false,
      ],
      [
        "結束早於開始 → 擋",
        "2026-11-12T13:00:00.000Z",
        "2026-11-12T09:00:00.000Z",
        false,
      ],
      [
        "22:00–隔天 00:00 → 擋(跨到隔天)",
        "2026-11-12T14:00:00.000Z",
        "2026-11-12T16:00:00.000Z",
        false,
      ],
      [
        "22:00–隔天 01:00 → 擋",
        "2026-11-12T14:00:00.000Z",
        "2026-11-12T17:00:00.000Z",
        false,
      ],
    ])("台北 %s", (_label, start, end, expected) => {
      expect(passes(start, end)).toBe(expected);
    });

    it("「同一天」照租戶時區算:台北跨午夜的時段在洛杉磯是同一天", () => {
      // 台北 11/12 22:00–11/13 01:00 = 洛杉磯 11/12 06:00–09:00
      const start = "2026-11-12T14:00:00.000Z";
      const end = "2026-11-12T17:00:00.000Z";
      expect(passes(start, end)).toBe(false);
      expect(passes(start, end, "America/Los_Angeles")).toBe(true);
    });
  });
});
