import { expect } from "@jest/globals";
import type { Connection, Types } from "mongoose";

import type { AuthTestApp } from "../../auth/test-support/auth-app";
import { createUser } from "../../auth/test-support/fixtures";
import { createRole } from "../../permission/test-support/fixtures";

/**
 * 示範模組2 測試的共用夾具:GraphQL 文件、建操作者、列清單。
 * 測試檔只寫行為(TEST-08 的分檔原則,api 同理)。
 */

export const PASSWORD = ["test", "pass", "word"].join("-");

const LOGIN = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

/** 一筆項目的對外形狀(正本 docs/modules/demo.sample-two.md「api 介面」)。 */
const DEMO_ITEM_TWO_FIELDS = /* GraphQL */ `
  fragment DemoItemTwoFields on DemoItemTwo {
    id
    name
    note
    enabled
    createdBy {
      id
      name
    }
    createdAt
    updatedAt
    abilities {
      canEdit
      canDelete
    }
    shareOrgs {
      orgId
      includeDescendants
    }
    isShared
  }
`;

export const DEMO_ITEMS_TWO = /* GraphQL */ `
  ${DEMO_ITEM_TWO_FIELDS}
  query DemoItemsTwo($input: DemoItemsTwoInput!) {
    demoItemsTwo(input: $input) {
      items {
        ...DemoItemTwoFields
      }
      totalCount
      page
      pageSize
    }
  }
`;

export const DEMO_ITEM_TWO = /* GraphQL */ `
  ${DEMO_ITEM_TWO_FIELDS}
  query DemoItemTwo($id: ID!) {
    demoItemTwo(id: $id) {
      item {
        ...DemoItemTwoFields
      }
    }
  }
`;

export const CREATE_DEMO_ITEM_TWO = /* GraphQL */ `
  ${DEMO_ITEM_TWO_FIELDS}
  mutation CreateDemoItemTwo($input: CreateDemoItemTwoInput!) {
    createDemoItemTwo(input: $input) {
      item {
        ...DemoItemTwoFields
      }
    }
  }
`;

export const UPDATE_DEMO_ITEM_TWO = /* GraphQL */ `
  ${DEMO_ITEM_TWO_FIELDS}
  mutation UpdateDemoItemTwo($input: UpdateDemoItemTwoInput!) {
    updateDemoItemTwo(input: $input) {
      item {
        ...DemoItemTwoFields
      }
    }
  }
`;

export const DELETE_DEMO_ITEM_TWO = /* GraphQL */ `
  mutation DeleteDemoItemTwo($input: DeleteDemoItemTwoInput!) {
    deleteDemoItemTwo(input: $input) {
      success
      deletedId
    }
  }
`;

export const SET_DEMO_ITEM_TWO_ENABLED = /* GraphQL */ `
  ${DEMO_ITEM_TWO_FIELDS}
  mutation SetDemoItemTwoEnabled($input: SetDemoItemTwoEnabledInput!) {
    setDemoItemTwoEnabled(input: $input) {
      item {
        ...DemoItemTwoFields
      }
    }
  }
`;

export interface DemoItemTwoUserRow {
  id: string;
  name: string;
}

export interface DemoItemTwoRow {
  id: string;
  name: string;
  note: string | null;
  enabled: boolean;
  createdBy: DemoItemTwoUserRow | null;
  createdAt: string;
  updatedAt: string;
  abilities: { canEdit: boolean; canDelete: boolean };
  shareOrgs: { orgId: string; includeDescendants: boolean }[];
  isShared: boolean;
}

export interface DemoItemsTwoData {
  demoItemsTwo: {
    items: DemoItemTwoRow[];
    totalCount: number;
    page: number;
    pageSize: number;
  };
}

export interface DemoItemTwoData {
  demoItemTwo: { item: DemoItemTwoRow };
}

export interface MutateDemoItemTwoData {
  createDemoItemTwo: { item: DemoItemTwoRow };
  updateDemoItemTwo: { item: DemoItemTwoRow };
  setDemoItemTwoEnabled: { item: DemoItemTwoRow };
}

export interface DeleteDemoItemTwoData {
  deleteDemoItemTwo: { success: boolean; deletedId: string };
}

interface LoginData {
  login: { accessToken: string };
}

/** 示範模組2 的權限表(demo.sample-two.md);沒有自己的 toggle-enabled。 */
export const DEMO_TWO_PERMISSIONS = [
  "demo.sample-two.view",
  "demo.sample-two.create",
  "demo.sample-two.edit",
  "demo.sample-two.delete",
];

/** 模組樹要給完整(綁下層必綁上層,ADR-0011 步驟 3);示範模組2 掛示範群組直下。 */
const DEMO_TWO_MODULES = ["demo", "demo.sample-two"];

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

export interface DemoTwoOperator {
  userId: Types.ObjectId;
  account: string;
  token: string;
}

/** 建一個持有示範模組2 權限的操作者並登入(當前組織 = 第一個所屬組織)。 */
export async function createDemoTwoOperator(
  api: AuthTestApp,
  connection: Connection,
  orgId: Types.ObjectId,
  permissionKeys: string[] = DEMO_TWO_PERMISSIONS,
): Promise<DemoTwoOperator> {
  accountSequence += 1;
  const account = `demo-two-${String(accountSequence)}`;
  const userId = await createUser(connection, {
    account,
    password: PASSWORD,
    orgIds: [orgId],
  });
  await createRole(api.app, connection, {
    name: `示範模組2 角色:${account}`,
    ownerOrgId: orgId,
    moduleKeys: DEMO_TWO_MODULES,
    permissionKeys,
    assignTo: [userId],
  });
  return { userId, account, token: await login(api, account) };
}

export async function listItems(
  api: AuthTestApp,
  token: string,
  input: Record<string, unknown> = {},
): Promise<DemoItemsTwoData["demoItemsTwo"]> {
  const result = await api.graphql<DemoItemsTwoData>(
    DEMO_ITEMS_TWO,
    { input },
    { accessToken: token },
  );
  expect(result.errors).toBeUndefined();
  if (!result.data) {
    throw new Error("demoItemsTwo 沒有回資料");
  }
  return result.data.demoItemsTwo;
}

/** 名稱排序後比對:查詢順序由個別測試自己斷言,不在這裡預設。 */
export function sortedNames(rows: readonly { name: string }[]): string[] {
  return rows.map((row) => row.name).toSorted((a, b) => a.localeCompare(b));
}

/** 新增一筆並回傳它的 id(前提壞掉就直接拋,不讓後面的斷言變成假綠)。 */
export async function createItem(
  api: AuthTestApp,
  token: string,
  input: Record<string, unknown>,
): Promise<DemoItemTwoRow> {
  const result = await api.graphql<MutateDemoItemTwoData>(
    CREATE_DEMO_ITEM_TWO,
    { input },
    { accessToken: token },
  );
  expect(result.errors).toBeUndefined();
  const item = result.data?.createDemoItemTwo.item;
  if (!item) {
    throw new Error("createDemoItemTwo 沒有回資料");
  }
  return item;
}
