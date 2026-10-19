import { hash } from "@node-rs/argon2";
import { type Connection, Types } from "mongoose";

/**
 * 夾具:seed(子行程跑 db-migrator)建的是根組織、root 帳號、種子角色(super-admin / tenant-admin)、
 * 模組樹、權限、欄位種子;其餘測試資料(租戶、使用者、測試角色)由這裡直接寫入測試資料庫
 * (「再視需要以 RelationService 加測試角色」— 測試檔不受裸查詢禁令約束;TEST-07)。
 */

export interface CreateOrgOptions {
  name: string;
  /** 上層組織 id;不給即掛在根組織下(= 租戶頂層)。 */
  parentId?: Types.ObjectId;
  settings?: Record<string, unknown>;
}

export interface CreateUserOptions {
  account: string;
  password: string;
  enabled?: boolean;
  settings?: Record<string, unknown>;
  /** 所屬組織,依加入順序(第一個 = 登入時預設當前組織)。 */
  orgIds: Types.ObjectId[];
  nationalId?: string;
}

export async function findRootOrgId(
  connection: Connection,
): Promise<Types.ObjectId> {
  const root = await connection
    .collection("orgs")
    .findOne<{ _id: Types.ObjectId }>({ parentId: null });
  if (!root) {
    throw new Error("測試資料庫沒有根組織(seed 未跑?)");
  }
  return root._id;
}

export async function createOrg(
  connection: Connection,
  options: CreateOrgOptions,
): Promise<Types.ObjectId> {
  const orgs = connection.collection("orgs");
  const parentId = options.parentId ?? (await findRootOrgId(connection));
  const parent = await orgs.findOne<{ ancestors: Types.ObjectId[] }>({
    _id: parentId,
  });
  const now = new Date();
  const { insertedId } = await orgs.insertOne({
    name: options.name,
    parentId,
    ancestors: [...(parent?.ancestors ?? []), parentId],
    isSystem: false,
    enabled: true,
    settings: options.settings ?? {},
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  });
  return insertedId;
}

export async function createUser(
  connection: Connection,
  options: CreateUserOptions,
): Promise<Types.ObjectId> {
  const now = new Date();
  const { insertedId } = await connection.collection("users").insertOne({
    name: options.account,
    account: options.account,
    email: `${options.account}@example.com`,
    passwordHash: await hash(options.password),
    enabled: options.enabled ?? true,
    settings: options.settings ?? {},
    ...(options.nationalId === undefined
      ? {}
      : { nationalId: options.nationalId }),
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  });
  const userId = insertedId;
  // 加入時間依序遞增,讓「所屬組織第一個」有確定答案
  await connection.collection("core_relationships").insertMany(
    options.orgIds.map((orgId, index) => ({
      type: "org_user",
      firstId: orgId,
      secondId: userId,
      thirdId: null,
      createdAt: new Date(now.getTime() + index),
      updatedAt: new Date(now.getTime() + index),
      createdBy: null,
      updatedBy: null,
      deletedAt: null,
    })),
  );
  return userId;
}

export async function setUserEnabled(
  connection: Connection,
  userId: Types.ObjectId,
  enabled: boolean,
): Promise<void> {
  await connection
    .collection("users")
    .updateOne({ _id: userId }, { $set: { enabled } });
}

export function newObjectId(): Types.ObjectId {
  return new Types.ObjectId();
}
