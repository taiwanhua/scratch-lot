import { describe, expect, it } from "@jest/globals";

import {
  type AudienceOptions,
  formatAudiencePath,
  validateAudience,
} from "./index";

const ROLE_ID = "65a000000000000000000001";
const ORG_ID = "65a000000000000000000002";

/** 資料範圍的套用對象:可選所有人、四個欄位、只能指定組織。 */
const DATA_SCOPE: AudienceOptions = {
  allowAll: true,
  fields: ["user", "role", "org", "permission"],
  orgSources: ["static"],
};

/** 流程審核者:不能選所有人、組織可用動態來源。 */
const APPROVER: AudienceOptions = {
  allowAll: false,
  fields: ["user", "role", "org", "permission"],
  orgSources: ["static", "form-field", "submission-org", "tenant"],
};

const roleRow = {
  field: "role",
  cond: "in",
  value: { kind: "static", values: [ROLE_ID] },
};
const orgRow = {
  field: "org",
  cond: "in",
  value: { kind: "static", values: [ORG_ID] },
  range: "self",
};

const match = (...children: unknown[]) => ({
  mode: "match",
  filter: { op: "OR", children },
});

const dynamic = (ref: string) => ({
  ...orgRow,
  value: { kind: "dynamic", ref },
});

const issueOf = (input: unknown, options: AudienceOptions = DATA_SCOPE) => {
  const result = validateAudience(input, options);
  if (result.ok) {
    throw new Error("expected an issue");
  }
  return result.issue;
};

describe("validateAudience:頂層二選一", () => {
  it("所有人(只在允許的使用處)", () => {
    expect(validateAudience({ mode: "all" }, DATA_SCOPE)).toEqual({
      ok: true,
      audience: { mode: "all" },
    });
    expect(issueOf({ mode: "all" }, APPROVER).path).toBe("mode");
  });

  it("「店長且屬於 A 店」:AND 群組裡兩個條件列", () => {
    const audience = {
      mode: "match",
      filter: { op: "AND", children: [roleRow, orgRow] },
    };
    expect(validateAudience(audience, DATA_SCOPE)).toEqual({
      ok: true,
      audience,
    });
  });

  it("mode 不認得 → path = mode", () => {
    expect(issueOf({ mode: "everyone" }).path).toBe("mode");
    expect(issueOf({}).path).toBe("mode");
    expect(issueOf("all").path).toBe("");
  });

  it("舊格式 { type, ids } 不再接受", () => {
    expect(issueOf({ type: "all" }).path).toBe("mode");
    expect(issueOf({ type: "role", ids: [ROLE_ID] }).path).toBe("mode");
  });

  it("match 沒有條件列 → 指到 filter / 空群組", () => {
    expect(issueOf({ mode: "match" }).path).toBe("filter");
    expect(
      issueOf({ mode: "match", filter: { op: "AND", children: [] } }).path,
    ).toBe("filter.children");
  });

  it("all 帶多餘的鍵也拒絕(不讓舊欄位混進來)", () => {
    expect(issueOf({ mode: "all", ids: [] }).path).toBe("");
  });
});

