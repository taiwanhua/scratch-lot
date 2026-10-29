import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import {
  type AuthTestApp,
  ROOT_ADMIN,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import { createOrg } from "../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import {
  CATEGORY_OPS_MODULES,
  FIELD_PERMISSIONS,
  MANAGE_CATEGORIES,
  createFieldManager,
  findCategoryId,
  login,
} from "./test-support/fixtures";

const CATEGORY_FIELDS = /* GraphQL */ `
  fragment CategoryFields on FieldCategory {
    id
    key
    name
    description
    isSystem
    enabled
  }
`;

const FIELD_CATEGORIES = /* GraphQL */ `
  ${CATEGORY_FIELDS}
  query FieldCategories($input: FieldCategoriesInput) {
    fieldCategories(input: $input) {
      items {
        ...CategoryFields
      }
      totalCount
    }
  }
`;

const CREATE = /* GraphQL */ `
  ${CATEGORY_FIELDS}
  mutation CreateFieldCategory($input: CreateFieldCategoryInput!) {
    createFieldCategory(input: $input) {
      category {
        ...CategoryFields
      }
    }
  }
`;

const UPDATE = /* GraphQL */ `
  ${CATEGORY_FIELDS}
  mutation UpdateFieldCategory($input: UpdateFieldCategoryInput!) {
    updateFieldCategory(input: $input) {
      category {
        ...CategoryFields
      }
    }
  }
`;

const SET_ENABLED = /* GraphQL */ `
  ${CATEGORY_FIELDS}
  mutation SetFieldCategoryEnabled($input: SetFieldCategoryEnabledInput!) {
    setFieldCategoryEnabled(input: $input) {
      category {
        ...CategoryFields
      }
    }
  }
`;

interface CategoryRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  enabled: boolean;
}

interface ListData {
  fieldCategories: { items: CategoryRow[]; totalCount: number };
}

interface CreateData {
  createFieldCategory: { category: CategoryRow };
}

interface UpdateData {
  updateFieldCategory: { category: CategoryRow };
}

interface SetEnabledData {
  setFieldCategoryEnabled: { category: CategoryRow };
}

