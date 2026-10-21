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
    expect(isOrgReferenceField(orgRef("receiver_org"))).toBe(true);
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
      orgRef("supplier_org"),
      orgRef("receiver_org"),
      field("title", "text"),
    ];
    expect(
      sharedByFieldIssues(fields, ["supplier_org", "receiver_org"]),
    ).toEqual([]);
    expect(
      sharedByFieldIssues(fields, [
        "missing",
        "title",
        "receiver_org",
        "receiver_org",
      ]),
    ).toEqual([
      { key: "missing", reason: "notFound" },
      { key: "title", reason: "notOrgReference" },
      { key: "receiver_org", reason: "duplicate" },
    ]);
  });

  it("從存值取組織 id:沒值 / 形狀不對略過,去重、照設定順序", () => {
    expect(
      sharedOrgIdsOf(["supplier_org", "receiver_org", "missing", "broken"], {
        supplier_org: { id: "o2", label: "甲店" },
        receiver_org: { id: "o1", label: "乙店" },
        broken: "o3",
      }),
    ).toEqual(["o2", "o1"]);
    expect(
      sharedOrgIdsOf(["supplier_org", "receiver_org"], {
        supplier_org: { id: "o1", label: null },
        receiver_org: { id: "o1", label: null },
      }),
    ).toEqual(["o1"]);
    expect(
      sharedOrgIdsOf([], { receiver_org: { id: "o1", label: null } }),
    ).toEqual([]);
    expect(sharedOrgIdsOf(["receiver_org"], { receiver_org: null })).toEqual(
      [],
    );
  });
});
