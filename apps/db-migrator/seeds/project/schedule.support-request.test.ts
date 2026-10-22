import { describe, expect, it } from "@jest/globals";

import { definitionSeedShapeIssues } from "@repo/domain/seed";

import { assembleSeedRegistry } from "../registry";
import { projectSeedSource } from "./registry";
import { seed as supportRequestForm } from "./revisions/support_request.r3.seed";
import { projectSeedSettings } from "./settings";

/** 支援需求單的受管表單(規格 14.10;正本 `docs/modules/project/schedule.md`)。 */
describe("受管表單 支援需求單(support_request r3)", () => {
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
});
