import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import { TAG_PALETTE_KEYS } from "@repo/domain/project/tag-palette";

import {
  type AuthTestApp,
  ROOT_ADMIN,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import {
  FIELD_PERMISSIONS,
  type FieldRow,
  createField,
  createFieldManager,
  findCategoryId,
  listFields,
  login,
} from "../../fields/test-support/fixtures";
import { FIELD_OPTION_COLORS_COLLECTION } from "../database/field-option-colors/field-option-color.schema";

const FIELD_OPTION_COLORS = /* GraphQL */ `
  query FieldOptionColors($categoryKey: String!) {
    fieldOptionColors(categoryKey: $categoryKey) {
      items {
        fieldId
        value
        paletteKey
      }
      totalCount
    }
  }
`;

const SET_FIELD_OPTION_COLOR = /* GraphQL */ `
  mutation SetFieldOptionColor($input: SetFieldOptionColorInput!) {
    setFieldOptionColor(input: $input) {
      color {
        fieldId
        value
        paletteKey
      }
    }
  }
`;

interface ColorRow {
  fieldId: string;
  value: string;
  paletteKey: string | null;
}

interface FieldOptionColorsData {
  fieldOptionColors: { items: ColorRow[]; totalCount: number };
}

interface SetFieldOptionColorData {
  setFieldOptionColor: { color: ColorRow };
}

interface CreateFieldData {
  createField: { field: FieldRow };
}

interface ColorDocument {
  orgId: Types.ObjectId;
  tenantId: Types.ObjectId | null;
  fieldId: Types.ObjectId;
  paletteKey: string | null;
}

/**
 * 欄位選項顏色(S2 專案客製,規格 18.5):打真的 GraphQL 端點、對真 MongoDB(TEST-07)。
 * 組織樹:root ─┬─ 租戶甲 ─ 甲分店  └─ 租戶乙。種子類別沿用底座的 `gender`(崗位由 P01 的專案 seed 宣告,
 * 規則對任何類別都一樣)。
 */
describe("欄位選項顏色(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;

  let tenantA: Types.ObjectId;
  let genderCategoryId: Types.ObjectId;

  let rootToken: string;
  let managerAToken: string;
  let branchAToken: string;
  let managerBToken: string;
  /** 只有 view(沒有 edit)的租戶甲人員:讀得到顏色、設不了。 */
  let viewerAToken: string;

  async function listColors(
    token: string,
    categoryKey = "gender",
  ): Promise<ColorRow[]> {
    const result = await api.graphql<FieldOptionColorsData>(
      FIELD_OPTION_COLORS,
      { categoryKey },
      { accessToken: token },
    );
    expect(result.errors).toBeUndefined();
    const payload = result.data?.fieldOptionColors;
    if (!payload) {
      throw new Error("fieldOptionColors 沒有回資料");
    }
    expect(payload.totalCount).toBe(payload.items.length);
    return payload.items;
  }

  function setColor(token: string, fieldId: string, paletteKey: unknown) {
    return api.graphql<SetFieldOptionColorData>(
      SET_FIELD_OPTION_COLOR,
      { input: { fieldId, paletteKey } },
      { accessToken: token },
    );
  }

  /** 設定後的錯誤(第一筆的 extensions);成功回 undefined。 */
  async function setColorError(
    token: string,
    fieldId: string,
    paletteKey: unknown,
  ): Promise<Record<string, unknown> | undefined> {
    const result = await setColor(token, fieldId, paletteKey);
    return result.errors?.[0]?.extensions;
  }

  async function colorValues(token: string): Promise<string[]> {
    const rows = await listColors(token);
    return rows.map((row) => row.value);
  }

  async function seedFieldId(value: string): Promise<string> {
    const rows = await listFields(api, rootToken, genderCategoryId);
    const found = rows.find((row) => row.value === value);
    if (!found) {
      throw new Error(`種子選項 ${value} 不存在`);
    }
    return found.id;
  }

  function colorDocuments(fieldId: string): Promise<ColorDocument[]> {
    return connection
      .collection(FIELD_OPTION_COLORS_COLLECTION)
      .find<ColorDocument>({ fieldId: new Types.ObjectId(fieldId) })
      .toArray();
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-field-option-colors");
    connection = api.connection;
    await connection
      .collection(FIELD_OPTION_COLORS_COLLECTION)
      .createIndex({ tenantId: 1, fieldId: 1 }, { unique: true });

    tenantA = await createOrg(connection, { name: "租戶甲" });
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

  it("root 為全域選項設顏色:存成 tenantId = null 的一筆,各租戶與下層都讀得到", async () => {
    const maleId = await seedFieldId("male");

    const result = await setColor(rootToken, maleId, "orange");
    expect(result.errors).toBeUndefined();
    expect(result.data?.setFieldOptionColor.color).toEqual({
      fieldId: maleId,
      value: "male",
      paletteKey: "orange",
    });

    const [document] = await colorDocuments(maleId);
    expect(document?.tenantId).toBeNull();
    expect(document?.paletteKey).toBe("orange");

    for (const token of [managerAToken, branchAToken, managerBToken]) {
      expect(await listColors(token)).toContainEqual({
        fieldId: maleId,
        value: "male",
        paletteKey: "orange",
      });
    }
  });

  it("再設一次是更新同一筆;設成 null 是清掉顏色,清單不再列", async () => {
    const femaleId = await seedFieldId("female");
    expect(await setColorError(rootToken, femaleId, "pink")).toBeUndefined();
    expect(await setColorError(rootToken, femaleId, "purple")).toBeUndefined();
    expect(await colorDocuments(femaleId)).toHaveLength(1);
    expect(await listColors(managerAToken)).toContainEqual({
      fieldId: femaleId,
      value: "female",
      paletteKey: "purple",
    });

    const cleared = await setColor(rootToken, femaleId, null);
    expect(cleared.errors).toBeUndefined();
    expect(cleared.data?.setFieldOptionColor.color.paletteKey).toBeNull();
    expect(await colorValues(managerAToken)).not.toContain("female");
  });

  it.each([["#FFA500"], ["Orange"], [""], ["gold"]])(
    "不在色票清單的代號 %p → VALIDATION_FAILED(只能從十組色票選)",
    async (paletteKey) => {
      const otherId = await seedFieldId("other");
      const result = await setColor(rootToken, otherId, paletteKey);
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["paletteKey"],
      });
      expect(await colorDocuments(otherId)).toHaveLength(0);
    },
  );

  it("十組色票代號都收", async () => {
    const otherId = await seedFieldId("other");
    for (const key of TAG_PALETTE_KEYS) {
      const result = await setColor(rootToken, otherId, key);
      expect(result.errors).toBeUndefined();
    }
    await setColor(rootToken, otherId, null);
  });

  it("租戶不能設全域選項的顏色(對全平台生效)→ FORBIDDEN / SEED_GLOBAL_SWITCH", async () => {
    const maleId = await seedFieldId("male");
    const result = await setColor(managerAToken, maleId, "blue");
    expect(result.errors?.[0]?.extensions).toMatchObject({
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
    const fieldId = (created.data as CreateFieldData | undefined)?.createField
      .field.id;
    if (fieldId === undefined) {
      throw new Error("自訂選項沒建起來");
    }

    expect(
      await setColorError(managerAToken, fieldId, "green"),
    ).toBeUndefined();
    const [document] = await colorDocuments(fieldId);
    expect(String(document?.tenantId)).toBe(String(tenantA));
    expect(String(document?.orgId)).toBe(String(tenantA));

    // 下層(甲分店)繼承看得到,但不是自己這一層加的
    expect(await listColors(branchAToken)).toContainEqual({
      fieldId,
      value: "tenant-a-custom",
      paletteKey: "green",
    });
    expect(await setColorError(branchAToken, fieldId, "red")).toMatchObject({
      code: "FORBIDDEN",
      reason: "NOT_OWNER",
    });

    // 兄弟租戶:清單沒有、設定 → NOT_FOUND
    expect(await colorValues(managerBToken)).not.toContain("tenant-a-custom");
    expect(await setColorError(managerBToken, fieldId, "red")).toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("讀取只要登入(顯示選項的頁面都要用);設定要 system.field-manager.edit", async () => {
    expect(await colorValues(viewerAToken)).not.toHaveLength(0);
    const maleId = await seedFieldId("male");
    const result = await setColor(viewerAToken, maleId, "blue");
    expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
  });

  it("不存在的類別 key → NOT_FOUND", async () => {
    const result = await api.graphql<FieldOptionColorsData>(
      FIELD_OPTION_COLORS,
      { categoryKey: "no-such-category" },
      { accessToken: managerAToken },
    );
    expect(result.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");
  });
});
