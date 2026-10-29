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
  CREATE_FORM,
  FORM_TEST_TIMEOUT_MS,
  type FormOperator,
  M,
  MODULE_KEY,
  type SubmissionRow,
  VALIDATE_VERSION,
  assignForm,
  call,
  createDraft,
  createOperator,
  definitionOf,
  field,
  ok,
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
  PROJECT_FIXTURE_OWNED_LOOKUP_KEY,
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

const FORM_LOOKUP_DEFAULT = /* GraphQL */ `
  query FormLookupDefault($input: FormLookupDefaultInput!) {
    formLookupDefault(input: $input) {
      record {
        id
        label
      }
    }
  }
`;

interface DefaultData {
  formLookupDefault: { record: { id: string; label: string } | null };
}

interface ValidationData {
  validateFormVersion: { errors: { code: string }[] };
}

const FORM = "operator_default_form";

/**
 * - `site`:組織(預設 = 填寫者的組織)
 * - `mine`:來源提供的預設,條件 `orgId = site`(那個組織裡自己的)
 * - `any`:來源提供的預設,沒有條件(自己的、看得到的裡面最新的)
 */
const formDefinition = (): FormDefinition =>
  definitionOf([
    field("title", "text"),
    field("site", "reference", {
      source: { provider: "org", labelField: "name" },
      default: { kind: "expression", expr: { var: "ctx.user.orgId" } },
    }),
    field("mine", "reference", {
      source: {
        provider: PROJECT_FIXTURE_OWNED_LOOKUP_KEY,
        labelField: "name",
      },
      default: { kind: "provider", filter: { orgId: { var: "site" } } },
    }),
    field("any", "reference", {
      source: {
        provider: PROJECT_FIXTURE_OWNED_LOOKUP_KEY,
        labelField: "name",
      },
      default: { kind: "provider" },
    }),
  ]);

const idOf = (value: unknown): string | null =>
  typeof value === "object" && value !== null && "id" in value
    ? String(value.id)
    : null;

