import { expect } from "@jest/globals";
import type { Connection, Types } from "mongoose";

import type { AuthTestApp } from "../../auth/test-support/auth-app";
import { createUser } from "../../auth/test-support/fixtures";
import { createRole } from "../../permission/test-support/fixtures";

/**
 * 欄位管理測試的共用夾具(`fields.test.ts` 與 `field-visibility.test.ts` 共用):
 * GraphQL 文件、建操作者、列清單。測試檔只寫行為(TEST-08 的分檔原則,api 同理)。
 */

export const PASSWORD = ["test", "pass", "word"].join("-");

const LOGIN = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

/** 一筆選項的對外形狀(正本 docs/modules/field-manager.md「api 介面」)。 */
const FIELD_FIELDS = /* GraphQL */ `
  fragment FieldFields on Field {
    id
    categoryId
    label
    value
    order
    enabled
    description
    color
    ownerOrg {
      id
      name
    }
    isOwn
    canEdit
    canToggleEnabled
  }
`;

export const FIELD_CATEGORIES = /* GraphQL */ `
  query FieldCategories {
    fieldCategories {
      items {
        id
        key
        name
      }
      totalCount
    }
  }
`;

export const FIELDS = /* GraphQL */ `
  ${FIELD_FIELDS}
  query Fields($categoryId: ID!) {
    fields(categoryId: $categoryId) {
      items {
        ...FieldFields
      }
      totalCount
    }
  }
`;

export const CREATE_FIELD = /* GraphQL */ `
  ${FIELD_FIELDS}
  mutation CreateField($input: CreateFieldInput!) {
    createField(input: $input) {
      field {
        ...FieldFields
      }
    }
  }
`;

export const UPDATE_FIELD = /* GraphQL */ `
  mutation UpdateField($input: UpdateFieldInput!) {
    updateField(input: $input) {
      field {
        id
        label
        order
        description
      }
    }
  }
`;

export const SET_FIELD_ENABLED = /* GraphQL */ `
  ${FIELD_FIELDS}
  mutation SetFieldEnabled($input: SetFieldEnabledInput!) {
    setFieldEnabled(input: $input) {
      field {
        ...FieldFields
      }
    }
  }
`;

export const SET_FIELD_COLOR = /* GraphQL */ `
  ${FIELD_FIELDS}
  mutation SetFieldColor($input: SetFieldColorInput!) {
    setFieldColor(input: $input) {
      field {
        ...FieldFields
      }
    }
  }
`;

export interface FieldOwnerOrgRow {
  id: string;
  name: string;
}

export interface FieldRow {
  id: string;
  categoryId: string;
  label: string;
  value: string;
  order: number;
  enabled: boolean;
  description: string | null;
  /** 標籤色票代號;null = 不設定顏色。 */
  color: string | null;
  /** null = 全域種子;有值 = 加這筆的組織(可能是上層 / 下層組織)。 */
  ownerOrg: FieldOwnerOrgRow | null;
  isOwn: boolean;
  canEdit: boolean;
  canToggleEnabled: boolean;
}

export interface FieldsData {
  fields: { items: FieldRow[]; totalCount: number };
}

export interface CreateFieldData {
  createField: { field: FieldRow };
}

export interface SetFieldEnabledData {
  setFieldEnabled: { field: FieldRow };
}

export interface SetFieldColorData {
  setFieldColor: { field: FieldRow };
}

interface LoginData {
  login: { accessToken: string };
}

/** 欄位管理權限表(field-manager.md)的四個 key。 */
export const FIELD_PERMISSIONS = [
  "system.field-manager.view",
  "system.field-manager.create",
  "system.field-manager.edit",
  "system.field-manager.toggle-enabled",
];

/** 模組樹要給完整(綁下層必綁上層,ADR-0011 步驟 3)。 */
const FIELD_MODULES = ["system", "system.field-manager"];

/** 類別作業(根組織專屬的權限容器)的權限與模組樹。 */
export const MANAGE_CATEGORIES =
  "system.field-manager.category-ops.manage-categories";
export const CATEGORY_OPS_MODULES = [
  ...FIELD_MODULES,
  "system.field-manager.category-ops",
];

let accountSequence = 0;

export async function login(
  api: AuthTestApp,
  account: string,
  password = PASSWORD,
): Promise<string> {
  const result = await api.graphql<LoginData>(LOGIN, {
    input: { account, password },
  });
  expect(result.errors).toBeUndefined();
  const token = result.data?.login.accessToken;
  if (!token) {
    throw new Error(`登入失敗:${account}`);
  }
  return token;
}

/** 建一個持有欄位管理權限的操作者並登入(當前組織 = 第一個所屬組織)。 */
export async function createFieldManager(
  api: AuthTestApp,
  connection: Connection,
  orgId: Types.ObjectId,
  permissionKeys: string[] = FIELD_PERMISSIONS,
  moduleKeys: string[] = FIELD_MODULES,
): Promise<string> {
  accountSequence += 1;
  const account = `field-manager-${String(accountSequence)}`;
  const userId = await createUser(connection, {
    account,
    password: PASSWORD,
    orgIds: [orgId],
  });
  await createRole(api.app, connection, {
    name: `欄位管理角色:${account}`,
    ownerOrgId: orgId,
    moduleKeys,
    permissionKeys,
    assignTo: [userId],
  });
  return login(api, account);
}

export async function findCategoryId(
  connection: Connection,
  key: string,
): Promise<Types.ObjectId> {
  const category = await connection
    .collection("field_categories")
    .findOne<{ _id: Types.ObjectId }>({ key });
  if (!category) {
    throw new Error(`測試資料庫沒有欄位類別 key=${key}(seed 未跑?)`);
  }
  return category._id;
}

export async function listFields(
  api: AuthTestApp,
  token: string,
  categoryId: Types.ObjectId,
): Promise<FieldRow[]> {
  const result = await api.graphql<FieldsData>(
    FIELDS,
    { categoryId: String(categoryId) },
    { accessToken: token },
  );
  expect(result.errors).toBeUndefined();
  if (!result.data) {
    throw new Error("fields 沒有回資料");
  }
  expect(result.data.fields.totalCount).toBe(result.data.fields.items.length);
  return result.data.fields.items;
}

/** 合併清單裡的自訂選項(`ownerOrg` 有值);種子選項不含在內。 */
export function customOf(rows: FieldRow[]): FieldRow[] {
  return rows.filter((row) => row.ownerOrg !== null);
}

export async function createField(
  api: AuthTestApp,
  token: string,
  input: Record<string, unknown>,
): Promise<Awaited<ReturnType<AuthTestApp["graphql"]>>> {
  return api.graphql<CreateFieldData>(
    CREATE_FIELD,
    { input },
    { accessToken: token },
  );
}
