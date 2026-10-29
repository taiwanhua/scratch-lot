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
  type CreateFieldData,
  FIELD_CATEGORIES,
  type FieldRow,
  SET_FIELD_ENABLED,
  type SetFieldEnabledData,
  UPDATE_FIELD,
  createField,
  createFieldManager,
  customOf,
  findCategoryId,
  listFields,
  login,
} from "./test-support/fixtures";

interface FieldCategoriesData {
  fieldCategories: {
    items: { id: string; key: string; name: string }[];
    totalCount: number;
  };
}

interface UpdateFieldData {
  updateField: {
    field: {
      id: string;
      label: string;
      order: number;
      description: string | null;
    };
  };
}

/** `audit_logs` 的一筆(欄位正本 `database/schemas/audit-log.schema.ts`)。 */
interface AuditRecord {
  action: string;
  targetType?: string;
  targetId?: Types.ObjectId;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/**
 * 欄位管理(類別 / 合併清單 / 新增 / 編輯 / 停用 / 唯一索引 / 租戶隔離)。
 * 打真的 GraphQL 端點、對真 MongoDB(TEST-07);夾具沿用 auth / permission 的 test-support。
 *
 * 組織樹(root 為 seed 建的根組織):root ─┬─ 租戶甲  └─ 租戶乙 — 兩者互為兄弟,
 * 誰都不是誰的上層,所以看不到對方的自訂選項(規則表:看得到的是上層與可見範圍內的下層)。
 * **上層繼承 / 下層可見的六列規則表在 `field-visibility.test.ts`**。
 * 種子內容(field-manager.md「種子內容」):`gender` 4 個選項、`demo-category` 3 個。
 */
describe("欄位管理(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;

  let tenantA: Types.ObjectId;
  let tenantB: Types.ObjectId;
  let genderCategoryId: Types.ObjectId;
  let demoCategoryId: Types.ObjectId;

  let managerAToken: string;
  let managerBToken: string;
  let rootToken: string;

  /** 取合併清單裡符合條件的第一筆(找不到即測試前提壞了,直接拋)。 */
  async function findRow(
    token: string,
    categoryId: Types.ObjectId,
    predicate: (row: FieldRow) => boolean,
  ): Promise<FieldRow> {
    const rows = await listFields(api, token, categoryId);
    const found = rows.find((row) => predicate(row));
    if (!found) {
      throw new Error("合併清單裡找不到預期的選項");
    }
    return found;
  }

  function latestAudit(
    action: string,
    targetId?: Types.ObjectId,
  ): Promise<AuditRecord | null> {
    return connection
      .collection("audit_logs")
      .findOne<AuditRecord>(
        { action, ...(targetId ? { targetId } : {}) },
        { sort: { createdAt: -1, _id: -1 } },
      );
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-fields");
    connection = api.connection;
    // 測試連線自建與 field.schema.ts 同一組唯一索引:Mongoose 的 autoIndex 建在 app 自己的連線上、
    // 完成時點不保證;索引宣告本身由 database/schemas/indexes.schema.test.ts 鎖定。
    await connection
      .collection("fields")
      .createIndex({ categoryId: 1, orgId: 1, value: 1 }, { unique: true });

    tenantA = await createOrg(connection, { name: "租戶甲" });
    tenantB = await createOrg(connection, { name: "租戶乙" });
    genderCategoryId = await findCategoryId(connection, "gender");
    demoCategoryId = await findCategoryId(connection, "demo-category");

    managerAToken = await createFieldManager(api, connection, tenantA);
    managerBToken = await createFieldManager(api, connection, tenantB);
    rootToken = await login(api, ROOT_ADMIN.account, ROOT_ADMIN.password);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("讀", () => {
    it("fieldCategories 回種子的四個全域類別", async () => {
      const result = await api.graphql<FieldCategoriesData>(
        FIELD_CATEGORIES,
        {},
        { accessToken: managerAToken },
      );
      expect(result.errors).toBeUndefined();
      const keys = result.data?.fieldCategories.items.map((row) => row.key);
      expect(keys).toEqual([
        "gender",
        "demo-category",
        "reprint-reason",
        "void-reason",
      ]);
      expect(result.data?.fieldCategories.totalCount).toBe(4);
    });

    it("fields 回全域種子,依 order 排序、每筆 ownerOrg=null 且不可編輯", async () => {
      const rows = await listFields(api, managerAToken, genderCategoryId);
      expect(rows.map((row) => row.value)).toEqual([
        "male",
        "female",
        "other",
        "undisclosed",
      ]);
      expect(rows.every((row) => row.ownerOrg === null)).toBe(true);
      expect(rows.every((row) => !row.isOwn && !row.canEdit)).toBe(true);
      // 種子的 enabled 是全域開關:租戶視角一律不可切
      expect(rows.every((row) => !row.canToggleEnabled)).toBe(true);
      expect(rows.every((row) => row.enabled)).toBe(true);
    });

    it("沒有 view 權限 → FORBIDDEN", async () => {
      const token = await createFieldManager(api, connection, tenantA, [
        "system.field-manager.create",
      ]);
      const rows = await api.graphql(
        "query Fields($categoryId: ID!) { fields(categoryId: $categoryId) { totalCount } }",
        { categoryId: String(genderCategoryId) },
        { accessToken: token },
      );
      expect(rows.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    });
  });

  describe("新增自訂選項", () => {
    it("建立後出現在合併清單、ownerOrg = 當前組織、isOwn/canEdit 為真,並寫審計 field.create", async () => {
      const result = await createField(api, managerAToken, {
        categoryId: String(demoCategoryId),
        label: "甜點",
        value: "dessert",
        order: 4,
        description: "租戶甲自訂",
      });
      expect(result.errors).toBeUndefined();
      const created = (result.data as CreateFieldData | null)?.createField
        .field;
      expect(created).toMatchObject({
        label: "甜點",
        value: "dessert",
        order: 4,
        enabled: true,
        description: "租戶甲自訂",
        ownerOrg: { id: String(tenantA), name: "租戶甲" },
        isOwn: true,
        canEdit: true,
        canToggleEnabled: true,
      });

      const rows = await listFields(api, managerAToken, demoCategoryId);
      expect(rows.map((row) => row.value)).toEqual([
        "staple",
        "side-dish",
        "drink",
        "dessert",
      ]);
      expect(rows.at(-1)?.isOwn).toBe(true);

      const stored = await connection
        .collection("fields")
        .findOne<{ orgId: Types.ObjectId | null; isSystem: boolean }>({
          _id: new Types.ObjectId(created?.id),
        });
      expect(String(stored?.orgId)).toBe(String(tenantA));
      expect(stored?.isSystem).toBe(false);

      const audit = await latestAudit(
        "field.create",
        new Types.ObjectId(created?.id),
      );
      expect(audit).toMatchObject({
        action: "field.create",
        targetType: "field",
      });
    });

    it("同類別同組織重複 value → FIELD_VALUE_DUPLICATE", async () => {
      const result = await createField(api, managerAToken, {
        categoryId: String(demoCategoryId),
        label: "甜點(重複)",
        value: "dessert",
      });
      expect(result.errors?.[0]?.extensions?.code).toBe(
        "FIELD_VALUE_DUPLICATE",
      );
    });

    it("與同類別的全域選項同 value → FIELD_VALUE_DUPLICATE(唯一索引擋不到,由表單驗證擋)", async () => {
      const result = await createField(api, managerAToken, {
        categoryId: String(demoCategoryId),
        label: "主食(自訂)",
        value: "staple",
      });
      expect(result.errors?.[0]?.extensions?.code).toBe(
        "FIELD_VALUE_DUPLICATE",
      );
    });

    it("互不相干的兩個組織可以有同一個 value", async () => {
      const result = await createField(api, managerBToken, {
        categoryId: String(demoCategoryId),
        label: "甜點",
        value: "dessert",
      });
      expect(result.errors).toBeUndefined();
      expect(
        (result.data as CreateFieldData | null)?.createField.field.isOwn,
      ).toBe(true);
    });

    it("唯一索引擋下繞過表單驗證的重複(同 categoryId + orgId + value)", async () => {
      const now = new Date();
      await expect(
        connection.collection("fields").insertOne({
          categoryId: demoCategoryId,
          orgId: tenantA,
          label: "甜點(直接寫入)",
          value: "dessert",
          order: 9,
          enabled: true,
          isSystem: false,
          createdAt: now,
          updatedAt: now,
          createdBy: null,
          updatedBy: null,
          deletedAt: null,
        }),
      ).rejects.toMatchObject({ code: 11_000 });
    });

    it("查無類別 → NOT_FOUND;value 空白 → VALIDATION_FAILED", async () => {
      const missing = await createField(api, managerAToken, {
        categoryId: String(new Types.ObjectId()),
        label: "x",
        value: "x",
      });
      expect(missing.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");

      const blank = await createField(api, managerAToken, {
        categoryId: String(demoCategoryId),
        label: "x",
        value: " ".repeat(3),
      });
      expect(blank.errors?.[0]?.extensions?.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("編輯", () => {
    it("種子選項 → FORBIDDEN(reason SEED_READ_ONLY,只能 setFieldEnabled)", async () => {
      const seed = await findRow(
        managerAToken,
        genderCategoryId,
        (row) => row.value === "male",
      );
      const result = await api.graphql(
        UPDATE_FIELD,
        { input: { id: seed.id, label: "先生" } },
        { accessToken: managerAToken },
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "FORBIDDEN",
        reason: "SEED_READ_ONLY",
      });
    });

    it("自訂選項改得動 label / order / description,並寫審計 field.edit", async () => {
      const own = await findRow(
        managerAToken,
        demoCategoryId,
        (row) => row.isOwn,
      );
      const result = await api.graphql<UpdateFieldData>(
        UPDATE_FIELD,
        { input: { id: own.id, label: "點心", order: 7, description: null } },
        { accessToken: managerAToken },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data?.updateField.field).toMatchObject({
        label: "點心",
        order: 7,
        description: null,
      });

      const audit = await latestAudit("field.edit", new Types.ObjectId(own.id));
      expect(audit?.before).toMatchObject({ label: "甜點" });
      expect(audit?.after).toMatchObject({ label: "點心", order: 7 });
    });

    it("互不相干的組織的自訂選項 → NOT_FOUND(不在合併清單內)", async () => {
      const ownOfB = await findRow(
        managerBToken,
        demoCategoryId,
        (row) => row.isOwn,
      );
      const result = await api.graphql(
        UPDATE_FIELD,
        { input: { id: ownOfB.id, label: "被別人改" } },
        { accessToken: managerAToken },
      );
      expect(result.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");
    });
  });

  describe("停用 / 啟用", () => {
    it("自訂選項:自己這一層切得動,並寫審計 field.toggle-enabled", async () => {
      const own = await findRow(
        managerAToken,
        demoCategoryId,
        (row) => row.isOwn,
      );
      const result = await api.graphql<SetFieldEnabledData>(
        SET_FIELD_ENABLED,
        { input: { id: own.id, enabled: false } },
        { accessToken: managerAToken },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data?.setFieldEnabled.field.enabled).toBe(false);

      const audit = await latestAudit(
        "field.toggle-enabled",
        new Types.ObjectId(own.id),
      );
      expect(audit?.before).toMatchObject({ enabled: true });
      expect(audit?.after).toMatchObject({ enabled: false });
    });

    it("種子選項:租戶操作者 → FORBIDDEN(reason SEED_GLOBAL_SWITCH)", async () => {
      const seed = await findRow(
        managerAToken,
        genderCategoryId,
        (row) => row.value === "undisclosed",
      );
      const result = await api.graphql(
        SET_FIELD_ENABLED,
        { input: { id: seed.id, enabled: false } },
        { accessToken: managerAToken },
      );
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "FORBIDDEN",
        reason: "SEED_GLOBAL_SWITCH",
      });
    });

    it("種子選項:根組織操作者切得動,全域生效", async () => {
      const seed = await findRow(
        rootToken,
        genderCategoryId,
        (row) => row.value === "undisclosed",
      );
      expect(seed.canToggleEnabled).toBe(true);
      const result = await api.graphql<SetFieldEnabledData>(
        SET_FIELD_ENABLED,
        { input: { id: seed.id, enabled: false } },
        { accessToken: rootToken },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data?.setFieldEnabled.field).toMatchObject({
        enabled: false,
        ownerOrg: null,
      });

      const seenByTenant = await findRow(
        managerAToken,
        genderCategoryId,
        (row) => row.value === "undisclosed",
      );
      expect(seenByTenant.enabled).toBe(false);
    });
  });

  describe("租戶隔離", () => {
    it("租戶甲看不到租戶乙的自訂選項(互為兄弟,誰都不是誰的上層)", async () => {
      const seenByA = await listFields(api, managerAToken, demoCategoryId);
      const seenByB = await listFields(api, managerBToken, demoCategoryId);
      // 兩邊各自只有一筆自訂,且 id 不同(同 value、不同組織)
      const ownOfA = customOf(seenByA);
      const ownOfB = customOf(seenByB);
      expect(ownOfA).toHaveLength(1);
      expect(ownOfB).toHaveLength(1);
      expect(ownOfA[0]?.id).not.toBe(ownOfB[0]?.id);
      expect(seenByA.some((row) => row.id === ownOfB[0]?.id)).toBe(false);
      expect(seenByB.some((row) => row.id === ownOfA[0]?.id)).toBe(false);
    });

    it("根組織操作者看得到全部租戶的自訂選項,但一筆都不是自己的", async () => {
      const rows = await listFields(api, rootToken, demoCategoryId);
      const custom = customOf(rows);
      const owners = new Set(custom.map((row) => row.ownerOrg?.name));
      expect(custom).toHaveLength(2);
      expect(owners).toEqual(new Set(["租戶甲", "租戶乙"]));
      expect(custom.every((row) => !row.isOwn && !row.canEdit)).toBe(true);
    });
  });
});
