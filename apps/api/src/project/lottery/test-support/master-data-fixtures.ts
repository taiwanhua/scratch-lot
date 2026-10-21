import { expect } from "@jest/globals";
import type { Connection, Types } from "mongoose";

import {
  MASTER_DATA_MODULE_KEYS,
  MASTER_DATA_PERMISSIONS,
} from "@repo/domain/project/lottery-master-data";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";

import type { AuthTestApp } from "../../../auth/test-support/auth-app";
import { createUser } from "../../../auth/test-support/fixtures";
import { login } from "../../../demo-items-two/test-support/fixtures";
import { createRole } from "../../../permission/test-support/fixtures";

/**
 * 檔案管理測試的共用夾具。api 測試的資料庫只種底座(`BASE_ONLY_REGISTRY`),專案的模組樹、權限與
 * 「崗位」類別由這裡直接寫進**隔離的測試資料庫**(形狀同 seed:`seeds/project/master-data.ts`、
 * `seeds/project/field-categories.ts`;先例 `test-support/project-fixture/fixtures.ts`)。
 */

export const PASSWORD = ["test", "pass", "word"].join("-");

function baseFields(now: Date): Record<string, unknown> {
  return {
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  };
}

/** 模組樹節點(父在前):key、父 key、路由、側欄型別。 */
const NODES: readonly {
  key: string;
  parentKey: string | null;
  route: string | null;
  sidebarType: "link" | "hidden";
}[] = [
  {
    key: MASTER_DATA_MODULE_KEYS.list,
    parentKey: null,
    route: "master-data",
    sidebarType: "link",
  },
  {
    key: MASTER_DATA_MODULE_KEYS.games,
    parentKey: MASTER_DATA_MODULE_KEYS.list,
    route: null,
    sidebarType: "hidden",
  },
  {
    key: MASTER_DATA_MODULE_KEYS.gameViewPage,
    parentKey: MASTER_DATA_MODULE_KEYS.games,
    route: "game-view-page",
    sidebarType: "hidden",
  },
  {
    key: MASTER_DATA_MODULE_KEYS.cashPoints,
    parentKey: MASTER_DATA_MODULE_KEYS.list,
    route: null,
    sidebarType: "hidden",
  },
];

/** 寫入檔案管理的模組樹與個別權限(每個測試資料庫呼叫一次)。 */
export async function seedMasterDataAuthorization(
  connection: Connection,
): Promise<void> {
  const now = new Date();
  const ids = new Map<string, Types.ObjectId>();
  for (const [order, node] of NODES.entries()) {
    const parentId =
      node.parentKey === null ? null : (ids.get(node.parentKey) ?? null);
    const parent =
      parentId === null
        ? null
        : await connection
            .collection("modules")
            .findOne<{ ancestors: Types.ObjectId[] }>({ _id: parentId });
    const { insertedId } = await connection.collection("modules").insertOne({
      key: node.key,
      name: node.key,
      parentId,
      ancestors:
        parentId === null ? [] : [...(parent?.ancestors ?? []), parentId],
      route: node.route,
      sidebarType: node.sidebarType,
      order,
      enabled: true,
      isSystem: false,
      icon: null,
      settings: {},
      engine: "fixed",
      ...baseFields(now),
    });
    ids.set(node.key, insertedId);
  }
  await connection.collection("permissions").insertMany(
    Object.values(MASTER_DATA_PERMISSIONS).map((key) => ({
      key,
      moduleId: ids.get(key.slice(0, key.lastIndexOf("."))),
      name: key,
      enabled: true,
      isSystem: false,
      settings: {},
      source: "seed",
      retiredAt: null,
      ...baseFields(now),
    })),
  );
}

