import { describe, expect, it } from "@jest/globals";

import { field } from "./form-test-support";
import {
  isOrgReferenceField,
  sharedByFieldIssues,
  sharedOrgIdsOf,
} from "./shared-by-fields";

const orgRef = (key: string) =>
  field(key, "reference", { source: { provider: "org", labelField: "name" } });

describe("依欄位共用(sharedByFieldKeys)", () => {
  it("只有引用組織的欄位算組織引用欄", () => {
    expect(isOrgReferenceField(orgRef("branch"))).toBe(true);
    expect(
      isOrgReferenceField(
        field("owner", "reference", {
          source: { provider: "user", labelField: "name" },
        }),
      ),
    ).toBe(false);
    expect(isOrgReferenceField(field("title", "text"))).toBe(false);
  });

  it("設定值逐一對照欄位:不存在、不是組織引用欄、重複都列出", () => {
    const fields = [
      orgRef("from_branch"),
      orgRef("to_branch"),
      field("title", "text"),
    ];
    expect(sharedByFieldIssues(fields, ["from_branch", "to_branch"])).toEqual(
      [],
    );
    expect(
      sharedByFieldIssues(fields, [
        "missing",
        "title",
        "to_branch",
        "to_branch",
      ]),
    ).toEqual([
      { key: "missing", reason: "notFound" },
      { key: "title", reason: "notOrgReference" },
      { key: "to_branch", reason: "duplicate" },
    ]);
  });

  it("從存值取組織 id:沒值 / 形狀不對略過,去重、照設定順序", () => {
    expect(
      sharedOrgIdsOf(["from_branch", "to_branch", "missing", "broken"], {
        from_branch: { id: "o2", label: "中山店" },
        to_branch: { id: "o1", label: "信義店" },
        broken: "o3",
      }),
    ).toEqual(["o2", "o1"]);
    expect(
      sharedOrgIdsOf(["from_branch", "to_branch"], {
        from_branch: { id: "o1", label: null },
        to_branch: { id: "o1", label: null },
      }),
    ).toEqual(["o1"]);
    expect(sharedOrgIdsOf([], { branch: { id: "o1", label: null } })).toEqual(
      [],
    );
    expect(sharedOrgIdsOf(["branch"], { branch: null })).toEqual([]);
  });
});
