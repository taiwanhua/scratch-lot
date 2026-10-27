import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Types } from "mongoose";

import type { FormDefinition } from "@repo/domain/form";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import {
  FORM_LOOKUP,
  FORM_LOOKUP_RECORD,
  FORM_TEST_TIMEOUT_MS,
  type FormOperator,
  M,
  MODULE_KEY,
  SUBMIT,
  assignForm,
  call,
  codeOf,
  createDraft,
  createOperator,
  definitionOf,
  extensionsOf,
  field,
  publishNewForm,
  rootToken,
} from "../../forms/test-support/form-fixtures";
import {
  PROJECT_FIXTURE_ITEMS_COLLECTION,
  PROJECT_FIXTURE_MODULE_KEY,
} from "./database/project-fixture-item.schema";
import {
  PROJECT_FIXTURE_PERMISSIONS,
  seedProjectFixtureAuthorization,
} from "./fixtures";
import {
  PROJECT_FIXTURE_LOOKUP_KEY,
  PROJECT_FIXTURE_SHARED_LOOKUP_KEY,
} from "./project-fixture-lookup";

/** 同 `project-fixture-lookup.test.ts`:只替換三份專案登記來源(TEST-07)。 */
jest.mock("../../project/api-modules", () => {
  const actual = jest.requireActual<typeof import("../../project/api-modules")>(
    "../../project/api-modules",
  );
  const fixture =
    jest.requireActual<typeof import("./api-modules")>("./api-modules");
  return {
    PROJECT_API_MODULES: [
      ...actual.PROJECT_API_MODULES,
      ...fixture.PROJECT_FIXTURE_API_MODULES,
    ],
  };
});
jest.mock("../../project/database/registrations", () => {
  const actual = jest.requireActual<
    typeof import("../../project/database/registrations")
  >("../../project/database/registrations");
  const fixture = jest.requireActual<typeof import("./database/registrations")>(
    "./database/registrations",
  );
  return {
    PROJECT_DATABASE_REGISTRATIONS: [
      ...actual.PROJECT_DATABASE_REGISTRATIONS,
      ...fixture.PROJECT_FIXTURE_DATABASE_REGISTRATIONS,
    ],
  };
});
jest.mock("../../project/lookup-providers", () => {
  const fixture = jest.requireActual<typeof import("./project-fixture-lookup")>(
    "./project-fixture-lookup",
  );
  return {
    PROJECT_LOOKUP_PROVIDERS: fixture.PROJECT_FIXTURE_LOOKUP_PROVIDERS,
  };
});

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

interface LookupData {
  formLookup: { items: { id: string; label: string }[]; totalCount: number };
}

interface RecordData {
  formLookupRecord: { record: { id: string } | null };
}

const FORM = "project_sharing_form";

/** 依字串排序(比對用)。 */
const byText = (left: string, right: string): number =>
  left.localeCompare(right);

/** 引用測試專案來源(`item`),以及依「分店」換值的共用篩選(`account` 只列給那個分店看得到的)。 */
const formDefinition = (): FormDefinition =>
  definitionOf([
    field("title", "text"),
    field("item", "reference", {
      source: { provider: PROJECT_FIXTURE_LOOKUP_KEY, labelField: "name" },
    }),
    field("branch", "reference", {
      source: { provider: "org", labelField: "name" },
    }),
    field("account", "reference", {
      source: {
        provider: PROJECT_FIXTURE_SHARED_LOOKUP_KEY,
        labelField: "name",
        filter: { sharedTo: { var: "branch" } },
      },
    }),
  ]);

/**
 * 資料共用(ADR-0014)經 lookup 的端到端:搜尋、依值取回、送出重驗都走 `BaseRepository` 的讀取,
 * 共用自動生效;別租戶的人透過 lookup 一律看不到。
 *
 * 組織樹:租戶甲(含下層可見)─┬─ 部門一
 *                             └─ 部門二;租戶乙
 */
