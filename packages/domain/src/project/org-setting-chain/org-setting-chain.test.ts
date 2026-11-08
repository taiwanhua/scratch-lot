import { describe, expect, it } from "@jest/globals";

import { chainRowOf, firstOnChain, rowsByOrg } from "./index";

const rows = [
  { orgId: "tenant", key: "a", value: 1 },
  { orgId: "region", key: "b", value: 2 },
  { orgId: "store", key: "a", value: 3 },
];
const byOrg = rowsByOrg(rows);

describe("沿組織鏈找生效值(排班規則與刮刮樂設定共用)", () => {
  it.each([
    // [鏈, key, 找到的組織, 值, 來源]
    [["store", "region", "tenant"], "a", "store", 3, "own"],
    [["store", "region", "tenant"], "b", "region", 2, "inherited"],
    [["other", "region", "tenant"], "a", "tenant", 1, "inherited"],
    [["tenant"], "a", "tenant", 1, "own"],
  ] as const)("鏈 %j 的 %s → %s(%s,%s)", (chain, key, orgId, value, source) => {
    expect(chainRowOf(chain, byOrg, key)).toEqual({
      value: expect.objectContaining({ orgId, value }) as unknown,
      orgId,
      source,
    });
  });

  it("整條鏈都沒有 → null(呼叫端用程式預設)", () => {
    expect(chainRowOf(["store", "tenant"], byOrg, "c")).toBeNull();
    expect(chainRowOf([], byOrg, "a")).toBeNull();
  });

  it("firstOnChain:pick 回 undefined 的組織略過", () => {
    expect(
      firstOnChain(["x", "y", "z"], (orgId) =>
        orgId === "y" ? "found" : undefined,
      ),
    ).toEqual({ value: "found", orgId: "y", source: "inherited" });
  });
});
