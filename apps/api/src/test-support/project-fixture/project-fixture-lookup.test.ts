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
import {
  PROJECT_FIXTURE_CODE_LOOKUP_KEY,
  PROJECT_FIXTURE_LOOKUP_KEY,
  PROJECT_FIXTURE_SHARED_LOOKUP_KEY,
} from "./project-fixture-lookup";

/**
 * 只替換三份專案登記來源(TEST-07「專案功能與資料登記的整合驗收」):功能清單、資料登記與 lookup 來源
 * 的固定入口 `project/lookup-providers.ts`;經真 AppModule / DatabaseModule 收進 lookup 登錄表。
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
// lookup 來源只放測試專案的(不併入引用專案自己登記的來源):來源清單的斷言要與專案無關
jest.mock("../../project/lookup-providers", () => {
  const fixture = jest.requireActual<typeof import("./project-fixture-lookup")>(
    "./project-fixture-lookup",
  );
  return {
    PROJECT_LOOKUP_PROVIDERS: fixture.PROJECT_FIXTURE_LOOKUP_PROVIDERS,
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

interface LookupItem {
  id: string;
  label: string;
  values: Record<string, unknown>;
}

interface LookupData {
  formLookup: { items: LookupItem[]; totalCount: number };
}

interface ValidationData {
  validateFormVersion: { errors: { code: string; location: unknown }[] };
}

const FORM = "project_lookup_form";
const PROVIDER = PROJECT_FIXTURE_LOOKUP_KEY;

/** 引用測試專案來源的各種用法:引用(含受保護欄位的模板)、lookup 選項(值欄受保護)、固定條件、帶入。 */
const formDefinition = (): FormDefinition =>
  definitionOf(
    [
      field("title", "text"),
      field("item", "reference", {
        source: {
          provider: PROVIDER,
          labelField: "name",
          labelTemplate: "{{name}}({{code}})",
        },
      }),
      field("memo", "text"),
      field("pick", "select", {
        options: {
          kind: "lookup",
          source: {
            provider: PROVIDER,
            labelField: "name",
            valueField: "code",
          },
        },
      }),
      field("active_item", "reference", {
        source: {
          provider: PROVIDER,
          labelField: "name",
          // `orgId` 不在 filterFields:不套也不放寬
          filter: { enabled: true, orgId: "000000000000000000000000" },
        },
      }),
      field("by_code", "reference", {
        source: {
          provider: PROJECT_FIXTURE_CODE_LOOKUP_KEY,
          labelField: "name",
        },
      }),
    ],
    {
      prefills: [
        {
          label: "從項目帶入",
          source: { provider: PROVIDER, labelField: "name" },
          mapping: [{ fieldKey: "memo", sourceField: "code" }],
        },
      ],
    },
  );