describe("資料共用經 lookup(搜尋 / 依值取回 / 送出重驗)", () => {
  let api: AuthTestApp;
  let tenantA: Types.ObjectId;
  let tenantB: Types.ObjectId;
  let dept1: Types.ObjectId;
  let dept2: Types.ObjectId;
  let dept1Staff: FormOperator;
  let dept2Staff: FormOperator;
  let topStaff: FormOperator;
  let staffB: FormOperator;
  const ids: Record<string, Types.ObjectId> = {};

  async function insertItem(
    name: string,
    orgId: Types.ObjectId,
    tenantId: Types.ObjectId,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const now = new Date();
    const { insertedId } = await api.connection
      .collection(PROJECT_FIXTURE_ITEMS_COLLECTION)
      .insertOne({
        name,
        code: null,
        enabled: true,
        rank: 0,
        branchId: null,
        shareOrgs: [],
        ...extra,
        orgId,
        tenantId,
        moduleKey: PROJECT_FIXTURE_MODULE_KEY,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });
    ids[name] = insertedId;
  }

  const search = async (
    operator: FormOperator,
    fieldKey: string,
    filterValues?: Record<string, unknown>,
  ): Promise<string[]> => {
    const result = await call<LookupData>(api, operator.token, FORM_LOOKUP, {
      input: {
        formKey: FORM,
        version: 1,
        target: { fieldKey },
        ...(filterValues === undefined ? {} : { filterValues }),
      },
    });
    expect(result.errors).toBeUndefined();
    return (
      result.data?.formLookup.items.map((item) => item.label) ?? []
    ).toSorted(byText);
  };

  const record = async (
    operator: FormOperator,
    name: string,
  ): Promise<string | null> => {
    const result = await call<RecordData>(
      api,
      operator.token,
      FORM_LOOKUP_RECORD,
      {
        input: {
          formKey: FORM,
          version: 1,
          target: { fieldKey: "item" },
          id: String(ids[name]),
        },
      },
    );
    expect(result.errors).toBeUndefined();
    return result.data?.formLookupRecord.record?.id ?? null;
  };

  const submit = async (
    operator: FormOperator,
    values: Record<string, unknown>,
  ): ReturnType<typeof call> => {
    const draft = await createDraft(api, operator.token, FORM, {
      title: "共用",
      ...values,
    });
    return call(api, operator.token, SUBMIT, {
      input: { id: draft.id, expectedEditVersion: draft.editVersion },
    });
  };

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-project-sharing");
    await seedProjectFixtureAuthorization(api.connection);
    const root = await rootToken(api);
    tenantA = await createOrg(api.connection, {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    tenantB = await createOrg(api.connection, { name: "租戶乙" });
    dept1 = await createOrg(api.connection, {
      name: "部門一",
      parentId: tenantA,
    });
    dept2 = await createOrg(api.connection, {
      name: "部門二",
      parentId: tenantA,
    });

    await publishNewForm(api, root, FORM, formDefinition());
    await assignForm(api, root, FORM, [tenantA, tenantB]);

    const moduleKeys = [MODULE_KEY, PROJECT_FIXTURE_MODULE_KEY];
    const permissionKeys = [M.view, M.create, PROJECT_FIXTURE_PERMISSIONS.view];
    dept1Staff = await createOperator(api, api.connection, {
      orgId: dept1,
      ownerOrgId: tenantA,
      moduleKeys,
      permissionKeys,
    });
    dept2Staff = await createOperator(api, api.connection, {
      orgId: dept2,
      ownerOrgId: tenantA,
      moduleKeys,
      permissionKeys,
    });
    topStaff = await createOperator(api, api.connection, {
      orgId: tenantA,
      moduleKeys,
      permissionKeys,
    });
    staffB = await createOperator(api, api.connection, {
      orgId: tenantB,
      moduleKeys,
      permissionKeys,
    });

    await insertItem("部門一·自己的", dept1, tenantA);
    await insertItem("部門二·不共用", dept2, tenantA);
    await insertItem("部門二·共用給部門一", dept2, tenantA, {
      shareOrgs: [{ orgId: dept1, includeDescendants: false }],
    });
    await insertItem("部門二·對應分店是部門一", dept2, tenantA, {
      branchId: dept1,
    });
    await insertItem("甲·頂層的", tenantA, tenantA);
    // 模擬損毀資料:租戶甲的資料卻指到租戶乙(寫入檢查擋得掉,這裡直接寫進去)——乙仍看不到
    await insertItem("甲·偽造給乙", tenantA, tenantA, {
      shareOrgs: [{ orgId: tenantB, includeDescendants: true }],
      branchId: tenantB,
    });
    await insertItem("乙·自己的", tenantB, tenantB);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("搜尋:可見範圍 + 共用給我 + 欄位指到我", async () => {
    expect(await search(dept1Staff, "item")).toEqual(
      [
        "部門一·自己的",
        "部門二·共用給部門一",
        "部門二·對應分店是部門一",
      ].toSorted(byText),
    );
    expect(await search(dept2Staff, "item")).toEqual(
      [
        "部門二·不共用",
        "部門二·共用給部門一",
        "部門二·對應分店是部門一",
      ].toSorted(byText),
    );
  });

  it("依值取回:共用進來的取得到,沒共用的取不到", async () => {
    await expect(record(dept1Staff, "部門二·共用給部門一")).resolves.toBe(
      String(ids["部門二·共用給部門一"]),
    );
    await expect(record(dept1Staff, "部門二·不共用")).resolves.toBeNull();
  });

  it("送出重驗:引用共用進來的可送,引用看不到的 → SOURCE_UNAVAILABLE", async () => {
    const shared = await submit(dept1Staff, {
      item: String(ids["部門二·對應分店是部門一"]),
    });
    expect(codeOf(shared)).toBeUndefined();
    const hidden = await submit(dept1Staff, {
      item: String(ids["部門二·不共用"]),
    });
    expect(codeOf(hidden)).toBe("VALIDATION_FAILED");
    expect(extensionsOf(hidden).fieldErrors).toContainEqual(
      expect.objectContaining({ fieldKey: "item", code: "SOURCE_UNAVAILABLE" }),
    );
  });

  it("別租戶的人:列表、依值取回、送出都看不到(含指到他的偽造資料)", async () => {
    expect(await search(staffB, "item")).toEqual(["乙·自己的"]);
    await expect(record(staffB, "甲·偽造給乙")).resolves.toBeNull();
    await expect(record(staffB, "部門二·共用給部門一")).resolves.toBeNull();
    const result = await submit(staffB, { item: String(ids["甲·偽造給乙"]) });
    expect(codeOf(result)).toBe("VALIDATION_FAILED");
  });

  it("依表單欄位換值的共用篩選:只列給「分店」看得到的,仍在操作者自己的範圍內", async () => {
    // 頂層的人看得到全租戶;分店選部門一 → 只剩部門一的、共用給部門一的、對應分店是部門一的
    expect(
      await search(topStaff, "account", { branch: String(dept1) }),
    ).toEqual(
      [
        "部門一·自己的",
        "部門二·共用給部門一",
        "部門二·對應分店是部門一",
      ].toSorted(byText),
    );
    expect(
      await search(topStaff, "account", { branch: String(dept2) }),
    ).toEqual(
      [
        "部門二·不共用",
        "部門二·共用給部門一",
        "部門二·對應分店是部門一",
      ].toSorted(byText),
    );
    // 部門一的人選不到看不見的部門二(讀不到那個組織 → 查無,不放寬)
    expect(
      await search(dept1Staff, "account", { branch: String(dept2) }),
    ).toEqual([]);
    // 別租戶的組織 → 查無
    expect(
      await search(topStaff, "account", { branch: String(tenantB) }),
    ).toEqual([]);
  });

  it("共用篩選的送出重驗:以存下的「分店」重算,不在那個分店看得到的 → LOOKUP_FILTER_MISMATCH", async () => {
    const ok = await submit(topStaff, {
      branch: String(dept1),
      account: String(ids["部門二·共用給部門一"]),
    });
    expect(codeOf(ok)).toBeUndefined();
    const rejected = await submit(topStaff, {
      branch: String(dept1),
      account: String(ids["部門二·不共用"]),
    });
    expect(codeOf(rejected)).toBe("VALIDATION_FAILED");
    expect(extensionsOf(rejected).fieldErrors).toContainEqual(
      expect.objectContaining({
        fieldKey: "account",
        code: "LOOKUP_FILTER_MISMATCH",
      }),
    );
  });
});
