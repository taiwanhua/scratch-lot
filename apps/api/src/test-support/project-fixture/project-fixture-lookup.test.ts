import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import {
  CREATE_FORM,
  FORM_LOOKUP,
  FORM_LOOKUP_RECORD,
  FORM_TEST_TIMEOUT_MS,
  type FormOperator,
  M,
  MODULE_KEY,
  SUBMIT,
  VALIDATE_VERSION,
  assignForm,
  call,
  codeOf,
  createDraft,
  createOperator,
  createSubmitted,
  definitionOf,
  extensionsOf,
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
import { PROJECT_FIXTURE_LOOKUP_KEY } from "./project-fixture-lookup";

/**
 * 只替換兩份專案登記來源(同 `project-fixture.test.ts`;TEST-07「專案功能與資料登記的整合驗收」):
 * 測試專案模組以 `LOOKUP_PROVIDER` 登記的來源經真 AppModule 收進 lookup 登錄表。
 */
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

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

const FORM_LOOKUP_PROVIDERS = /* GraphQL */ `
  query FormLookupProviders {
    formLookupProviders {
      items {
        key
        name
        isBase
        labelField
        valueField
        filterFields
        fields {
          key
          type
          label
        }
      }
      totalCount
    }
  }
`;

interface ProvidersData {
  formLookupProviders: {
    items: {
      key: string;
      name: string;
      isBase: boolean;
      labelField: string;
      valueField: string;
      filterFields: string[];
      fields: { key: string; type: string; label: string | null }[];
    }[];
    totalCount: number;
  };
}

interface LookupData {
  formLookup: {
    items: { id: string; label: string; values: Record<string, unknown> }[];
    totalCount: number;
  };
}

interface ValidationData {
  validateFormVersion: { errors: { code: string }[] };
}

const FORM = "project_lookup_form";

/** 引用測試專案來源的表單定義。 */
const definitionWith = (provider: string) =>
  definitionOf([
    field("title", "text"),
    field("item", "reference", {
      source: { provider, labelField: "name" },
    }),
  ]);

describe("專案登記的 lookup 來源:設計器清單、檢查器登錄表、執行時的租戶隔離", () => {
  let api: AuthTestApp;
  let root: string;
  let tenantA: Types.ObjectId;
  let tenantB: Types.ObjectId;
  /** 租戶甲:表單模組 + 測試專案模組的檢視。 */
  let staffA: FormOperator;
  /** 租戶乙:同上。 */
  let staffB: FormOperator;
  /** 租戶甲:只有表單模組,沒有測試專案模組的檢視(來源本身要的權限)。 */
  let formOnlyA: FormOperator;
  let itemA: Types.ObjectId;
  let itemB: Types.ObjectId;

  async function insertItem(
    tenant: Types.ObjectId,
    name: string,
  ): Promise<Types.ObjectId> {
    const now = new Date();
    const { insertedId } = await api.connection
      .collection(PROJECT_FIXTURE_ITEMS_COLLECTION)
      .insertOne({
        name,
        orgId: tenant,
        tenantId: tenant,
        moduleKey: PROJECT_FIXTURE_MODULE_KEY,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });
    return insertedId;
  }

  const lookup = (token: string, keyword: string | null = null) =>
    call<LookupData>(api, token, FORM_LOOKUP, {
      input: {
        formKey: FORM,
        version: 1,
        target: { fieldKey: "item" },
        keyword,
      },
    });

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-project-lookup");
    await seedProjectFixtureAuthorization(api.connection);
    root = await rootToken(api);
    tenantA = await createOrg(api.connection, { name: "租戶甲" });
    tenantB = await createOrg(api.connection, { name: "租戶乙" });

    await publishNewForm(
      api,
      root,
      FORM,
      definitionWith(PROJECT_FIXTURE_LOOKUP_KEY),
    );
    await assignForm(api, root, FORM, [tenantA, tenantB]);

    const role = {
      moduleKeys: [MODULE_KEY, PROJECT_FIXTURE_MODULE_KEY],
      permissionKeys: [M.view, M.create, PROJECT_FIXTURE_PERMISSIONS.view],
    };
    staffA = await createOperator(api, api.connection, {
      orgId: tenantA,
      ...role,
    });
    staffB = await createOperator(api, api.connection, {
      orgId: tenantB,
      ...role,
    });
    formOnlyA = await createOperator(api, api.connection, {
      orgId: tenantA,
      permissionKeys: [M.view, M.create],
    });

    itemA = await insertItem(tenantA, "甲的遊戲");
    await insertItem(tenantA, "甲的商店");
    itemB = await insertItem(tenantB, "乙的遊戲");
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("設計器的來源清單:底座三種在前,接著專案來源(含宣告的欄位與預設顯示欄)", async () => {
    const data = await ok<ProvidersData>(api, root, FORM_LOOKUP_PROVIDERS);
    const { items, totalCount } = data.formLookupProviders;
    expect(items.map((item) => [item.key, item.isBase])).toEqual([
      ["user", true],
      ["org", true],
      ["form_submission", true],
      [PROJECT_FIXTURE_LOOKUP_KEY, false],
    ]);
    expect(totalCount).toBe(4);
    expect(items[3]).toEqual({
      key: PROJECT_FIXTURE_LOOKUP_KEY,
      name: "測試專案項目",
      isBase: false,
      labelField: "name",
      valueField: "id",
      filterFields: [],
      fields: [
        { key: "name", type: "text", label: "名稱" },
        { key: "orgId", type: "text", label: "組織" },
      ],
    });
  });

  it("檢查器的登錄表含專案來源:引用它的定義可發布,未登錄的 key 仍擋", async () => {
    // beforeAll 已發布引用專案來源的定義;另一張表單驗未登錄的來源
    const other = "project_lookup_unknown";
    await ok(api, root, CREATE_FORM, {
      input: { key: other, moduleKey: MODULE_KEY, name: "未登錄來源" },
    });
    const check = (provider: string) =>
      ok<ValidationData>(api, root, VALIDATE_VERSION, {
        input: { formKey: other, ...definitionWith(provider) },
      });
    const known = await check(PROJECT_FIXTURE_LOOKUP_KEY);
    expect(known.validateFormVersion.errors).toEqual([]);
    const unknown = await check("fixture_unknown");
    expect(
      unknown.validateFormVersion.errors.map((error) => error.code),
    ).toContain("LOOKUP_UNKNOWN_PROVIDER");
  });

  it("查詢套用租戶隔離:各租戶只查得到自己的資料", async () => {
    const a = await lookup(staffA.token);
    expect(a.errors).toBeUndefined();
    expect(a.data?.formLookup.items.map((item) => item.label)).toEqual([
      "甲的商店",
      "甲的遊戲",
    ]);
    const b = await lookup(staffB.token);
    expect(b.data?.formLookup.items.map((item) => item.label)).toEqual([
      "乙的遊戲",
    ]);
  });

  it("關鍵字只在自己租戶內比對;別租戶的 id 依值取回查無", async () => {
    const found = await lookup(staffA.token, "遊戲");
    expect(found.data?.formLookup.items.map((item) => item.id)).toEqual([
      String(itemA),
    ]);
    const record = await call<{ formLookupRecord: { record: unknown } }>(
      api,
      staffA.token,
      FORM_LOOKUP_RECORD,
      {
        input: {
          formKey: FORM,
          version: 1,
          target: { fieldKey: "item" },
          id: String(itemB),
        },
      },
    );
    expect(record.errors).toBeUndefined();
    expect(record.data?.formLookupRecord.record).toBeNull();
  });

  it("送出時重驗引用:自己租戶的寫快照,別租戶的 SOURCE_UNAVAILABLE", async () => {
    const submitted = await createSubmitted(api, staffA.token, FORM, {
      title: "引用自己的",
      item: { id: String(itemA), label: "前端給的名字" },
    });
    expect(submitted.values.item).toEqual({
      id: String(itemA),
      label: "甲的遊戲",
    });
    const draft = await createDraft(api, staffA.token, FORM, {
      title: "引用別租戶的",
      item: String(itemB),
    });
    const result = await call(api, staffA.token, SUBMIT, {
      input: { id: draft.id, expectedEditVersion: draft.editVersion },
    });
    expect(codeOf(result)).toBe("VALIDATION_FAILED");
    expect(extensionsOf(result).fieldErrors).toContainEqual(
      expect.objectContaining({ fieldKey: "item", code: "SOURCE_UNAVAILABLE" }),
    );
  });

  it("沒有來源要求的權限(測試專案模組的檢視)→ 查無", async () => {
    const result = await lookup(formOnlyA.token);
    expect(result.errors).toBeUndefined();
    expect(result.data?.formLookup).toEqual({ items: [], totalCount: 0 });
  });

  it("租戶的已刪資料不列", async () => {
    const deleted = await insertItem(tenantA, "甲的已刪項目");
    await api.connection
      .collection(PROJECT_FIXTURE_ITEMS_COLLECTION)
      .updateOne({ _id: deleted }, { $set: { deletedAt: new Date() } });
    const result = await lookup(staffA.token, "已刪");
    expect(result.data?.formLookup.totalCount).toBe(0);
  });
});