interface AuditRecord {
  action: string;
  targetType?: string;
  targetId?: Types.ObjectId;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/**
 * 欄位類別的類別作業(新增 / 改名 / 停用;`manage-categories` + 站在根組織)。
 * 打真的 GraphQL 端點、對真 MongoDB(TEST-07)。規則正本:docs/modules/field-manager.md。
 */
describe("欄位類別:root 新增 / 改名 / 停用(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;

  let rootToken: string;
  let rootManagerToken: string;
  let rootViewerToken: string;
  let tenantManagerToken: string;
  let genderCategoryId: Types.ObjectId;

  async function list(
    token: string,
    input?: { enabledOnly?: boolean },
  ): Promise<CategoryRow[]> {
    const result = await api.graphql<ListData>(
      FIELD_CATEGORIES,
      input === undefined ? {} : { input },
      { accessToken: token },
    );
    expect(result.errors).toBeUndefined();
    if (!result.data) {
      throw new Error("fieldCategories 沒有回資料");
    }
    expect(result.data.fieldCategories.totalCount).toBe(
      result.data.fieldCategories.items.length,
    );
    return result.data.fieldCategories.items;
  }

  async function create(token: string, input: Record<string, unknown>) {
    return api.graphql<CreateData>(CREATE, { input }, { accessToken: token });
  }

  async function mustCreate(key: string, name: string): Promise<CategoryRow> {
    const result = await create(rootToken, { key, name });
    expect(result.errors).toBeUndefined();
    const category = result.data?.createFieldCategory.category;
    if (!category) {
      throw new Error(`建類別失敗:${key}`);
    }
    return category;
  }

  function latestAudit(action: string): Promise<AuditRecord | null> {
    return connection
      .collection("audit_logs")
      .findOne<AuditRecord>({ action }, { sort: { createdAt: -1, _id: -1 } });
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-field-categories");
    connection = api.connection;
    await connection
      .collection("field_categories")
      .createIndex({ key: 1 }, { unique: true });

    const rootOrg = await connection
      .collection("orgs")
      .findOne<{ _id: Types.ObjectId }>({ key: "root" });
    if (!rootOrg) {
      throw new Error("測試資料庫沒有根組織(seed 未跑?)");
    }
    const tenant = await createOrg(connection, { name: "租戶甲" });
    genderCategoryId = await findCategoryId(connection, "gender");

    rootToken = await login(api, ROOT_ADMIN.account, ROOT_ADMIN.password);
    // 根組織裡持 manage-categories 的一般角色(不是超級管理員)
    rootManagerToken = await createFieldManager(
      api,
      connection,
      rootOrg._id,
      [...FIELD_PERMISSIONS, MANAGE_CATEGORIES],
      CATEGORY_OPS_MODULES,
    );
    rootViewerToken = await createFieldManager(api, connection, rootOrg._id);
    // 租戶裡被(越權地)綁上同一筆權限:站的位置不對,照樣拒絕
    tenantManagerToken = await createFieldManager(
      api,
      connection,
      tenant,
      [...FIELD_PERMISSIONS, MANAGE_CATEGORIES],
      CATEGORY_OPS_MODULES,
    );
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("fieldCategories 回 isSystem / enabled:種子的兩個類別是系統類別、啟用", async () => {
    const rows = await list(tenantManagerToken);
    expect(rows.slice(0, 2)).toEqual([
      expect.objectContaining({
        key: "gender",
        isSystem: true,
        enabled: true,
      }),
      expect.objectContaining({
        key: "demo-category",
        isSystem: true,
        enabled: true,
      }),
    ]);
  });

  describe("新增", () => {
    it("root 新增類別:isSystem false、enabled true,排在系統類別之後,所有人的清單都看得到;記稽核", async () => {
      const result = await create(rootManagerToken, {
        key: "cuisine",
        name: " 料理類型 ",
        description: "菜色分類",
      });
      expect(result.errors).toBeUndefined();
      const category = result.data?.createFieldCategory.category;
      expect(category).toMatchObject({
        key: "cuisine",
        name: "料理類型",
        description: "菜色分類",
        isSystem: false,
        enabled: true,
      });

      const rows = await list(tenantManagerToken);
      expect(rows.slice(0, 5).map((row) => row.key)).toEqual([
        "gender",
        "demo-category",
        "reprint-reason",
        "void-reason",
        "cuisine",
      ]);

      const audit = await latestAudit("field-category.create");
      expect(audit).toMatchObject({
        targetType: "field-category",
        after: { key: "cuisine", name: "料理類型" },
      });
      expect(String(audit?.targetId)).toBe(category?.id);
    });

    it("key 格式不符 → VALIDATION_FAILED 標在 key;與既有類別同 key(含系統類別)→ FIELD_CATEGORY_KEY_DUPLICATE", async () => {
      for (const key of ["Cuisine", "demo_category", "a.b", ""]) {
        const invalid = await create(rootToken, { key, name: "x" });
        expect(invalid.errors?.[0]?.extensions).toMatchObject({
          code: "VALIDATION_FAILED",
          fields: ["key"],
        });
      }
      const blankName = await create(rootToken, { key: "blank", name: "  " });
      expect(blankName.errors?.[0]?.extensions).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["name"],
      });
      for (const key of ["gender", "cuisine"]) {
        const duplicate = await create(rootToken, { key, name: "重複" });
        expect(duplicate.errors?.[0]?.extensions).toMatchObject({
          code: "FIELD_CATEGORY_KEY_DUPLICATE",
          fields: ["key"],
        });
      }
    });
  });

