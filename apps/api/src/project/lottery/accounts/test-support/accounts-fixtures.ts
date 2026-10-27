import type { Connection, Types } from "mongoose";

import {
  ACCOUNTS_MODULE_KEYS,
  ACCOUNTS_PERMISSIONS,
} from "@repo/domain/project/lottery-accounts";

import type { AuthTestApp } from "../../../../auth/test-support/auth-app";
import { createUser } from "../../../../auth/test-support/fixtures";
import { login } from "../../../../demo-items-two/test-support/fixtures";
import { createRole } from "../../../../permission/test-support/fixtures";
import { PASSWORD } from "../../test-support/master-data-fixtures";

/**
 * 帳戶管理測試的共用夾具。api 測試的資料庫只種底座,專案的模組樹與權限由這裡寫進**隔離的測試資料庫**
 * (形狀同 seed `seeds/project/accounts.ts`)。另加一條只給測試單據用的收付權限 `accounts.test-settle`
 * (真的單據的權限由進貨單 / 調貨單的模組宣告)。
 */

/** 測試單據那一邊的收付權限(只存在測試資料庫)。 */
export const TEST_SETTLE_PERMISSION = "accounts.test-settle";

function baseFields(now: Date): Record<string, unknown> {
  return {
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  };
}

/** 寫入帳戶管理的模組樹與個別權限(每個測試資料庫呼叫一次)。 */
export async function seedAccountsAuthorization(
  connection: Connection,
): Promise<void> {
  const now = new Date();
  const modules = connection.collection("modules");
  const { insertedId: listId } = await modules.insertOne({
    key: ACCOUNTS_MODULE_KEYS.list,
    name: "帳戶管理",
    parentId: null,
    ancestors: [],
    route: "accounts",
    sidebarType: "link",
    order: 40,
    enabled: true,
    isSystem: false,
    icon: null,
    settings: {},
    engine: "fixed",
    ...baseFields(now),
  });
  await modules.insertOne({
    key: ACCOUNTS_MODULE_KEYS.bankAccountViewPage,
    name: "銀行帳戶詳情",
    parentId: listId,
    ancestors: [listId],
    route: "view-page",
    sidebarType: "hidden",
    order: 1,
    enabled: true,
    isSystem: false,
    icon: null,
    settings: {},
    engine: "fixed",
    ...baseFields(now),
  });
  await connection.collection("permissions").insertMany(
    [...Object.values(ACCOUNTS_PERMISSIONS), TEST_SETTLE_PERMISSION].map(
      (key) => ({
        key,
        moduleId: listId,
        name: key,
        enabled: true,
        isSystem: false,
        settings: {},
        source: "seed",
        retiredAt: null,
        ...baseFields(now),
      }),
    ),
  );
}

let accountSequence = 0;

/** 建一個操作者並登入(當前組織 = 所屬組織);回 token 與使用者 id。 */
export async function createAccountsOperator(
  api: AuthTestApp,
  connection: Connection,
  options: {
    orgId: Types.ObjectId;
    ownerOrgId?: Types.ObjectId;
    permissionKeys: readonly string[];
    withModule?: boolean;
  },
): Promise<{ token: string; userId: Types.ObjectId }> {
  accountSequence += 1;
  const account = `accounts-${String(accountSequence)}`;
  const userId = await createUser(connection, {
    account,
    password: PASSWORD,
    orgIds: [options.orgId],
  });
  await createRole(api.app, connection, {
    name: `帳戶管理角色:${account}`,
    ownerOrgId: options.ownerOrgId ?? options.orgId,
    moduleKeys:
      options.withModule === false
        ? []
        : [ACCOUNTS_MODULE_KEYS.list, ACCOUNTS_MODULE_KEYS.bankAccountViewPage],
    permissionKeys: [...options.permissionKeys],
    assignTo: [userId],
  });
  return { token: await login(api, account, PASSWORD), userId };
}

let submissionSequence = 0;

/** 直接寫一筆表單提交(測試單據;形狀同 `form_submissions`)。 */
export async function insertTestSubmission(
  connection: Connection,
  options: {
    orgId: Types.ObjectId;
    tenantId: Types.ObjectId;
    moduleKey: string;
    values: Record<string, unknown>;
    status?: string;
    submittedAt?: Date;
  },
): Promise<Types.ObjectId> {
  const now = new Date();
  const { insertedId } = await connection
    .collection("form_submissions")
    .insertOne({
      orgId: options.orgId,
      tenantId: options.tenantId,
      moduleKey: options.moduleKey,
      formKey: "test_doc",
      version: 1,
      values: options.values,
      summary: null,
      status: options.status ?? "reviewing",
      revision: 1,
      revisions: [],
      editVersion: 1,
      touched: [],
      clientRequestId: `test-${String(++submissionSequence)}`,
      submittedAt: options.submittedAt ?? now,
      currentInstanceId: null,
      blocked: false,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
      replacedById: null,
      copiedFrom: null,
      ...baseFields(now),
    });
  return insertedId;
}
