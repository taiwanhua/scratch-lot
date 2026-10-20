import type { INestApplication } from "@nestjs/common";
import type { Connection, Types } from "mongoose";

import type { OperatorContext } from "../../database/operator-context";
import { RelationService } from "../../database/relation.service";

/**
 * 夾具(驗收條件:「seed 後以 RelationService 建測試角色與使用者」):
 * 角色文件直接寫入測試資料庫,關聯一律走 RelationService 的具名方法(ADR-0001 唯一出口)。
 * 模組與權限來自 seed(apps/db-migrator/seeds/),以 key 查 id。
 */

/** 夾具寫關聯時的操作者(測試不關心 createdBy)。 */
const SYSTEM: OperatorContext = {
  actorId: null,
  currentOrgId: null,
  visibleOrgIds: "all",
  managedOrgIds: "all",
  memberOrgIds: [],
  roleIds: [],
  memberTenants: [],
};

export interface CreateRoleOptions {
  name: string;
  /** 擁有組織(org_role)。 */
  ownerOrgId: Types.ObjectId;
  /** 綁定的模組 key(role_module;樹要自己給完整,矩陣 UI 的連動不在此)。 */
  moduleKeys?: string[];
  /** 綁定的權限 key(role_permission;全給時只給 `<模組key>.*` 一筆)。 */
  permissionKeys?: string[];
  /** 授予給哪些使用者(user_role)。 */
  assignTo?: Types.ObjectId[];
}

async function findIdByKey(
  connection: Connection,
  collection: "modules" | "permissions",
  key: string,
): Promise<Types.ObjectId> {
  const found = await connection
    .collection(collection)
    .findOne<{ _id: Types.ObjectId }>({ key });
  if (!found) {
    throw new Error(`測試資料庫沒有 ${collection} key=${key}(seed 未跑?)`);
  }
  return found._id;
}

export function findModuleIdByKey(
  connection: Connection,
  key: string,
): Promise<Types.ObjectId> {
  return findIdByKey(connection, "modules", key);
}

export function findPermissionIdByKey(
  connection: Connection,
  key: string,
): Promise<Types.ObjectId> {
  return findIdByKey(connection, "permissions", key);
}

/** 建測試角色並綁模組 / 權限 / 授予使用者;回傳 roleId。 */
export async function createRole(
  app: INestApplication,
  connection: Connection,
  options: CreateRoleOptions,
): Promise<Types.ObjectId> {
  const now = new Date();
  const { insertedId: roleId } = await connection
    .collection("roles")
    .insertOne({
      name: options.name,
      enabled: true,
      isSystem: false,
      settings: {},
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
      deletedAt: null,
    });
  const relations = app.get(RelationService);
  await relations.setRoleOwnerOrg(SYSTEM, options.ownerOrgId, roleId);
  for (const moduleKey of options.moduleKeys ?? []) {
    await relations.bindModuleToRole(
      SYSTEM,
      roleId,
      await findModuleIdByKey(connection, moduleKey),
    );
  }
  for (const permissionKey of options.permissionKeys ?? []) {
    await relations.bindPermissionToRole(
      SYSTEM,
      roleId,
      await findPermissionIdByKey(connection, permissionKey),
    );
  }
  for (const userId of options.assignTo ?? []) {
    await relations.assignRoleToUser(SYSTEM, userId, roleId);
  }
  return roleId;
}

/** 模組的 enabled 是 seed 後由人在系統內管理的欄位(ADR-0002);測試直接改資料庫模擬「模組與權限」頁的停用。 */
export async function setModuleEnabled(
  connection: Connection,
  key: string,
  enabled: boolean,
): Promise<void> {
  const { matchedCount } = await connection
    .collection("modules")
    .updateOne({ key }, { $set: { enabled } });
  if (matchedCount === 0) {
    throw new Error(`測試資料庫沒有模組 key=${key}(seed 未跑?)`);
  }
}

/** 角色的 enabled 由人在角色管理停用;測試直接改資料庫模擬。 */
export async function setRoleEnabled(
  connection: Connection,
  roleId: Types.ObjectId,
  enabled: boolean,
): Promise<void> {
  await connection
    .collection("roles")
    .updateOne({ _id: roleId }, { $set: { enabled } });
}

/** 權限的 enabled 是全域 kill switch(seed 後由人在「模組與權限」頁停用);測試直接改資料庫模擬。 */
export async function setPermissionEnabled(
  connection: Connection,
  key: string,
  enabled: boolean,
): Promise<void> {
  const { matchedCount } = await connection
    .collection("permissions")
    .updateOne({ key }, { $set: { enabled } });
  if (matchedCount === 0) {
    throw new Error(`測試資料庫沒有權限 key=${key}(seed 未跑?)`);
  }
}