  describe("改名 / 說明", () => {
    it("改名稱與說明;description 缺席 = 不動、null = 清空;記稽核", async () => {
      const category = await mustCreate("flavor", "口味");
      const renamed = await api.graphql<UpdateData>(
        UPDATE,
        { input: { id: category.id, name: "口味偏好", description: "鹹甜" } },
        { accessToken: rootToken },
      );
      expect(renamed.errors).toBeUndefined();
      expect(renamed.data?.updateFieldCategory.category).toMatchObject({
        key: "flavor",
        name: "口味偏好",
        description: "鹹甜",
      });

      const untouched = await api.graphql<UpdateData>(
        UPDATE,
        { input: { id: category.id, name: "口味" } },
        { accessToken: rootToken },
      );
      expect(untouched.data?.updateFieldCategory.category.description).toBe(
        "鹹甜",
      );

      const cleared = await api.graphql<UpdateData>(
        UPDATE,
        { input: { id: category.id, description: null } },
        { accessToken: rootToken },
      );
      expect(cleared.data?.updateFieldCategory.category).toMatchObject({
        name: "口味",
        description: null,
      });
      expect(await latestAudit("field-category.update")).toMatchObject({
        targetType: "field-category",
        before: { description: "鹹甜" },
        after: { description: null },
      });
    });

    it("系統類別唯讀:改名 → FORBIDDEN + reason SYSTEM_CATEGORY;key 不在 input 內,送 key 一律被 schema 擋下", async () => {
      const renamed = await api.graphql<UpdateData>(
        UPDATE,
        { input: { id: String(genderCategoryId), name: "性別(改)" } },
        { accessToken: rootToken },
      );
      expect(renamed.errors?.[0]?.extensions).toMatchObject({
        code: "FORBIDDEN",
        reason: "SYSTEM_CATEGORY",
      });

      const withKey = await api.graphql<UpdateData>(
        UPDATE,
        { input: { id: String(genderCategoryId), key: "sex" } },
        { accessToken: rootToken },
      );
      expect(withKey.errors).toBeDefined();
      const stored = await connection
        .collection("field_categories")
        .findOne<{ key: string; name: string }>({ _id: genderCategoryId });
      expect(stored).toMatchObject({ key: "gender", name: "性別" });
    });

    it("不存在的類別 → NOT_FOUND;id 格式不對 → VALIDATION_FAILED", async () => {
      const missing = await api.graphql<UpdateData>(
        UPDATE,
        { input: { id: "0123456789abcdef01234567", name: "x" } },
        { accessToken: rootToken },
      );
      expect(missing.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");
      const malformed = await api.graphql<UpdateData>(
        UPDATE,
        { input: { id: "nope", name: "x" } },
        { accessToken: rootToken },
      );
      expect(malformed.errors?.[0]?.extensions?.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("停用 / 啟用", () => {
    it("停用 root 建的類別:設計器用的 enabledOnly 清單不列,欄位管理頁的清單仍列(標 enabled false);可再啟用;記稽核", async () => {
      const category = await mustCreate("occasion", "場合");
      const disabled = await api.graphql<SetEnabledData>(
        SET_ENABLED,
        { input: { id: category.id, enabled: false } },
        { accessToken: rootManagerToken },
      );
      expect(disabled.errors).toBeUndefined();
      expect(disabled.data?.setFieldCategoryEnabled.category.enabled).toBe(
        false,
      );

      const designerRows = await list(tenantManagerToken, {
        enabledOnly: true,
      });
      const designerKeys = designerRows.map((row) => row.key);
      expect(designerKeys).not.toContain("occasion");
      expect(designerKeys).toContain("gender");

      const all = await list(tenantManagerToken);
      expect(all.find((row) => row.key === "occasion")).toMatchObject({
        enabled: false,
      });

      expect(await latestAudit("field-category.set-enabled")).toMatchObject({
        targetType: "field-category",
        before: { enabled: true },
        after: { enabled: false },
      });

      const enabled = await api.graphql<SetEnabledData>(
        SET_ENABLED,
        { input: { id: category.id, enabled: true } },
        { accessToken: rootToken },
      );
      expect(enabled.data?.setFieldCategoryEnabled.category.enabled).toBe(true);
      const enabledRows = await list(rootToken, { enabledOnly: true });
      expect(enabledRows.map((row) => row.key)).toContain("occasion");
    });

    it("系統類別不可停用 → FORBIDDEN + reason SYSTEM_CATEGORY;啟用(維持啟用)照常", async () => {
      const result = await api.graphql<SetEnabledData>(
        SET_ENABLED,
        { input: { id: String(genderCategoryId), enabled: false } },
        { accessToken: rootToken },
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "FORBIDDEN",
        reason: "SYSTEM_CATEGORY",
      });
      const stored = await connection
        .collection("field_categories")
        .findOne<{ enabled: boolean }>({ _id: genderCategoryId });
      expect(stored?.enabled).toBe(true);

      const enable = await api.graphql<SetEnabledData>(
        SET_ENABLED,
        { input: { id: String(genderCategoryId), enabled: true } },
        { accessToken: rootToken },
      );
      expect(enable.errors).toBeUndefined();
    });
  });

  describe("停用中的系統類別與空操作", () => {
    it("認養時保留停用的系統類別:setFieldCategoryEnabled(true) 成功並記稽核", async () => {
      // seed 認養時 enabled 是初始 seed 值、保留原值:直接把一個系統類別改成停用模擬那個狀態
      const demoId = await findCategoryId(connection, "demo-category");
      await connection
        .collection("field_categories")
        .updateOne({ _id: demoId }, { $set: { enabled: false } });

      const result = await api.graphql<SetEnabledData>(
        SET_ENABLED,
        { input: { id: String(demoId), enabled: true } },
        { accessToken: rootToken },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data?.setFieldCategoryEnabled.category).toMatchObject({
        key: "demo-category",
        isSystem: true,
        enabled: true,
      });
      const audit = await latestAudit("field-category.set-enabled");
      expect(audit).toMatchObject({
        before: { enabled: false },
        after: { enabled: true },
      });
      expect(String(audit?.targetId)).toBe(String(demoId));
    });

    it("沒有實際變更(已是目標狀態、update 沒帶任何欄位)不寫稽核", async () => {
      const category = await mustCreate("noop", "空操作");
      const auditCount = () =>
        connection.collection("audit_logs").countDocuments({
          action: {
            $in: ["field-category.update", "field-category.set-enabled"],
          },
          targetId: new Types.ObjectId(category.id),
        });

      const sameState = await api.graphql<SetEnabledData>(
        SET_ENABLED,
        { input: { id: category.id, enabled: true } },
        { accessToken: rootToken },
      );
      expect(sameState.errors).toBeUndefined();
      const empty = await api.graphql<UpdateData>(
        UPDATE,
        { input: { id: category.id } },
        { accessToken: rootToken },
      );
      expect(empty.errors).toBeUndefined();
      expect(empty.data?.updateFieldCategory.category.name).toBe("空操作");
      expect(await auditCount()).toBe(0);
    });
  });

  describe("守門:manage-categories + 站在根組織", () => {
    it("租戶即使持有 manage-categories,三個 mutation 一律 FORBIDDEN(reason ROOT_ONLY),什麼都沒寫", async () => {
      const created = await create(tenantManagerToken, {
        key: "tenant-made",
        name: "租戶建的",
      });
      expect(created.errors?.[0]?.extensions).toMatchObject({
        code: "FORBIDDEN",
        reason: "ROOT_ONLY",
      });
      const renamed = await api.graphql<UpdateData>(
        UPDATE,
        { input: { id: String(genderCategoryId), name: "租戶改的" } },
        { accessToken: tenantManagerToken },
      );
      expect(renamed.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
      const toggled = await api.graphql<SetEnabledData>(
        SET_ENABLED,
        { input: { id: String(genderCategoryId), enabled: true } },
        { accessToken: tenantManagerToken },
      );
      expect(toggled.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");

      const rows = await list(rootToken);
      expect(rows.map((row) => row.key)).not.toContain("tenant-made");
      const gender = await connection
        .collection("field_categories")
        .findOne<{ name: string }>({ _id: genderCategoryId });
      expect(gender?.name).toBe("性別");
    });

    it("站在根組織但沒有 manage-categories → FORBIDDEN(權限守門)", async () => {
      const result = await create(rootViewerToken, {
        key: "no-permission",
        name: "沒權限",
      });
      expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    });
  });
});