/** 全域「崗位」類別與三個種子選項(店內櫃台、店外攤位、補貨),回類別 id。 */
export async function seedPositionCategory(
  connection: Connection,
): Promise<Types.ObjectId> {
  const now = new Date();
  const { insertedId: categoryId } = await connection
    .collection("field_categories")
    .insertOne({
      key: SCHEDULE_FIELD_CATEGORY_KEYS.position,
      name: "崗位",
      isSystem: true,
      enabled: true,
      ...baseFields(now),
    });
  await connection.collection("fields").insertMany(
    [
      { value: "in-store-counter", label: "店內櫃台" },
      { value: "outdoor-stall", label: "店外攤位" },
      { value: "restock", label: "補貨" },
    ].map((option, index) => ({
      ...option,
      key: `${SCHEDULE_FIELD_CATEGORY_KEYS.position}.${option.value}`,
      categoryId,
      orgId: null,
      order: index + 1,
      enabled: true,
      isSystem: true,
      ...baseFields(now),
    })),
  );
  return categoryId;
}

/**
 * 全域的原因類別與種子選項(同 `seeds/project/field-categories.ts` 的形狀;測試 app 不跑專案 seed),回類別 id。
 * 例:作廢原因 `SHARED_FIELD_CATEGORY_KEYS.voidReason` + 輸入錯誤 / 其他。
 */
export async function seedReasonCategory(
  connection: Connection,
  key: string,
  options: readonly { value: string; label: string }[],
): Promise<Types.ObjectId> {
  const now = new Date();
  const { insertedId: categoryId } = await connection
    .collection("field_categories")
    .insertOne({
      key,
      name: key,
      isSystem: true,
      enabled: true,
      ...baseFields(now),
    });
  await connection.collection("fields").insertMany(
    options.map((option, index) => ({
      ...option,
      key: `${key}.${option.value}`,
      categoryId,
      orgId: null,
      order: index + 1,
      enabled: true,
      isSystem: true,
      ...baseFields(now),
    })),
  );
  return categoryId;
}

/** 某組織自訂的崗位選項(例:示範租戶的「彩券機旁」)。 */
export async function addCustomPosition(
  connection: Connection,
  categoryId: Types.ObjectId,
  orgId: Types.ObjectId,
  option: { value: string; label: string },
): Promise<void> {
  await connection.collection("fields").insertOne({
    ...option,
    categoryId,
    orgId,
    order: 10,
    enabled: true,
    isSystem: false,
    ...baseFields(new Date()),
  });
}

/** 綁得到遊戲分頁的模組(綁下層必綁上層,ADR-0011)。 */
export const GAME_MODULES = [
  MASTER_DATA_MODULE_KEYS.list,
  MASTER_DATA_MODULE_KEYS.games,
];

/** 綁得到收銀點分頁的模組。 */
export const CASH_POINT_MODULES = [
  MASTER_DATA_MODULE_KEYS.list,
  MASTER_DATA_MODULE_KEYS.cashPoints,
];

let accountSequence = 0;

/** 建一個操作者並登入(當前組織 = 第一個所屬組織)。 */
export async function createMasterDataOperator(
  api: AuthTestApp,
  connection: Connection,
  options: {
    orgId: Types.ObjectId;
    ownerOrgId?: Types.ObjectId;
    moduleKeys: readonly string[];
    permissionKeys: readonly string[];
  },
): Promise<string> {
  accountSequence += 1;
  const account = `master-data-${String(accountSequence)}`;
  const userId = await createUser(connection, {
    account,
    password: PASSWORD,
    orgIds: [options.orgId],
  });
  await createRole(api.app, connection, {
    name: `檔案管理角色:${account}`,
    ownerOrgId: options.ownerOrgId ?? options.orgId,
    moduleKeys: [...options.moduleKeys],
    permissionKeys: [...options.permissionKeys],
    assignTo: [userId],
  });
  return login(api, account, PASSWORD);
}

/** 呼叫並回第一筆錯誤的 extensions;成功時 undefined。 */
export async function errorOf(
  api: AuthTestApp,
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const result = await api.graphql(query, variables, { accessToken: token });
  return result.errors?.[0]?.extensions;
}

/** 呼叫並要求成功,回 data。 */
export async function ok<TData>(
  api: AuthTestApp,
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<TData> {
  const result = await api.graphql<TData>(query, variables, {
    accessToken: token,
  });
  expect(result.errors).toBeUndefined();
  if (!result.data) {
    throw new Error("沒有回資料");
  }
  return result.data;
}
