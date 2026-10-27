import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import type { Connection, Schema } from "mongoose";

import {
  HOOK_TIMEOUT_MS,
  type TestDatabase,
  openTestDatabase,
} from "../test-support/mongo-connection";
import { ActionToken, ActionTokenSchema } from "./action-token.schema";
import { AuditLog, AuditLogSchema } from "./audit-log.schema";
import {
  BusinessRelationship,
  BusinessRelationshipSchema,
} from "./business-relationship.schema";
import {
  CoreRelationship,
  CoreRelationshipSchema,
} from "./core-relationship.schema";
import { Customer, CustomerSchema } from "./customer.schema";
import { DataScopeRule, DataScopeRuleSchema } from "./data-scope-rule.schema";
import {
  DataScopeTarget,
  DataScopeTargetSchema,
} from "./data-scope-target.schema";
import { DemoItemOne, DemoItemOneSchema } from "./demo-item-one.schema";
import { DemoItemTwo, DemoItemTwoSchema } from "./demo-item-two.schema";
import { FieldCategory, FieldCategorySchema } from "./field-category.schema";
import { Field, FieldSchema } from "./field.schema";
import { Module, ModuleSchema } from "./module.schema";
import {
  NotificationSetting,
  NotificationSettingSchema,
} from "./notification-setting.schema";
import {
  NOTIFICATION_RETENTION_DAYS,
  Notification,
  NotificationSchema,
} from "./notification.schema";
import { Org, OrgSchema } from "./org.schema";
import { Permission, PermissionSchema } from "./permission.schema";
import { RefreshToken, RefreshTokenSchema } from "./refresh-token.schema";
import { Role, RoleSchema } from "./role.schema";
import {
  SidebarBadgeSetting,
  SidebarBadgeSettingSchema,
} from "./sidebar-badge-setting.schema";
import { UserDelegation, UserDelegationSchema } from "./user-delegation.schema";
import { UserPreference, UserPreferenceSchema } from "./user-preference.schema";
import { User, UserSchema } from "./user.schema";

interface IndexInfo {
  key: Record<string, number>;
  unique?: boolean;
  sparse?: boolean;
  expireAfterSeconds?: number;
  partialFilterExpression?: Record<string, unknown>;
}

/** 索引的正本:各 schema 檔的 `.index(...)` 宣告(地圖見 docs/data-model.md)。 */
const REGISTRY: { name: string; schema: Schema }[] = [
  { name: Org.name, schema: OrgSchema },
  { name: User.name, schema: UserSchema },
  { name: Customer.name, schema: CustomerSchema },
  { name: Role.name, schema: RoleSchema },
  { name: Module.name, schema: ModuleSchema },
  { name: Permission.name, schema: PermissionSchema },
  { name: CoreRelationship.name, schema: CoreRelationshipSchema },
  { name: BusinessRelationship.name, schema: BusinessRelationshipSchema },
  { name: DataScopeRule.name, schema: DataScopeRuleSchema },
  { name: DataScopeTarget.name, schema: DataScopeTargetSchema },
  { name: FieldCategory.name, schema: FieldCategorySchema },
  { name: Field.name, schema: FieldSchema },
  { name: DemoItemOne.name, schema: DemoItemOneSchema },
  { name: DemoItemTwo.name, schema: DemoItemTwoSchema },
  { name: RefreshToken.name, schema: RefreshTokenSchema },
  { name: ActionToken.name, schema: ActionTokenSchema },
  { name: AuditLog.name, schema: AuditLogSchema },
  { name: UserPreference.name, schema: UserPreferenceSchema },
  { name: UserDelegation.name, schema: UserDelegationSchema },
  { name: Notification.name, schema: NotificationSchema },
  { name: NotificationSetting.name, schema: NotificationSettingSchema },
  { name: SidebarBadgeSetting.name, schema: SidebarBadgeSettingSchema },
];

async function readIndexes(
  connection: Connection,
  modelName: string,
): Promise<IndexInfo[]> {
  const raw = await connection
    .model(modelName)
    .collection.listIndexes()
    .toArray();
  return raw as IndexInfo[];
}

