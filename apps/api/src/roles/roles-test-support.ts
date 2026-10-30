import { expect } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import {
  createOrg,
  createUser,
  findRootOrgId,
} from "../auth/test-support/fixtures";
import { createRole } from "../permission/test-support/fixtures";

/**
 * 角色管理三個測試檔共用的世界與夾具(TEST-07;分檔方式同 admin 的
 * `<page>-test-support.ts` 慣例:共用的 world / 夾具 / helper 抽成 kebab 命名的非元件檔)。
 *
 * 組織樹(root 為 seed 建的根組織):
 *   root ─┬─ 租戶甲 ─┬─ 部門一 ── 小組一
 *         │          └─ 部門二
 *         └─ 租戶乙 ── 部門A
 */

export const PASSWORD = ["test", "pass", "word"].join("-");

/** 角色管理權限表(role-manager.md)全部七個動作。 */
export const ROLE_MANAGER_PERMISSIONS = [
  "system.role-manager.view",
  "system.role-manager.create",
  "system.role-manager.edit",
  "system.role-manager.edit-matrix",
  "system.role-manager.assign-users",
  "system.role-manager.toggle-enabled",
  "system.role-manager.delete",
];

/**
 * 租戶管理員模板拿得到的模組(= seed 全部模組扣掉根組織專屬者,ADR-0009;
 * 正本推導在 `apps/db-migrator/seeds/base/role-bindings.ts`,此處明列是為了讓測試的期望值看得見)。
 */
export const TENANT_MODULE_KEYS = [
  "overview",
  "system",
  "system.org-manager",
  "system.user-manager",
  "system.role-manager",
  "system.field-manager",
  "demo",
  "demo.sub",
  "demo.sub.sample-one",
  "demo.sub.sample-one.view-page",
  "demo.sub.sample-one.create-page",
  "demo.sub.sample-one.edit-page",
  "demo.sample-two",
  "demo.sample-two.view-page",
  "demo.sample-two.create-page",
  "demo.sample-two.edit-page",
  "api",
];

/** 模板的權限綁定:每個模組各一筆 wildcard(ADR-0004「每層只存 `*` 一筆」)。 */
export const TENANT_WILDCARD_KEYS = TENANT_MODULE_KEYS.map((key) => `${key}.*`);

/**
 * 根組織專屬模組(`isRootOnly`,ADR-0009):模板扣掉的就是這三個,
 * 所以它們正好是「預設角色天花板之外」的例子。
 */
export const ROOT_ONLY_MODULE_KEYS = [
  "system.org-manager.tenant-ops",
  "system.module-manager",
  "system.data-scope",
];

/** 持有全部模組的操作者用的授予(天花板測試要的是「操作者搆得到、但模板沒有」)。 */
export const ALL_MODULE_KEYS = [
  ...TENANT_MODULE_KEYS,
  ...ROOT_ONLY_MODULE_KEYS,
];

export const ALL_WILDCARD_KEYS = ALL_MODULE_KEYS.map((key) => `${key}.*`);

/** 示範模組2 這一層的四筆個別權限(wildcard 收斂 / 展開的驗證對象)。 */
export const SAMPLE_TWO_INDIVIDUAL_KEYS = [
  "demo.sample-two.create",
  "demo.sample-two.delete",
  "demo.sample-two.edit",
  "demo.sample-two.view",
];

export interface RolesWorld {
  api: AuthTestApp;
  connection: Connection;
  rootOrgId: Types.ObjectId;
  tenantA: Types.ObjectId;
  deptOne: Types.ObjectId;
  teamOne: Types.ObjectId;
  deptTwo: Types.ObjectId;
  tenantB: Types.ObjectId;
  deptOfB: Types.ObjectId;
}

/** 建立測試世界(每個測試檔一個資料庫名,彼此不互相干擾)。 */
export async function startRolesWorld(
  databaseName: string,
): Promise<RolesWorld> {
  const api = await startAuthTestApp(databaseName);
  const connection = api.connection;
  const rootOrgId = await findRootOrgId(connection);
  const tenantA = await createOrg(connection, {
    name: "租戶甲",
    settings: { visibility: "subtree" },
  });
  const deptOne = await createOrg(connection, {
    name: "部門一",
    parentId: tenantA,
  });
  const teamOne = await createOrg(connection, {
    name: "小組一",
    parentId: deptOne,
  });
  const deptTwo = await createOrg(connection, {
    name: "部門二",
    parentId: tenantA,
  });
  const tenantB = await createOrg(connection, { name: "租戶乙" });
  const deptOfB = await createOrg(connection, {
    name: "部門A",
    parentId: tenantB,
  });
  return {
    api,
    connection,
    rootOrgId,
    tenantA,
    deptOne,
    teamOne,
    deptTwo,
    tenantB,
    deptOfB,
  };
}

