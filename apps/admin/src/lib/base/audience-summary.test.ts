import { describe, expect, it } from "@jest/globals";

import { toAudienceDraft } from "./audience-draft";
import {
  type AudienceSummaryLabels,
  audienceSummaryOf,
} from "./audience-summary";

const NAMES: Record<string, string> = {
  "role-shop": "店長",
  "org-a": "A 店",
  "org-b": "B 店",
  "demo.approve": "示範模組 · 核准",
};

const LABELS: AudienceSummaryLabels = {
  field: (field) =>
    ({ user: "使用者", role: "角色", org: "所屬組織", permission: "權限" })[
      field
    ],
  cond: (field) => (field === "permission" ? "持有" : "屬於"),
  and: "且",
  or: "或",
  range: (range) =>
    ({ self: "本身", descendants: "含下層", ancestors: "含上層" })[range],
  nameOf: (_field, value) => NAMES[value] ?? "不在候選清單中",
  dynamicOf: (ref) => (ref === "submission-org" ? "單據所屬組織" : ref),
  unset: "(未選)",
};

const summaryOf = (audience: unknown): string =>
  audienceSummaryOf(toAudienceDraft(audience, "role"), LABELS);

describe("audienceSummaryOf", () => {
  it("條件列以「且」接起來;動態組織用【】標出、所屬組織帶範圍", () => {
    expect(
      summaryOf({
        mode: "match",
        filter: {
          op: "AND",
          children: [
            {
              field: "role",
              cond: "in",
              value: { kind: "static", values: ["role-shop"] },
            },
            {
              field: "org",
              cond: "in",
              value: { kind: "dynamic", ref: "submission-org" },
              range: "self",
            },
          ],
        },
      }),
    ).toBe("角色 屬於 店長 且 所屬組織 屬於 【單據所屬組織】(本身)");
  });

  it("巢狀群組加括號;多個值用「、」;權限是「持有」;解不出的名稱交給 nameOf", () => {
    expect(
      summaryOf({
        mode: "match",
        filter: {
          op: "OR",
          children: [
            {
              field: "permission",
              cond: "in",
              value: { kind: "static", values: ["demo.approve"] },
            },
            {
              op: "AND",
              children: [
                {
                  field: "org",
                  cond: "in",
                  value: { kind: "static", values: ["org-a", "org-b"] },
                  range: "descendants",
                },
                {
                  field: "user",
                  cond: "in",
                  value: { kind: "static", values: ["ghost"] },
                },
              ],
            },
          ],
        },
      }),
    ).toBe(
      "權限 持有 示範模組 · 核准 或 (所屬組織 屬於 A 店、B 店(含下層) 且 使用者 屬於 不在候選清單中)",
    );
  });

  it("還沒挑值顯示「未選」;沒有條件列 = 空字串(呼叫端顯示「尚未設定條件」)", () => {
    expect(
      summaryOf({
        mode: "match",
        filter: {
          op: "AND",
          children: [
            {
              field: "role",
              cond: "in",
              value: { kind: "static", values: [] },
            },
          ],
        },
      }),
    ).toBe("角色 屬於 (未選)");
    expect(
      summaryOf({ mode: "match", filter: { op: "AND", children: [] } }),
    ).toBe("");
    expect(summaryOf({ mode: "all" })).toBe("");
  });
});
