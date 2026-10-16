import { describe, expect, it } from "@jest/globals";

import {
  DataScopeAudienceType,
  toAudienceDraft,
  toAudienceJson,
} from "./data-scope-rule";

describe("套用對象:人員條件 JSON ↔ 這一版畫面的單選種類", () => {
  it.each([
    [DataScopeAudienceType.Role, "role", {}],
    [DataScopeAudienceType.User, "user", {}],
    [DataScopeAudienceType.Org, "org", { range: "self" }],
  ])("%s:單一條件列來回不變", (type, field, extra) => {
    const json = {
      mode: "match",
      filter: {
        field,
        cond: "in",
        value: { kind: "static", values: ["a", "b"] },
        ...extra,
      },
    };
    expect(toAudienceDraft(json)).toEqual({ type, ids: ["a", "b"] });
    expect(toAudienceJson({ type, ids: ["a", "b"] })).toEqual(json);
  });

  it("所有人", () => {
    expect(toAudienceDraft({ mode: "all" })).toEqual({
      type: DataScopeAudienceType.All,
      ids: [],
    });
  });

  it("畫面表達不出來的(多條件列、權限、含下層)原樣保留、原樣送回", () => {
    const json = {
      mode: "match",
      filter: {
        op: "AND",
        children: [
          {
            field: "role",
            cond: "in",
            value: { kind: "static", values: ["r"] },
          },
          {
            field: "org",
            cond: "in",
            value: { kind: "static", values: ["o"] },
            range: "descendants",
          },
        ],
      },
    };
    const draft = toAudienceDraft(json);
    expect(draft.preserved).toEqual(json);
    expect(toAudienceJson(draft)).toEqual(json);
  });
});