export const LOGIN = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

interface LoginData {
  login: { accessToken: string };
}

export async function login(
  world: RolesWorld,
  account: string,
): Promise<string> {
  const result = await world.api.graphql<LoginData>(LOGIN, {
    input: { account, password: PASSWORD },
  });
  expect(result.errors).toBeUndefined();
  const token = result.data?.login.accessToken;
  if (!token) {
    throw new Error(`登入失敗:${account}`);
  }
  return token;
}

let accountSequence = 0;

export function nextAccount(prefix: string): string {
  accountSequence += 1;
  return `${prefix}-${String(accountSequence)}`;
}

export interface ManagerOptions {
  /** 操作者的所屬組織(`org_user`)。 */
  orgIds: Types.ObjectId[];
  /** 操作者角色的擁有組織 = 他的**管理範圍**(CONTEXT.md)。 */
  ownerOrgId: Types.ObjectId;
  moduleKeys?: string[];
  permissionKeys?: string[];
}

export interface Manager {
  userId: Types.ObjectId;
  token: string;
  roleId: Types.ObjectId;
  account: string;
}

/** 建一位持有角色管理權限的操作者並登入。 */
export async function createManager(
  world: RolesWorld,
  options: ManagerOptions,
): Promise<Manager> {
  const account = nextAccount("manager");
  const userId = await createUser(world.connection, {
    account,
    password: PASSWORD,
    orgIds: options.orgIds,
  });
  const roleId = await createRole(world.api.app, world.connection, {
    name: `管理員角色:${account}`,
    ownerOrgId: options.ownerOrgId,
    moduleKeys: options.moduleKeys ?? TENANT_MODULE_KEYS,
    permissionKeys: options.permissionKeys ?? TENANT_WILDCARD_KEYS,
    assignTo: [userId],
  });
  return { userId, token: await login(world, account), roleId, account };
}

/** 一般成員(無任何角色),供「加入使用者」的候選規則測試使用。 */
export async function createMember(
  world: RolesWorld,
  orgIds: Types.ObjectId[],
  prefix = "member",
): Promise<Types.ObjectId> {
  return createUser(world.connection, {
    account: nextAccount(prefix),
    password: PASSWORD,
    orgIds,
  });
}

/** `audit_logs` 的一筆(欄位正本 `database/schemas/audit-log.schema.ts`)。 */
export interface AuditRecord {
  action: string;
  targetType?: string;
  targetId?: Types.ObjectId;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export function latestAudit(
  world: RolesWorld,
  action: string,
  targetId?: Types.ObjectId,
): Promise<AuditRecord | null> {
  return world.connection
    .collection("audit_logs")
    .findOne<AuditRecord>(
      { action, ...(targetId ? { targetId } : {}) },
      { sort: { createdAt: -1, _id: -1 } },
    );
}

async function keysOf(
  world: RolesWorld,
  roleId: Types.ObjectId,
  type: "role_module" | "role_permission",
  collection: "modules" | "permissions",
): Promise<string[]> {
  const links = await world.connection
    .collection("core_relationships")
    .find<{ secondId: Types.ObjectId }>({ type, firstId: roleId })
    .toArray();
  const documents = await world.connection
    .collection(collection)
    .find<{ key: string }>({ _id: { $in: links.map((link) => link.secondId) } })
    .toArray();
  return documents
    .map((document) => document.key)
    .toSorted((a, b) => a.localeCompare(b, "zh-Hant"));
}

/** 角色實際落庫的 `role_module` key(斷言「存了什麼」,不是「回了什麼」)。 */
export function storedModuleKeys(
  world: RolesWorld,
  roleId: Types.ObjectId,
): Promise<string[]> {
  return keysOf(world, roleId, "role_module", "modules");
}

/** 角色實際落庫的 `role_permission` key(`*` 的收斂結果就看這裡)。 */
export function storedPermissionKeys(
  world: RolesWorld,
  roleId: Types.ObjectId,
): Promise<string[]> {
  return keysOf(world, roleId, "role_permission", "permissions");
}

/** 不看順序、看成員完全相同(auth.test.ts / users.test.ts 的既有寫法)。 */
export function expectSameMembers(
  actual: readonly string[],
  expected: readonly string[],
): void {
  expect(actual).toHaveLength(expected.length);
  expect(actual).toEqual(expect.arrayContaining([...expected]));
}