describe("引用欄的「來源提供的預設」:建草稿帶預設、填寫頁查預設、檢查器", () => {
  let api: AuthTestApp;
  let root: string;
  let tenantA: Types.ObjectId;
  let tenantB: Types.ObjectId;
  let dept1: Types.ObjectId;
  let dept2: Types.ObjectId;
  /** 租戶甲頂層(這個模組的資料只看得到租戶甲本身那一層)。 */
  let staffA: FormOperator;
  /** 租戶甲的部門一(只看得到部門一)。 */
  let deptStaff: FormOperator;
  /** 租戶乙:自己沒有任何項目。 */
  let staffB: FormOperator;
  /** 租戶甲:只有表單模組,讀不到來源。 */
  let formOnlyA: FormOperator;
  let topLatest: Types.ObjectId;
  let topOlder: Types.ObjectId;
  let hiddenOwn: Types.ObjectId;
  let deptStaffOwn: Types.ObjectId;

  async function insertItem(item: {
    orgId: Types.ObjectId;
    tenantId: Types.ObjectId;
    name: string;
    createdBy: Types.ObjectId | null;
    rank: number;
    enabled?: boolean;
  }): Promise<Types.ObjectId> {
    const now = new Date();
    const { insertedId } = await api.connection
      .collection(PROJECT_FIXTURE_ITEMS_COLLECTION)
      .insertOne({
        code: null,
        enabled: true,
        ...item,
        moduleKey: PROJECT_FIXTURE_MODULE_KEY,
        createdAt: now,
        updatedAt: now,
        updatedBy: null,
        deletedAt: null,
      });
    return insertedId;
  }

  const lookupDefault = async (
    operator: FormOperator,
    fieldKey: string,
    filterValues: Record<string, unknown>,
  ) => {
    const data = await ok<DefaultData>(
      api,
      operator.token,
      FORM_LOOKUP_DEFAULT,
      { input: { formKey: FORM, version: 1, fieldKey, filterValues } },
    );
    return data.formLookupDefault.record;
  };

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-lookup-default");
    await seedProjectFixtureAuthorization(api.connection);
    root = await rootToken(api);
    tenantA = await createOrg(api.connection, { name: "租戶甲" });
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
    const viewer = [M.view, M.create, PROJECT_FIXTURE_PERMISSIONS.view];
    staffA = await createOperator(api, api.connection, {
      orgId: tenantA,
      moduleKeys,
      permissionKeys: viewer,
    });
    deptStaff = await createOperator(api, api.connection, {
      orgId: dept1,
      ownerOrgId: tenantA,
      moduleKeys,
      permissionKeys: viewer,
    });
    staffB = await createOperator(api, api.connection, {
      orgId: tenantB,
      moduleKeys,
      permissionKeys: viewer,
    });
    formOnlyA = await createOperator(api, api.connection, {
      orgId: tenantA,
      permissionKeys: [M.view, M.create],
    });

    // 租戶甲頂層的人:租戶甲兩筆(取 rank 大的)、停用的一筆(固定條件排除)、部門一一筆(rank 大但看不到)
    topOlder = await insertItem({
      orgId: tenantA,
      tenantId: tenantA,
      name: "甲的舊項目",
      createdBy: staffA.userId,
      rank: 1,
    });
    topLatest = await insertItem({
      orgId: tenantA,
      tenantId: tenantA,
      name: "甲的新項目",
      createdBy: staffA.userId,
      rank: 5,
    });
    await insertItem({
      orgId: tenantA,
      tenantId: tenantA,
      name: "甲的停用項目",
      createdBy: staffA.userId,
      rank: 9,
      enabled: false,
    });
    hiddenOwn = await insertItem({
      orgId: dept1,
      tenantId: tenantA,
      name: "甲在部門一的項目",
      createdBy: staffA.userId,
      rank: 7,
    });
    // 別人的(不是自己的不帶)
    await insertItem({
      orgId: tenantA,
      tenantId: tenantA,
      name: "別人的項目",
      createdBy: formOnlyA.userId,
      rank: 99,
    });
    // 部門一的人:部門二那筆(看不到)rank 最大、部門一那筆較小
    await insertItem({
      orgId: dept2,
      tenantId: tenantA,
      name: "部門二的項目",
      createdBy: deptStaff.userId,
      rank: 50,
    });
    deptStaffOwn = await insertItem({
      orgId: dept1,
      tenantId: tenantA,
      name: "部門一的項目",
      createdBy: deptStaff.userId,
      rank: 2,
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("建草稿:依條件(預設值的組織)取自己最新的一筆並補 label;停用的、別人的、看不到的不算", async () => {
    const draft = await createDraft(api, staffA.token, FORM, {});
    expect(idOf(draft.values.site)).toBe(String(tenantA));
    expect(draft.values.mine).toEqual({
      id: String(topLatest),
      label: "甲的新項目",
    });
    // 沒有條件:部門一那筆 rank 較大但看不到 → 仍是租戶甲那筆
    expect(draft.values.any).toEqual({
      id: String(topLatest),
      label: "甲的新項目",
    });
  });

  it("建草稿:送來的值、碰過的欄位不覆蓋;條件欄位換了就照新的值取", async () => {
    const sent = await createDraft(api, staffA.token, FORM, {
      mine: { id: String(topOlder), label: null },
    });
    expect(idOf(sent.values.mine)).toBe(String(topOlder));

    // 條件換成部門一:自己在那裡的那筆看不到 → 空(不退回別的組織的)
    const otherSite = await createDraft(api, staffA.token, FORM, {
      site: { id: String(dept1), label: null },
    });
    expect(otherSite.values.mine ?? null).toBeNull();
    expect(idOf(otherSite.values.any)).toBe(String(topLatest));

    const touched = await ok<{
      createFormDraft: { submission: SubmissionRow };
    }>(
      api,
      staffA.token,
      /* GraphQL */ `
        mutation CreateFormDraft($input: CreateFormDraftInput!) {
          createFormDraft(input: $input) {
            submission {
              values
            }
          }
        }
      `,
      {
        input: {
          formKey: FORM,
          clientRequestId: `touched-${String(Date.now())}`,
          values: {},
          touched: ["mine"],
        },
      },
    );
    expect(touched.createFormDraft.submission.values.mine ?? null).toBeNull();
  });

  it("看不到的不帶:可見範圍外自己的那筆不算;沒有自己的、讀不到來源 → 空", async () => {
    const dept = await createDraft(api, deptStaff.token, FORM, {});
    expect(idOf(dept.values.site)).toBe(String(dept1));
    expect(idOf(dept.values.mine)).toBe(String(deptStaffOwn));
    expect(idOf(dept.values.any)).toBe(String(deptStaffOwn));

    const none = await createDraft(api, staffB.token, FORM, {});
    expect(none.values.mine ?? null).toBeNull();
    expect(none.values.any ?? null).toBeNull();
  });

  it("formLookupDefault:照目前的條件值查;條件沒填、看不到、讀不到來源、欄位不是來源提供的預設 → null", async () => {
    expect(
      await lookupDefault(staffA, "mine", { site: String(tenantA) }),
    ).toEqual({ id: String(topLatest), label: "甲的新項目" });
    expect(
      await lookupDefault(deptStaff, "mine", { site: String(dept1) }),
    ).toEqual({ id: String(deptStaffOwn), label: "部門一的項目" });
    expect(
      await lookupDefault(staffA, "mine", { site: String(dept1) }),
    ).toBeNull();
    expect(await lookupDefault(staffA, "mine", {})).toBeNull();
    // 部門二那筆是自己的,但看不到
    expect(
      await lookupDefault(deptStaff, "mine", { site: String(dept2) }),
    ).toBeNull();
    expect(
      await lookupDefault(formOnlyA, "mine", { site: String(tenantA) }),
    ).toBeNull();
    // 沒有條件:看不到的那筆(rank 較大)不會被挑中
    const any = await lookupDefault(staffA, "any", {});
    expect(any?.id).toBe(String(topLatest));
    expect(any?.id).not.toBe(String(hiddenOwn));
    expect(await lookupDefault(staffA, "site", {})).toBeNull();
  });

  it("檢查器:來源沒有宣告依操作者的預設值 → DEFAULT_PROVIDER_UNSUPPORTED", async () => {
    const other = "operator_default_checks";
    await ok(api, root, CREATE_FORM, {
      input: { key: other, moduleKey: MODULE_KEY, name: "檢查器" },
    });
    const check = async (provider: string) => {
      const result = await call<ValidationData>(api, root, VALIDATE_VERSION, {
        input: {
          formKey: other,
          ...definitionOf([
            field("title", "text"),
            field("item", "reference", {
              source: { provider, labelField: "name" },
              default: { kind: "provider" },
            }),
          ]),
        },
      });
      expect(result.errors).toBeUndefined();
      return result.data?.validateFormVersion.errors.map((error) => error.code);
    };
    expect(await check(PROJECT_FIXTURE_OWNED_LOOKUP_KEY)).toEqual([]);
    expect(await check(PROJECT_FIXTURE_LOOKUP_KEY)).toEqual([
      "DEFAULT_PROVIDER_UNSUPPORTED",
    ]);
  });
});
