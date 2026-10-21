import { describe, expect, it } from "@jest/globals";
import { Schema, Types } from "mongoose";

import { TENANT_PURGE } from "./database.module";
import {
  type TenantPurgeModel,
  type TenantPurgeRegistration,
  TenantPurgeRegistrationError,
  filterOfStep,
  hasPath,
  resolveTenantPurgePlan,
} from "./tenant-purge";

function problemsOf(
  models: readonly TenantPurgeModel[],
  registrations: readonly TenantPurgeRegistration[],
): readonly string[] {
  try {
    resolveTenantPurgePlan({ models, registrations });
    return [];
  } catch (error) {
    if (error instanceof TenantPurgeRegistrationError) {
      return error.problems;
    }
    throw error;
  }
}

function model(
  collection: string,
  paths: Record<string, unknown>,
): TenantPurgeModel {
  return { name: collection, collection, schema: new Schema(paths) };
}

const TENANT_TABLE = model("items", {
  tenantId: Types.ObjectId,
  orgId: Types.ObjectId,
});
const OWNED_TABLE = model("notes", { orgId: Types.ObjectId, key: String });

describe("清空租戶的刪除登記:完整性(底座 + 專案,正式內容)", () => {
  it("資料層登記的每一張 collection 都有刪法,帶 tenantId 的都依 tenantId 刪", () => {
    expect(problemsOf(TENANT_PURGE.models, TENANT_PURGE.registrations)).toEqual(
      [],
    );
  });

  it("所有帶 tenantId 欄的表都在刪除步驟裡(以 tenantId 為條件)", () => {
    const plan = resolveTenantPurgePlan(TENANT_PURGE);
    const withTenantId = TENANT_PURGE.models
      .filter((entry) => hasPath(entry.schema, "tenantId"))
      .map((entry) => entry.collection)
      .toSorted((left, right) => left.localeCompare(right));
    const byTenantId = plan.steps
      .filter((step) => step.by === "tenantId")
      .map((step) => step.collection)
      .toSorted((left, right) => left.localeCompare(right));
    expect(withTenantId.length).toBeGreaterThan(0);
    expect(byTenantId).toEqual(withTenantId);
  });

  it("只能新增的帳本也在刪除範圍內(audit_logs 依組織、流水類依 tenantId)", () => {
    const plan = resolveTenantPurgePlan(TENANT_PURGE);
    const deleted = plan.steps.map((step) => step.collection);
    expect(deleted).toContain("audit_logs");
    expect(deleted).toContain("serial_counters");
    expect(plan.kept).not.toContain("audit_logs");
  });
});

describe("清空租戶的刪除登記:規則", () => {
  it("新表沒有登記 → 失敗並指出是哪一張", () => {
    expect(problemsOf([TENANT_TABLE], [])).toEqual([
      expect.stringContaining("items:沒有登記刪法"),
    ]);
  });

  it("帶 tenantId 的表登記成別的刪法(match / keep)→ 失敗", () => {
    expect(
      problemsOf(
        [TENANT_TABLE],
        [
          {
            collection: "items",
            rule: { by: "keep", reason: "想保留" },
          },
        ],
      ),
    ).toEqual([expect.stringContaining('必須是 by: "tenantId"')]);
  });

  it("沒有 tenantId 欄卻登記依 tenantId 刪、match 欄位不存在、依賴未登記 → 全部列出", () => {
    expect(
      problemsOf(
        [OWNED_TABLE, model("logs", { noteKey: String })],
        [
          { collection: "notes", rule: { by: "tenantId" } },
          {
            collection: "logs",
            rule: {
              by: "match",
              anyOf: [
                { field: "missing", in: "tenantOrgs" },
                { field: "noteKey", in: "deleted", of: "ghost", key: "key" },
              ],
            },
          },
          { collection: "extra", rule: { by: "tenantId" } },
        ],
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("notes:schema 沒有 tenantId 欄"),
        expect.stringContaining("logs:schema 沒有欄位 missing"),
        expect.stringContaining("logs:依賴的 ghost 沒有登記"),
        expect.stringContaining("extra:資料層沒有這張 collection"),
      ]),
    );
  });

  it("dedicated 只給組織 / 使用者 / 角色 / 核心關聯;keep 要寫理由;重複登記", () => {
    expect(
      problemsOf(
        [OWNED_TABLE],
        [
          { collection: "notes", rule: { by: "dedicated", reason: "x" } },
          { collection: "notes", rule: { by: "keep", reason: " " } },
        ],
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("notes:重複登記"),
        expect.stringContaining("notes:keep 要寫理由"),
      ]),
    );
    expect(
      problemsOf(
        [OWNED_TABLE],
        [{ collection: "notes", rule: { by: "dedicated", reason: "x" } }],
      ),
    ).toEqual([expect.stringContaining("dedicated 只給")]);
  });

  it("files:欄位要存在、只能宣告在會刪的表;正式登記只在會存上傳路徑的表宣告", () => {
    expect(
      problemsOf(
        [OWNED_TABLE, model("logs", { note: String })],
        [
          {
            collection: "notes",
            rule: {
              by: "match",
              anyOf: [{ field: "orgId", in: "tenantOrgs" }],
            },
            files: ["missing"],
          },
          {
            collection: "logs",
            rule: { by: "keep", reason: "x" },
            files: ["note"],
          },
        ],
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("notes:files 的欄位 missing 不存在"),
        expect.stringContaining("logs:files 只能宣告在會刪的表"),
      ]),
    );
    const plan = resolveTenantPurgePlan(TENANT_PURGE);
    expect(
      plan.steps
        .filter((step) => step.files.length > 0)
        .map((step) => step.collection)
        .toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(["demo_items_one", "form_submissions"]);
  });

  it("deleted 依賴:被依賴的表排在前面;依賴的值沒有時這一步不刪", () => {
    const plan = resolveTenantPurgePlan({
      models: [model("versions", { noteKey: String }), OWNED_TABLE],
      registrations: [
        {
          collection: "versions",
          rule: {
            by: "match",
            anyOf: [
              { field: "noteKey", in: "deleted", of: "notes", key: "key" },
            ],
          },
        },
        {
          collection: "notes",
          rule: { by: "match", anyOf: [{ field: "orgId", in: "tenantOrgs" }] },
        },
      ],
    });
    expect(plan.steps.map((step) => step.collection)).toEqual([
      "notes",
      "versions",
    ]);
    const tenantId = new Types.ObjectId();
    const scope = {
      tenantId,
      tenantOrgIds: [tenantId],
      purgedUserIds: [],
      deletedValues: new Map<string, Map<string, unknown[]>>(),
    };
    const [notes, versions] = plan.steps;
    expect(notes && filterOfStep(notes, scope)).toEqual({
      orgId: { $in: [tenantId] },
    });
    expect(versions && filterOfStep(versions, scope)).toBeNull();
    scope.deletedValues.set("notes", new Map([["key", ["a"]]]));
    expect(versions && filterOfStep(versions, scope)).toEqual({
      noteKey: { $in: ["a"] },
    });
  });
});
