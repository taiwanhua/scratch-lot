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

describe("表單定義宣告的形狀:serial(單號格式)", () => {
  it("缺席或合法的格式都合格(缺席 = 不給單號)", () => {
    const fields = [field("title", "text")];
    expect(definitionSeedShapeIssues(formSeed(fields))).toEqual([]);
    expect(
      definitionSeedShapeIssues(
        formSeed(fields, {
          serial: { prefix: "PU", period: "month", digits: 4 },
        }),
      ),
    ).toEqual([]);
  });

  it("格式不合法 → 指到 serial 的那個鍵", () => {
    const seed = {
      ...formSeed([field("title", "text")]),
      serial: { prefix: "PU", period: "week", digits: 4 },
    } as unknown;
    expect(definitionSeedShapeIssues(seed)).toEqual([
      expect.objectContaining({ path: "serial.period" }),
    ]);
  });
});

describe("表單定義宣告的形狀:voidReasonCategoryKey(作廢原因類別)", () => {
  it("缺席或合法的類別 key 都合格(缺席 = 作廢原因自由填寫)", () => {
    const fields = [field("title", "text")];
    expect(definitionSeedShapeIssues(formSeed(fields))).toEqual([]);
    expect(
      definitionSeedShapeIssues(
        formSeed(fields, { voidReasonCategoryKey: "void-reason" }),
      ),
    ).toEqual([]);
  });

  it("不是字串或格式不合 → 指到 voidReasonCategoryKey", () => {
    for (const value of [3, "", "Void Reason"]) {
      const seed = {
        ...formSeed([field("title", "text")]),
        voidReasonCategoryKey: value,
      } as unknown;
      expect(definitionSeedShapeIssues(seed)).toEqual([
        expect.objectContaining({ path: "voidReasonCategoryKey" }),
      ]);
    }
  });
});

describe("表單定義宣告的形狀:sharedByFieldKeys(依欄位共用)", () => {
  const branch = field("branch", "reference", {
    source: { provider: "org", labelField: "name" },
  });

  it("缺席或指到表單層組織引用欄都合格(缺席 = 不依欄位共用)", () => {
    const fields = [branch, field("title", "text")];
    expect(definitionSeedShapeIssues(formSeed(fields))).toEqual([]);
    expect(
      definitionSeedShapeIssues(
        formSeed(fields, { sharedByFieldKeys: ["branch"] }),
      ),
    ).toEqual([]);
  });

  it("空陣列 / 不是字串陣列 / 不存在 / 不是組織引用欄 → 指到 sharedByFieldKeys", () => {
    const fields = [branch, field("title", "text")];
    for (const value of [[], "branch", [3]]) {
      const seed = {
        ...formSeed(fields),
        sharedByFieldKeys: value,
      } as unknown;
      expect(definitionSeedShapeIssues(seed)).toEqual([
        expect.objectContaining({ path: "sharedByFieldKeys" }),
      ]);
    }
    expect(
      definitionSeedShapeIssues(
        formSeed(fields, { sharedByFieldKeys: ["missing", "title"] }),
      ),
    ).toEqual([
      expect.objectContaining({
        path: "sharedByFieldKeys",
        detail: expect.stringContaining("missing") as unknown,
      }),
      expect.objectContaining({
        path: "sharedByFieldKeys",
        detail: expect.stringContaining("title") as unknown,
      }),
    ]);
  });
});