describe("validateAudience:條件列", () => {
  it("欄位不在這個使用處的清單 → path 指到該列的 field", () => {
    const options: AudienceOptions = { ...DATA_SCOPE, fields: ["role"] };
    expect(issueOf(match(roleRow, orgRow), options).path).toBe(
      "filter.children[1].field",
    );
    expect(issueOf(match({ field: "name", cond: "in" })).path).toBe(
      "filter.children[0].field",
    );
  });

  it("比較方式只有 in(沒有不屬於)", () => {
    expect(issueOf(match({ ...roleRow, cond: "not-in" })).path).toBe(
      "filter.children[0].cond",
    );
  });

  it("值的格式依欄位:id / 權限 key;空清單拒絕", () => {
    expect(
      issueOf(match({ ...roleRow, value: { kind: "static", values: ["x"] } }))
        .path,
    ).toBe("filter.children[0].value.values[0]");
    expect(
      issueOf(match({ ...roleRow, value: { kind: "static", values: [] } }))
        .path,
    ).toBe("filter.children[0].value.values");
    expect(
      validateAudience(
        match({
          field: "permission",
          cond: "in",
          value: { kind: "static", values: ["accounts.close-period", "a.*"] },
        }),
        DATA_SCOPE,
      ).ok,
    ).toBe(true);
    expect(
      issueOf(
        match({
          field: "permission",
          cond: "in",
          value: { kind: "static", values: ["no-dot"] },
        }),
      ).path,
    ).toBe("filter.children[0].value.values[0]");
  });

  it("所屬組織要給範圍;其他欄位不能帶範圍", () => {
    const withoutRange = {
      field: orgRow.field,
      cond: orgRow.cond,
      value: orgRow.value,
    };
    expect(issueOf(match(withoutRange)).path).toBe("filter.children[0].range");
    expect(issueOf(match({ ...orgRow, range: "subtree" })).path).toBe(
      "filter.children[0].range",
    );
    expect(issueOf(match({ ...roleRow, range: "self" })).path).toBe(
      "filter.children[0]",
    );
  });

  it("動態組織來源:只有宣告的來源可用,且只有所屬組織欄可用", () => {
    expect(issueOf(match(dynamic("tenant"))).path).toBe(
      "filter.children[0].value.ref",
    );
    for (const ref of ["tenant", "submission-org", "form-field:branch"]) {
      expect(validateAudience(match(dynamic(ref)), APPROVER).ok).toBe(true);
    }
    expect(issueOf(match(dynamic("event-org")), APPROVER).path).toBe(
      "filter.children[0].value.ref",
    );
    expect(issueOf(match(dynamic("form-field:")), APPROVER).path).toBe(
      "filter.children[0].value.ref",
    );
    expect(
      issueOf(
        match({ ...roleRow, value: { kind: "dynamic", ref: "tenant" } }),
        APPROVER,
      ).path,
    ).toBe("filter.children[0].value.kind");
  });

  it("沒有宣告 static 的使用處只收動態組織(通知設定)", () => {
    const options: AudienceOptions = {
      allowAll: false,
      fields: ["role", "org"],
      orgSources: ["event-org"],
    };
    expect(issueOf(match(orgRow), options).path).toBe(
      "filter.children[0].value.kind",
    );
    expect(
      validateAudience(
        match({ ...orgRow, value: { kind: "dynamic", ref: "event-org" } }),
        options,
      ).ok,
    ).toBe(true);
  });
});

describe("validateAudience:群組", () => {
  const nest = (depth: number): unknown =>
    depth === 0 ? roleRow : { op: "AND", children: [nest(depth - 1)] };

  it("最多 3 層群組;第 4 層拒絕", () => {
    expect(
      validateAudience({ mode: "match", filter: nest(3) }, DATA_SCOPE).ok,
    ).toBe(true);
    expect(issueOf({ mode: "match", filter: nest(4) }).path).toBe(
      "filter.children[0].children[0].children[0]",
    );
  });

  it("根節點可以直接是條件列", () => {
    expect(
      validateAudience({ mode: "match", filter: roleRow }, DATA_SCOPE).ok,
    ).toBe(true);
  });

  it("群組的 op 不認得", () => {
    expect(
      issueOf({ mode: "match", filter: { op: "XOR", children: [roleRow] } })
        .path,
    ).toBe("filter.op");
  });

  it("巢狀空群組指到那個群組的 children", () => {
    expect(
      issueOf({
        mode: "match",
        filter: { op: "AND", children: [roleRow, { op: "OR", children: [] }] },
      }).path,
    ).toBe("filter.children[1].children");
  });
});

describe("formatAudiencePath", () => {
  it("陣列索引寫成 [n]", () => {
    expect(formatAudiencePath(["filter", "children", 1, "value"])).toBe(
      "filter.children[1].value",
    );
    expect(formatAudiencePath([])).toBe("");
  });
});
