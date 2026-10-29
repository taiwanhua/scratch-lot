import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import { TAG_PALETTE_KEYS } from "@repo/domain/tag-palette";

import {
  type AuthTestApp,
  ROOT_ADMIN,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import { createOrg } from "../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import {
  type CreateFieldData,
  FIELD_PERMISSIONS,
  type FieldRow,
  SET_FIELD_COLOR,
  type SetFieldColorData,
  createField,
  createFieldManager,
  findCategoryId,
  listFields,
  login,
} from "./test-support/fixtures";

interface AuditRow {
  action: string;
  targetId: Types.ObjectId;
  before?: { color: string | null };
  after?: { color: string | null };
}

/**
 * 欄位選項的顏色(`Field.color` + `setFieldColor`):打真的 GraphQL 端點、對真 MongoDB(TEST-07)。
 * 組織樹:root ─┬─ 租戶甲 ─ 甲分店  └─ 租戶乙。種子類別用 `gender`(規則對任何類別都一樣)。
 */
describe("欄位選項顏色(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let genderCategoryId: Types.ObjectId;

  let rootToken: string;
  let managerAToken: string;
  let branchAToken: string;
  let managerBToken: string;
  /** 只有 view(沒有 edit)的租戶甲人員:讀得到顏色、設不了。 */
  let viewerAToken: string;

  function setColor(token: string, id: string, color: unknown) {
    return api.graphql<SetFieldColorData>(
      SET_FIELD_COLOR,
      { input: { id, color } },
      { accessToken: token },
    );
  }

  /** 設定後的錯誤(第一筆的 extensions);成功回 undefined。 */
  async function setColorError(
    token: string,
    id: string,
    color: unknown,
  ): Promise<Record<string, unknown> | undefined> {
    const result = await setColor(token, id, color);
    return result.errors?.[0]?.extensions;
  }

  async function rowOf(token: string, value: string): Promise<FieldRow> {
    const rows = await listFields(api, token, genderCategoryId);
    const found = rows.find((row) => row.value === value);
    if (!found) {
      throw new Error(`合併清單沒有選項 ${value}`);
    }
    return found;
  }

  async function storedColorOf(id: string): Promise<unknown> {
    const document = await connection
      .collection<{ color?: string | null }>("fields")
      .findOne({ _id: new Types.ObjectId(id) });
    return document?.color;
  }

  function colorAudits(id: string): Promise<AuditRow[]> {
    return connection
      .collection("audit_logs")
      .find<AuditRow>({
        action: "field.set-color",
        targetId: new Types.ObjectId(id),
      })
      .toArray();
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-field-colors");
    connection = api.connection;

    const tenantA = await createOrg(connection, { name: "租戶甲" });
    const branchA = await createOrg(connection, {
      name: "甲分店",
      parentId: tenantA,
    });
    const tenantB = await createOrg(connection, { name: "租戶乙" });
    genderCategoryId = await findCategoryId(connection, "gender");

    rootToken = await login(api, ROOT_ADMIN.account, ROOT_ADMIN.password);
    managerAToken = await createFieldManager(api, connection, tenantA);
    branchAToken = await createFieldManager(api, connection, branchA);
    managerBToken = await createFieldManager(api, connection, tenantB);
    viewerAToken = await createFieldManager(api, connection, tenantA, [
      FIELD_PERMISSIONS[0] ?? "system.field-manager.view",
    ]);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("選項預設沒有顏色(`color: null`)", async () => {
    const row = await rowOf(managerAToken, "undisclosed");
    expect(row.color).toBeNull();
  });

  it("root 為全域選項設顏色:存在選項本身,各租戶與下層都讀得到;記稽核", async () => {
    const { id } = await rowOf(rootToken, "male");

    const result = await setColor(rootToken, id, "orange");
    expect(result.errors).toBeUndefined();
    expect(result.data?.setFieldColor.field).toMatchObject({
      id,
      value: "male",
      color: "orange",
    });
    expect(await storedColorOf(id)).toBe("orange");

    for (const token of [managerAToken, branchAToken, managerBToken]) {
      const row = await rowOf(token, "male");
      expect(row.color).toBe("orange");
    }
    expect(await colorAudits(id)).toEqual([
      expect.objectContaining({
        before: { color: null },
        after: { color: "orange" },
      }),
    ]);
  });

  it("再設一次是覆寫;設成 null 是清掉顏色(欄位留著、值是 null);同一個顏色不寫稽核", async () => {
    const { id } = await rowOf(rootToken, "female");
    expect(await setColorError(rootToken, id, "pink")).toBeUndefined();
    expect(await setColorError(rootToken, id, "purple")).toBeUndefined();
    expect(await setColorError(rootToken, id, "purple")).toBeUndefined();
    const recolored = await rowOf(managerAToken, "female");
    expect(recolored.color).toBe("purple");
    expect(await colorAudits(id)).toHaveLength(2);

    const cleared = await setColor(rootToken, id, null);
    expect(cleared.errors).toBeUndefined();
    expect(cleared.data?.setFieldColor.field.color).toBeNull();
    expect(await storedColorOf(id)).toBeNull();
    const reread = await rowOf(managerAToken, "female");
    expect(reread.color).toBeNull();
  });

  it.each([["#FFA500"], ["Orange"], [""], ["gold"]])(
    "不在色票清單的代號 %p → VALIDATION_FAILED(只能從十組色票選)",
    async (color) => {
      const { id } = await rowOf(rootToken, "other");
      const result = await setColor(rootToken, id, color);
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["color"],
      });
      expect(await storedColorOf(id)).toBeUndefined();
    },
  );

  it("十組色票代號都收", async () => {
    const { id } = await rowOf(rootToken, "other");
    for (const key of TAG_PALETTE_KEYS) {
      const result = await setColor(rootToken, id, key);
      expect(result.errors).toBeUndefined();
    }
    await setColor(rootToken, id, null);
  });

  it("租戶不能設全域選項的顏色(對全平台生效)→ FORBIDDEN / SEED_GLOBAL_SWITCH", async () => {
    const { id } = await rowOf(managerAToken, "male");
    expect(await setColorError(managerAToken, id, "blue")).toMatchObject({
      code: "FORBIDDEN",
      reason: "SEED_GLOBAL_SWITCH",
    });
  });

  it("自訂選項:加它的那一層設顏色;下層讀得到、改不了;兄弟租戶看不到也設不了", async () => {
    const created = await createField(api, managerAToken, {
      categoryId: String(genderCategoryId),
      label: "甲自訂",
      value: "tenant-a-custom",
    });
    expect(created.errors).toBeUndefined();
    const id = (created.data as CreateFieldData | undefined)?.createField.field
      .id;
    if (id === undefined) {
      throw new Error("自訂選項沒建起來");
    }

    expect(await setColorError(managerAToken, id, "green")).toBeUndefined();
    const branchRow = await rowOf(branchAToken, "tenant-a-custom");
    expect(branchRow.color).toBe("green");
    expect(await setColorError(branchAToken, id, "red")).toMatchObject({
      code: "FORBIDDEN",
      reason: "NOT_OWNER",
    });

    const otherTenant = await listFields(api, managerBToken, genderCategoryId);
    expect(otherTenant.map((row) => row.value)).not.toContain(
      "tenant-a-custom",
    );
    expect(await setColorError(managerBToken, id, "red")).toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("讀取跟著 `fields`(view);設定要 system.field-manager.edit", async () => {
    const { id, color } = await rowOf(viewerAToken, "male");
    expect(color).toBe("orange");
    const result = await setColor(viewerAToken, id, "blue");
    expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
  });

  it("選項 id 格式不對 → VALIDATION_FAILED", async () => {
    expect(await setColorError(rootToken, "not-an-id", "blue")).toMatchObject({
      code: "VALIDATION_FAILED",
      fields: ["id"],
    });
  });
});