function findIndex(
  indexes: IndexInfo[],
  key: Record<string, number>,
): IndexInfo | undefined {
  const target = JSON.stringify(key);
  return indexes.find((index) => JSON.stringify(index.key) === target);
}

describe("底座 collection 索引就位(對真 MongoDB 驗證)", () => {
  let database: TestDatabase;
  const indexesByModel = new Map<string, IndexInfo[]>();

  const indexesOf = (modelName: string): IndexInfo[] => {
    const indexes = indexesByModel.get(modelName);
    if (!indexes) {
      throw new Error(`索引未載入:${modelName}`);
    }
    return indexes;
  };

  beforeAll(async () => {
    database = await openTestDatabase("cookhome-test-indexes");
    for (const { name, schema } of REGISTRY) {
      const model = database.connection.model(name, schema);
      await model.syncIndexes();
      indexesByModel.set(name, await readIndexes(database.connection, name));
    }
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  }, HOOK_TIMEOUT_MS);

  it("全部 collection 皆已建模並可建立索引", () => {
    expect(indexesByModel.size).toBe(22);
  });

  it("orgs:unique(key sparse)+ unique(slug sparse)+(parentId)+(ancestors)", () => {
    const indexes = indexesOf(Org.name);
    const keyIndex = findIndex(indexes, { key: 1 });
    expect(keyIndex?.unique).toBe(true);
    expect(keyIndex?.sparse).toBe(true);
    const slugIndex = findIndex(indexes, { slug: 1 });
    expect(slugIndex?.unique).toBe(true);
    expect(slugIndex?.sparse).toBe(true);
    expect(findIndex(indexes, { parentId: 1 })).toBeDefined();
    expect(findIndex(indexes, { ancestors: 1 })).toBeDefined();
  });

  it("users / customers:unique(account)+unique(email)", () => {
    for (const name of [User.name, Customer.name]) {
      const indexes = indexesOf(name);
      expect(findIndex(indexes, { account: 1 })?.unique).toBe(true);
      expect(findIndex(indexes, { email: 1 })?.unique).toBe(true);
    }
  });

  it("roles:unique(key sparse)", () => {
    const keyIndex = findIndex(indexesOf(Role.name), { key: 1 });
    expect(keyIndex?.unique).toBe(true);
    expect(keyIndex?.sparse).toBe(true);
  });

  it("modules:unique(key)+(ancestors)", () => {
    const indexes = indexesOf(Module.name);
    expect(findIndex(indexes, { key: 1 })?.unique).toBe(true);
    expect(findIndex(indexes, { ancestors: 1 })).toBeDefined();
  });

  it("permissions:unique(key)+(moduleId)", () => {
    const indexes = indexesOf(Permission.name);
    expect(findIndex(indexes, { key: 1 })?.unique).toBe(true);
    expect(findIndex(indexes, { moduleId: 1 })).toBeDefined();
  });

  it("core_relationships:unique 複合 + org_role second 側唯一 + 查詢用索引", () => {
    const indexes = indexesOf(CoreRelationship.name);
    expect(
      findIndex(indexes, {
        type: 1,
        firstId: 1,
        secondId: 1,
        thirdId: 1,
      })?.unique,
    ).toBe(true);
    const orgRoleUnique = indexes.find(
      (index) =>
        index.unique === true &&
        index.partialFilterExpression?.type === "org_role",
    );
    expect(orgRoleUnique).toBeDefined();
    expect(findIndex(indexes, { type: 1, firstId: 1 })).toBeDefined();
    expect(findIndex(indexes, { type: 1, secondId: 1 })).toBeDefined();
  });

  it("business_relationships:unique(tenantId, type, firstId, secondId)", () => {
    expect(
      findIndex(indexesOf(BusinessRelationship.name), {
        tenantId: 1,
        type: 1,
        firstId: 1,
        secondId: 1,
      })?.unique,
    ).toBe(true);
  });

  it("data_scope_rules / data_scope_targets:unique(collection, moduleKey)", () => {
    for (const name of [DataScopeRule.name, DataScopeTarget.name]) {
      const indexes = indexesOf(name);
      expect(findIndex(indexes, { collection: 1, moduleKey: 1 })?.unique).toBe(
        true,
      );
      expect(findIndex(indexes, { collection: 1 })).toBeUndefined();
    }
  });

  it("field_categories:unique(key);fields:(categoryId, orgId)+ unique(key sparse)+ unique(categoryId, orgId, value)", () => {
    expect(findIndex(indexesOf(FieldCategory.name), { key: 1 })?.unique).toBe(
      true,
    );
    const fieldIndexes = indexesOf(Field.name);
    expect(findIndex(fieldIndexes, { categoryId: 1, orgId: 1 })).toBeDefined();
    const fieldKey = findIndex(fieldIndexes, { key: 1 });
    expect(fieldKey?.unique).toBe(true);
    expect(fieldKey?.sparse).toBe(true);
    // 同一類別、同一組織下 value 不可重複(field-manager.md「待辦」)
    expect(
      findIndex(fieldIndexes, { categoryId: 1, orgId: 1, value: 1 })?.unique,
    ).toBe(true);
  });

  it("demo_items_one / two:(orgId, createdAt)+ 模組資料的(tenantId, moduleKey, createdAt)與(moduleKey, orgId)", () => {
    for (const name of [DemoItemOne.name, DemoItemTwo.name]) {
      const indexes = indexesOf(name);
      expect(findIndex(indexes, { orgId: 1, createdAt: 1 })).toBeDefined();
      expect(
        findIndex(indexes, { tenantId: 1, moduleKey: 1, createdAt: 1 }),
      ).toBeDefined();
      expect(findIndex(indexes, { moduleKey: 1, orgId: 1 })).toBeDefined();
    }
  });

  it("refresh_tokens:(accountType, accountId)+ TTL(expiresAt)", () => {
    const indexes = indexesOf(RefreshToken.name);
    expect(findIndex(indexes, { accountType: 1, accountId: 1 })).toBeDefined();
    expect(findIndex(indexes, { expiresAt: 1 })?.expireAfterSeconds).toBe(0);
  });

  it("action_tokens:(userId)+ TTL(expiresAt)", () => {
    const indexes = indexesOf(ActionToken.name);
    expect(findIndex(indexes, { userId: 1 })).toBeDefined();
    expect(findIndex(indexes, { expiresAt: 1 })?.expireAfterSeconds).toBe(0);
  });

  it("audit_logs:(orgId, createdAt)+(targetType, targetId)", () => {
    const indexes = indexesOf(AuditLog.name);
    expect(findIndex(indexes, { orgId: 1, createdAt: 1 })).toBeDefined();
    expect(findIndex(indexes, { targetType: 1, targetId: 1 })).toBeDefined();
  });

  it("user_preferences:userId 唯一(每個使用者一筆)", () => {
    const indexes = indexesOf(UserPreference.name);
    expect(findIndex(indexes, { userId: 1 })?.unique).toBe(true);
  });

  it("user_delegations:(userId, startAt)(個人清單、派任時查代理期間)", () => {
    const indexes = indexesOf(UserDelegation.name);
    expect(findIndex(indexes, { userId: 1, startAt: 1 })).toBeDefined();
  });

  it("notifications:(recipientId, dedupeKey) 唯一;createdAt 90 天 TTL;清單與未讀數的索引", () => {
    const indexes = indexesOf(Notification.name);
    expect(findIndex(indexes, { recipientId: 1, dedupeKey: 1 })?.unique).toBe(
      true,
    );
    expect(findIndex(indexes, { createdAt: 1 })?.expireAfterSeconds).toBe(
      NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60,
    );
    expect(
      findIndex(indexes, { recipientId: 1, channels: 1, createdAt: -1 }),
    ).toBeDefined();
    expect(
      findIndex(indexes, { recipientId: 1, channels: 1, readAt: 1 }),
    ).toBeDefined();
  });

  it("notification_settings:(tenantId, type) 唯一", () => {
    const indexes = indexesOf(NotificationSetting.name);
    expect(findIndex(indexes, { tenantId: 1, type: 1 })?.unique).toBe(true);
  });

  it("sidebar_badge_settings:(tenantId, moduleKey) 唯一", () => {
    const indexes = indexesOf(SidebarBadgeSetting.name);
    expect(findIndex(indexes, { tenantId: 1, moduleKey: 1 })?.unique).toBe(
      true,
    );
  });
});
