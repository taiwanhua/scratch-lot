import { describe, expect, it } from "@jest/globals";

import {
  type AudienceDraft,
  audienceIssueFromPath,
  newAudienceCondition,
  newAudienceDraft,
  toAudienceDraft,
  toAudienceJson,
  validateAudienceDraft,
} from "./audience-draft";

/** 規格 3.0 的示例:角色 AND(所屬組織含下層 OR 持有權限)。 */
const SPEC_EXAMPLE = {
  mode: "match",
  filter: {
    op: "AND",
    children: [
      { field: "role", cond: "in", value: { kind: "static", values: ["r1"] } },
      {
        op: "OR",
        children: [
          {
            field: "org",
            cond: "in",
            value: { kind: "static", values: ["o1"] },
            range: "descendants",
          },
          {
            field: "permission",
            cond: "in",
            value: { kind: "static", values: ["accounts.close-period"] },
          },
        ],
      },
    ],
  },
};

describe("人員條件 JSON ↔ 編輯器狀態", () => {
  it("規格示例來回不變(含巢狀群組、所屬組織範圍、權限)", () => {
    expect(toAudienceJson(toAudienceDraft(SPEC_EXAMPLE, "role"))).toEqual(
      SPEC_EXAMPLE,
    );
  });

  it("根是單一條件列時包一層 AND 群組(語意相同),送出時就是群組", () => {
    const draft = toAudienceDraft(
      {
        mode: "match",
        filter: {
          field: "user",
          cond: "in",
          value: { kind: "static", values: ["u1"] },
        },
      },
      "role",
    );

    expect(draft.filter).toEqual({
      kind: "group",
      op: "AND",
      children: [
        {
          kind: "condition",
          field: "user",
          value: { kind: "static", values: ["u1"] },
        },
      ],
    });
  });

  it("「所有人」讀進來時預備一列條件(切到符合條件就能填),送出時只有 mode", () => {
    const draft = toAudienceDraft({ mode: "all" }, "role");

    expect(draft.mode).toBe("all");
    expect(draft.filter.children).toEqual([newAudienceCondition("role")]);
    expect(toAudienceJson(draft)).toEqual({ mode: "all" });
  });

  it("切到所有人再切回來,條件樹原樣保留", () => {
    const draft = toAudienceDraft(SPEC_EXAMPLE, "role");
    const toAll: AudienceDraft = { ...draft, mode: "all" };
    const back: AudienceDraft = { ...toAll, mode: "match" };

    expect(toAudienceJson(back)).toEqual(SPEC_EXAMPLE);
  });

  it("動態組織來源原樣保留", () => {
    const json = {
      mode: "match",
      filter: {
        op: "AND",
        children: [
          {
            field: "org",
            cond: "in",
            value: { kind: "dynamic", ref: "submission-org" },
            range: "self",
          },
        ],
      },
    };

    expect(toAudienceJson(toAudienceDraft(json, "org"))).toEqual(json);
  });
});

describe("新條件列與起始狀態", () => {
  it("所屬組織預設範圍「本身」;只有動態來源時值預設第一個來源", () => {
    expect(newAudienceCondition("org")).toEqual({
      kind: "condition",
      field: "org",
      value: { kind: "static", values: [] },
      range: "self",
    });
    expect(
      newAudienceCondition("org", [
        { kind: "dynamic", ref: "tenant", label: "租戶" },
      ]).value,
    ).toEqual({ kind: "dynamic", ref: "tenant" });
  });

  it("不允許所有人的使用處一開始就是符合條件", () => {
    expect(newAudienceDraft("role", { allowAll: false }).mode).toBe("match");
    expect(newAudienceDraft("role", { allowAll: true }).mode).toBe("all");
  });
});

describe("本地驗證", () => {
  it("所有人不檢查條件樹", () => {
    const draft = newAudienceDraft("role", { allowAll: true });
    expect(validateAudienceDraft(draft)).toEqual([]);
  });

  it("沒挑值的列標在值、空群組標在群組", () => {
    const draft: AudienceDraft = {
      mode: "match",
      filter: {
        kind: "group",
        op: "AND",
        children: [
          newAudienceCondition("role"),
          { kind: "group", op: "OR", children: [] },
        ],
      },
    };

    expect(validateAudienceDraft(draft)).toEqual([
      { childPath: [0], target: "value" },
      { childPath: [1], target: "group" },
    ]);
  });
});

describe("api 的 path → 標在哪一格", () => {
  it.each([
    ["mode", { childPath: [], target: "mode" }],
    ["", { childPath: [], target: "mode" }],
    ["filter", { childPath: [], target: "node" }],
    ["filter.children", { childPath: [], target: "group" }],
    ["filter.op", { childPath: [], target: "group" }],
    ["filter.children[1].value.values[0]", { childPath: [1], target: "value" }],
    [
      "filter.children[1].children[0].field",
      { childPath: [1, 0], target: "field" },
    ],
    ["filter.children[0].range", { childPath: [0], target: "range" }],
    ["filter.children[0].cond", { childPath: [0], target: "node" }],
    ["filter.children[2]", { childPath: [2], target: "node" }],
    ["filter.children[1].children", { childPath: [1], target: "group" }],
  ])("%s", (path, expected) => {
    expect(audienceIssueFromPath(path)).toEqual(expected);
  });
});
