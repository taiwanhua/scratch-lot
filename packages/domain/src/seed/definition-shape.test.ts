import { describe, expect, it } from "@jest/globals";

import { field } from "../form/form-test-support";
import { definitionSeedShapeIssues } from "./definition-shape";
import { formSeed } from "./seed-test-support";

describe("表單定義宣告的形狀:allowDraft", () => {
  it("缺席、true、false 都合格(缺席 = 允許存草稿)", () => {
    const fields = [field("title", "text")];
    expect(definitionSeedShapeIssues(formSeed(fields))).toEqual([]);
    expect(
      definitionSeedShapeIssues(formSeed(fields, { allowDraft: false })),
    ).toEqual([]);
    expect(
      definitionSeedShapeIssues(formSeed(fields, { allowDraft: true })),
    ).toEqual([]);
  });

  it("不是布林 → 指到 allowDraft", () => {
    const seed = {
      ...formSeed([field("title", "text")]),
      allowDraft: "no",
    } as unknown;
    expect(definitionSeedShapeIssues(seed)).toEqual([
      expect.objectContaining({ path: "allowDraft" }),
    ]);
  });
});