describe("專案登記的 lookup 來源:設計器清單、檢查器、租戶隔離與欄位權限", () => {
  let api: AuthTestApp;
  let root: string;
  let tenantA: Types.ObjectId;
  let tenantB: Types.ObjectId;
  /** 租戶甲頂層:表單模組 + 測試專案模組的檢視(讀不到 `code`)。 */
  let staffA: FormOperator;
  /** 租戶甲頂層:另有 `delete`(讀得到受保護的 `code`)。 */
  let holderA: FormOperator;
  /** 租戶乙:同 staffA。 */
  let staffB: FormOperator;
  /** 租戶甲的部門一(租戶可見範圍 = own):只看得到部門一。 */
  let deptStaff: FormOperator;
  /** 租戶甲:只有表單模組,沒有來源要求的權限。 */
  let formOnlyA: FormOperator;
  let gameA: Types.ObjectId;
  let gameB: Types.ObjectId;

  async function insertItem(
    orgId: Types.ObjectId,
    tenantId: Types.ObjectId,
    item: { name: string; code?: string; enabled?: boolean },
  ): Promise<Types.ObjectId> {
    const now = new Date();
    const { insertedId } = await api.connection
      .collection(PROJECT_FIXTURE_ITEMS_COLLECTION)
      .insertOne({
        code: null,
        enabled: true,
        rank: 0,
        ...item,
        orgId,
        tenantId,
        moduleKey: PROJECT_FIXTURE_MODULE_KEY,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });
    return insertedId;
  }

  const lookup = (
    token: string,
    target: Record<string, unknown>,
    keyword: string | null = null,
  ) =>
    call<LookupData>(api, token, FORM_LOOKUP, {
      input: { formKey: FORM, version: 1, target, keyword },
    });

  const labelsOf = async (
    token: string,
    target: Record<string, unknown>,
    keyword: string | null = null,
  ): Promise<string[]> => {
    const result = await lookup(token, target, keyword);
    expect(result.errors).toBeUndefined();
    return result.data?.formLookup.items.map((item) => item.label) ?? [];
  };

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-project-lookup");
    await seedProjectFixtureAuthorization(api.connection);
    root = await rootToken(api);
    tenantA = await createOrg(api.connection, { name: "租戶甲" });
    tenantB = await createOrg(api.connection, { name: "租戶乙" });
    const dept1 = await createOrg(api.connection, {
      name: "部門一",
      parentId: tenantA,
    });
    const dept2 = await createOrg(api.connection, {
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
    holderA = await createOperator(api, api.connection, {
      orgId: tenantA,
      moduleKeys,
      permissionKeys: [...viewer, PROJECT_FIXTURE_PERMISSIONS.delete],
    });
    staffB = await createOperator(api, api.connection, {
      orgId: tenantB,
      moduleKeys,
      permissionKeys: viewer,
    });
    deptStaff = await createOperator(api, api.connection, {
      orgId: dept1,
      ownerOrgId: tenantA,
      moduleKeys,
      permissionKeys: viewer,
    });
    formOnlyA = await createOperator(api, api.connection, {
      orgId: tenantA,
      permissionKeys: [M.view, M.create],
    });

    gameA = await insertItem(tenantA, tenantA, {
      name: "甲的遊戲",
      code: "G-1",
    });
    await insertItem(tenantA, tenantA, {
      name: "甲的商店",
      code: "S-1",
      enabled: false,
    });
    await insertItem(dept1, tenantA, { name: "部門一的項目" });
    await insertItem(dept2, tenantA, { name: "部門二的項目" });
    gameB = await insertItem(tenantB, tenantB, { name: "乙的遊戲" });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("設計器的來源清單:底座三種在前,接著專案來源(含宣告的欄位、篩選欄位與預設顯示欄)", async () => {
    const data = await ok<ProvidersData>(api, root, FORM_LOOKUP_PROVIDERS);
    const { items, totalCount } = data.formLookupProviders;
    expect(items.map((item) => [item.key, item.isBase])).toEqual([
      ["user", true],
      ["org", true],
      ["form_submission", true],
      [PROJECT_FIXTURE_CODE_LOOKUP_KEY, false],
      [PROVIDER, false],
      [PROJECT_FIXTURE_SHARED_LOOKUP_KEY, false],
    ]);
    expect(totalCount).toBe(6);
    expect(items.find((item) => item.key === PROVIDER)).toEqual({
      key: PROVIDER,
      name: "測試專案項目",
      isBase: false,
      labelField: "name",
      valueField: "id",
      filterFields: ["enabled"],
      fields: [
        { key: "name", type: "text", label: "名稱" },
        { key: "code", type: "text", label: "代碼" },
        { key: "orgId", type: "text", label: "組織" },
        { key: "rank", type: "number", label: "排序" },
      ],
    });
  });

  it("檢查器的登錄表含專案來源;未登錄的 key 仍擋;值欄只能是 id 或文字欄位", async () => {
    // beforeAll 已發布引用專案來源的定義;另一張表單驗其餘情況
    const other = "project_lookup_checks";
    await ok(api, root, CREATE_FORM, {
      input: { key: other, moduleKey: MODULE_KEY, name: "檢查器" },
    });
    const check = async (provider: string, valueField?: string) => {
      const data = await ok<ValidationData>(api, root, VALIDATE_VERSION, {
        input: {
          formKey: other,
          ...definitionOf([
            field("title", "text"),
            field("pick", "select", {
              options: {
                kind: "lookup",
                source: {
                  provider,
                  labelField: "name",
                  ...(valueField === undefined ? {} : { valueField }),
                },
              },
            }),
          ]),
        },
      });
      return data.validateFormVersion.errors;
    };
    expect(await check(PROVIDER)).toEqual([]);
    expect(await check(PROVIDER, "code")).toEqual([]);
    const unknown = await check("fixture_unknown");
    expect(unknown.map((error) => error.code)).toEqual([
      "LOOKUP_UNKNOWN_PROVIDER",
    ]);
    expect(await check(PROVIDER, "rank")).toEqual([
      {
        code: "LOOKUP_UNKNOWN_FIELD",
        location: { fieldKey: "pick", property: "options.source" },
      },
    ]);
  });

  it("租戶隔離:各租戶只查得到自己的資料", async () => {
    expect(await labelsOf(staffA.token, { fieldKey: "item" })).toEqual([
      "甲的商店",
      "甲的遊戲",
    ]);
    expect(await labelsOf(staffB.token, { fieldKey: "item" })).toEqual([
      "乙的遊戲",
    ]);
  });

  it("同租戶的可見範圍:部門一的人只看得到部門一的資料", async () => {
    expect(await labelsOf(deptStaff.token, { fieldKey: "item" })).toEqual([
      "部門一的項目",
    ]);
  });

  it("別租戶的 id 依值取回查無;送出引用別租戶的 → SOURCE_UNAVAILABLE", async () => {
    const record = await call<{ formLookupRecord: { record: unknown } }>(
      api,
      staffA.token,
      FORM_LOOKUP_RECORD,
      {
        input: {
          formKey: FORM,
          version: 1,
          target: { fieldKey: "item" },
          id: String(gameB),
        },
      },
    );
    expect(record.errors).toBeUndefined();
    expect(record.data?.formLookupRecord.record).toBeNull();
    const draft = await createDraft(api, staffA.token, FORM, {
      title: "引用別租戶的",
      item: String(gameB),
    });
    const result = await call(api, staffA.token, SUBMIT, {
      input: { id: draft.id, expectedEditVersion: draft.editVersion },
    });
    expect(codeOf(result)).toBe("VALIDATION_FAILED");
    expect(extensionsOf(result).fieldErrors).toContainEqual(
      expect.objectContaining({ fieldKey: "item", code: "SOURCE_UNAVAILABLE" }),
    );
  });

  describe("受保護欄位(`code` 要 delete)", () => {
    it("讀不到的欄位從 values 省略;讀得到的照回", async () => {
      const target = { prefillIndex: 0 };
      const staff = await lookup(staffA.token, target, "遊戲");
      expect(staff.data?.formLookup.items[0]?.values).toEqual({});
      const holder = await lookup(holderA.token, target, "遊戲");
      expect(holder.data?.formLookup.items[0]?.values).toEqual({ code: "G-1" });
    });

    it("顯示模板引用它:讀不到的人退回顯示欄,讀得到的人看完整模板", async () => {
      expect(
        await labelsOf(staffA.token, { fieldKey: "item" }, "遊戲"),
      ).toEqual(["甲的遊戲"]);
      expect(
        await labelsOf(holderA.token, { fieldKey: "item" }, "遊戲"),
      ).toEqual(["甲的遊戲(G-1)"]);
    });

    it("快照不寫受保護的值:讀得到的人送出,快照仍只有公開欄位", async () => {
      const submitted = await createSubmitted(api, holderA.token, FORM, {
        title: "引用自己的",
        item: { id: String(gameA), label: "前端給的名字" },
      });
      expect(submitted.values.item).toEqual({
        id: String(gameA),
        label: "甲的遊戲",
      });
    });

    it("關鍵字不比對讀不到的欄位", async () => {
      expect(await labelsOf(staffA.token, { fieldKey: "item" }, "G-1")).toEqual(
        [],
      );
      expect(
        await labelsOf(holderA.token, { fieldKey: "item" }, "G-1"),
      ).toEqual(["甲的遊戲(G-1)"]);
    });

    it("關鍵字欄位全都讀不到 → 查無(不退回列全部)", async () => {
      expect(
        await labelsOf(staffA.token, { fieldKey: "by_code" }, "G"),
      ).toEqual([]);
      expect(
        await labelsOf(holderA.token, { fieldKey: "by_code" }, "G"),
      ).toEqual(["甲的遊戲"]);
    });

    it("受保護的值欄反查:讀不到的人送出 → OPTION_INVALID;讀得到的人可送", async () => {
      const draft = await createDraft(api, staffA.token, FORM, {
        title: "選代碼",
        pick: "G-1",
      });
      const result = await call(api, staffA.token, SUBMIT, {
        input: { id: draft.id, expectedEditVersion: draft.editVersion },
      });
      expect(codeOf(result)).toBe("VALIDATION_FAILED");
      expect(extensionsOf(result).fieldErrors).toContainEqual(
        expect.objectContaining({ fieldKey: "pick", code: "OPTION_INVALID" }),
      );
      const submitted = await createSubmitted(api, holderA.token, FORM, {
        title: "選代碼",
        pick: "G-1",
      });
      expect(submitted.values.pick).toEqual({
        value: "G-1",
        label: "甲的遊戲",
      });
    });
  });

  it("固定條件只套 filterFields 裡的欄位:enabled 生效,orgId 不套", async () => {
    expect(await labelsOf(staffA.token, { fieldKey: "active_item" })).toEqual([
      "甲的遊戲",
    ]);
  });

  it("沒有來源要求的權限(測試專案模組的檢視)→ 查無", async () => {
    const result = await lookup(formOnlyA.token, { fieldKey: "item" });
    expect(result.errors).toBeUndefined();
    expect(result.data?.formLookup).toEqual({ items: [], totalCount: 0 });
  });

  it("已軟刪的資料不列", async () => {
    const deleted = await insertItem(tenantA, tenantA, {
      name: "甲的已刪項目",
    });
    await api.connection
      .collection(PROJECT_FIXTURE_ITEMS_COLLECTION)
      .updateOne({ _id: deleted }, { $set: { deletedAt: new Date() } });
    expect(await labelsOf(staffA.token, { fieldKey: "item" }, "已刪")).toEqual(
      [],
    );
  });
});
