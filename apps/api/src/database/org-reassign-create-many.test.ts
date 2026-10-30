import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { GraphQLError } from "graphql";
import { type HydratedDocument, type Model, Schema, Types } from "mongoose";

import { BaseRepository } from "./base.repository";
import type { MemberTenant, OperatorContext } from "./operator-context";
import * as orgReassign from "./org-reassign";
import { baseFieldsPlugin } from "./plugins/base-fields.plugin";
import {
  type ShareOrg,
  TenantScopeError,
  tenantScopePlugin,
} from "./plugins/tenant-scope.plugin";
import { AuditLog, AuditLogSchema } from "./schemas/audit-log.schema";
import {
  HOOK_TIMEOUT_MS,
  type TestDatabase,
  openTestDatabase,
} from "./test-support/mongo-connection";
import { TransactionService, currentSession } from "./transaction";

/**
 * 搬家(`reassignOrg`)與一次寫多筆(`createMany`)對真 MongoDB replica set 的測試
 * (ADR-0005「例外出口」;權限劇本:搬出看得到 / 搬入看不到 / 別租戶擋下)。
 */

interface Item {
  orgId: Types.ObjectId;
  name: string;
  status: string;
  editVersion: number;
  moduleKey: string;
  tenantId: Types.ObjectId | null;
  shareOrgs?: ShareOrg[];
}

type Repo = BaseRepository<Item, HydratedDocument<Item>>;

// ---- 組織樹:根 → 租戶甲(T)→ 分店一(B1)、分店二(B2);根 → 租戶乙(U)→ U1 ----
const root = new Types.ObjectId();
const T = new Types.ObjectId();
const B1 = new Types.ObjectId();
const B2 = new Types.ObjectId();
const U = new Types.ObjectId();
const U1 = new Types.ObjectId();

const ORGS = [
  { _id: root, ancestors: [] as Types.ObjectId[] },
  { _id: T, ancestors: [root] },
  { _id: B1, ancestors: [root, T] },
  { _id: B2, ancestors: [root, T] },
  { _id: U, ancestors: [root] },
  { _id: U1, ancestors: [root, U] },
];

/** 只看得到自己所屬組織的人(所屬租戶依組織樹推)。 */
function staffOf(...orgs: Types.ObjectId[]): OperatorContext {
  const tenants: MemberTenant[] = [];
  for (const org of orgs) {
    const chain = ORGS.find((item) => item._id.equals(org))?.ancestors ?? [];
    const tenantId = chain[1] ?? org;
    tenants.push({ tenantId, memberOrgIds: [org], ancestorOrgIds: [] });
  }
  return {
    actorId: new Types.ObjectId(),
    currentOrgId: orgs[0] ?? null,
    visibleOrgIds: orgs,
    managedOrgIds: [],
    memberOrgIds: orgs,
    roleIds: [],
    memberTenants: tenants,
  };
}

/** 清單的第一筆;空清單 → 拋錯(測試資料沒建起來)。 */
function firstOf<TValue>(values: readonly TValue[]): TValue {
  const [value] = values;
  if (value === undefined) {
    throw new Error("清單是空的");
  }
  return value;
}

/** id 字串排序(比對「同一批」用,不看順序)。 */
function sorted(values: readonly string[]): string[] {
  return values.toSorted((left, right) => left.localeCompare(right, "zh-Hant"));
}

function isValidationFailed(error: unknown, field: string): boolean {
  return (
    error instanceof GraphQLError &&
    error.extensions.code === "VALIDATION_FAILED" &&
    Array.isArray(error.extensions.fields) &&
    error.extensions.fields.includes(field)
  );
}

describe("BaseRepository 的搬家與一次寫多筆(對真 MongoDB replica set)", () => {
  let database: TestDatabase;
  let items: Repo;
  let shared: Repo;
  let auditModel: Model<AuditLog>;
  let transactions: TransactionService;

  const asB1 = staffOf(B1);
  const asB2 = staffOf(B2);
  const asU1 = staffOf(U1);

  beforeAll(async () => {
    database = await openTestDatabase("cookhome-test-org-reassign");
    await database.connection.collection("orgs").insertMany(
      ORGS.map((org) => ({
        ...org,
        name: String(org._id),
        parentId: org.ancestors.at(-1) ?? null,
        deletedAt: null,
      })),
    );
    const schemaOf = (collection: string, shareable: boolean): Schema => {
      const schema = new Schema<Item>(
        {
          orgId: { type: Schema.Types.ObjectId, required: true },
          name: { type: String, required: true },
          status: { type: String, default: "open" },
          editVersion: { type: Number, default: 0 },
        },
        { collection, timestamps: true },
      );
      schema.index({ tenantId: 1, name: 1 }, { unique: true });
      schema.plugin(baseFieldsPlugin);
      schema.plugin(tenantScopePlugin, {
        moduleData: true,
        ...(shareable
          ? {
              sharing: {
                mode: "shareable",
                defaultShareOrgs: "none",
                editable: true,
              },
            }
          : {}),
      });
      schema.path("moduleKey").default("reassign-test");
      return schema;
    };
    const itemModel = database.connection.model<Item>(
      "ReassignItem",
      schemaOf("reassign_items", false),
    );
    const sharedModel = database.connection.model<Item>(
      "ReassignSharedItem",
      schemaOf("reassign_shared_items", true),
    );
    auditModel = database.connection.model<AuditLog>(
      AuditLog.name,
      AuditLogSchema,
    );
    // 交易內不能隱式建 collection:先把 collection 與索引建好(正式環境由 api 啟動時建)
    await Promise.all([
      itemModel.init(),
      sharedModel.init(),
      auditModel.init(),
    ]);
    items = new BaseRepository(itemModel);
    shared = new BaseRepository(sharedModel);
    transactions = new TransactionService(database.connection);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  }, HOOK_TIMEOUT_MS);

  async function orgOf(
    operator: OperatorContext,
    id: Types.ObjectId,
  ): Promise<string | null> {
    const found = await items.findById(operator, id);
    return found === null ? null : String(found.orgId);
  }

  async function auditsOf(targetId: Types.ObjectId): Promise<AuditLog[]> {
    // audit_logs 掛租戶過濾:測試直接以原生 collection 讀
    return database.connection
      .collection<AuditLog>("audit_logs")
      .find({ targetId, action: orgReassign.ORG_REASSIGN_AUDIT_ACTION })
      .toArray();
  }

  /** 搬家必須在交易內:測試一律包一層交易(同正式呼叫端)。 */
  const reassign: Repo["reassignOrg"] = (...args) =>
    transactions.withTransaction(() => items.reassignOrg(...args));

  /** 批次搬家同樣一律包一層交易。 */
  const reassignMany: Repo["reassignOrgMany"] = (...args) =>
    transactions.withTransaction(() => items.reassignOrgMany(...args));

  /** 分店一建一批資料(名稱 `<prefix>-0000` 起),回 id。 */
  async function createBatch(
    prefix: string,
    count: number,
  ): Promise<Types.ObjectId[]> {
    const created = await transactions.withTransaction(() =>
      items.createMany(
        asB1,
        Array.from({ length: count }, (_unused, index) => ({
          name: `${prefix}-${String(index).padStart(4, "0")}`,
        })),
      ),
    );
    return created.map((document) => document._id);
  }

  /** 這批 id 的批次搬家稽核(`after.ids` 含其中任一)。 */
  async function batchAudits(ids: Types.ObjectId[]): Promise<AuditLog[]> {
    return database.connection
      .collection<AuditLog>("audit_logs")
      .find({
        action: orgReassign.ORG_REASSIGN_AUDIT_ACTION,
        "after.ids": { $in: ids.map(String) },
      })
      .toArray();
  }

  describe("搬家(reassignOrg)", () => {
    it("不在交易內 → TenantScopeError(搬家與稽核要一起成功或一起回復)", async () => {
      const item = await items.create(asB1, { name: "交易外搬家" });
      await expect(
        items.reassignOrg(asB1, { _id: item._id }, B2),
      ).rejects.toThrow(TenantScopeError);
      expect(await orgOf(asB1, item._id)).toBe(String(B1));
    });

    it("搬到原本所在的組織:冪等,不寫入、不記稽核,回原文件", async () => {
      const item = await items.create(asB1, { name: "原地搬家" });
      const same = await reassign(asB1, { _id: item._id }, B1, {
        update: { $inc: { editVersion: 1 } },
      });
      expect(String(same?._id)).toBe(String(item._id));
      expect(String(same?.orgId)).toBe(String(B1));
      expect(same?.editVersion).toBe(0);
      const reread = await items.findById(asB1, item._id);
      expect(reread?.editVersion).toBe(0);
      expect(String(reread?.updatedAt)).toBe(String(item.updatedAt));
      expect(await auditsOf(item._id)).toHaveLength(0);
    });

    it("一般更新帶 orgId 仍拋錯", async () => {
      const item = await items.create(asB1, { name: "一般更新" });
      await expect(
        items.updateById(asB1, item._id, { $set: { orgId: B2 } }),
      ).rejects.toThrow(TenantScopeError);
      await expect(
        items.findOneAndUpdate(asB1, { _id: item._id }, { orgId: B2 }),
      ).rejects.toThrow(TenantScopeError);
    });

    it("搬到看不到的同租戶分店可以:搬完舊店看不到、新店看得到,tenantId 不變,稽核一筆(誰、從哪到哪)", async () => {
      const item = await items.create(asB1, { name: "搬家一" });
      const moved = await reassign(asB1, { _id: item._id }, B2);
      expect(moved?.orgId.equals(B2)).toBe(true);
      expect(moved?.tenantId?.equals(T)).toBe(true);
      expect(await items.findById(asB1, item._id)).toBeNull();
      const atNewStore = await items.findById(asB2, item._id);
      expect(atNewStore?.name).toBe("搬家一");
      const audits = await auditsOf(item._id);
      expect(audits).toHaveLength(1);
      expect(String(audits[0]?.actorId)).toBe(String(asB1.actorId));
      expect(audits[0]?.targetType).toBe("reassign_items");
      expect(String(audits[0]?.before?.orgId)).toBe(String(B1));
      expect(String(audits[0]?.after?.orgId)).toBe(String(B2));
    });

    it("可見範圍外的資料搬不了(回 null、不寫稽核)", async () => {
      const item = await items.create(asB2, { name: "別店的" });
      expect(await reassign(asB1, { _id: item._id }, B1)).toBeNull();
      expect(await orgOf(asB2, item._id)).toBe(String(B2));
      expect(await auditsOf(item._id)).toHaveLength(0);
    });

    it("搬到別租戶、根組織、不存在的組織 → VALIDATION_FAILED(orgId),資料不動", async () => {
      const item = await items.create(asB1, { name: "不准搬" });
      for (const target of [U1, U, root, new Types.ObjectId(), "not-an-id"]) {
        const error: unknown = await reassign(
          asB1,
          { _id: item._id },
          target,
        ).catch((error_: unknown) => error_);
        expect(isValidationFailed(error, "orgId")).toBe(true);
      }
      expect(await orgOf(asB1, item._id)).toBe(String(B1));
      expect(await auditsOf(item._id)).toHaveLength(0);
    });

    it("別租戶的人搬不到本租戶的資料(看不到 = null)", async () => {
      const item = await items.create(asB1, { name: "別租戶的人" });
      expect(await reassign(asU1, { _id: item._id }, B2)).toBeNull();
    });

    it("條件更新:版本不符回 null;符合時同一次寫入改其他欄位;options.update 不得碰 orgId / tenantId", async () => {
      const item = await items.create(asB1, { name: "條件搬" });
      expect(
        await reassign(asB1, { _id: item._id, editVersion: 9 }, B2),
      ).toBeNull();
      const moved = await reassign(
        asB1,
        { _id: item._id, editVersion: 0 },
        B2,
        { update: { $set: { status: "moved" }, $inc: { editVersion: 1 } } },
      );
      expect(moved?.status).toBe("moved");
      expect(moved?.editVersion).toBe(1);
      const other = await items.create(asB1, { name: "偷改租戶" });
      await expect(
        reassign(asB1, { _id: other._id }, B2, {
          update: { $set: { tenantId: U } },
        }),
      ).rejects.toThrow(TenantScopeError);
    });

    it("在交易內:交易回復時搬家與稽核一起回復", async () => {
      const item = await items.create(asB1, { name: "交易回復" });
      await expect(
        transactions.withTransaction(async () => {
          await items.reassignOrg(asB1, { _id: item._id }, B2);
          throw new Error("後續步驟失敗");
        }),
      ).rejects.toThrow("後續步驟失敗");
      expect(await orgOf(asB1, item._id)).toBe(String(B1));
      expect(await auditsOf(item._id)).toHaveLength(0);
    });
  });

  describe("批次搬家(reassignOrgMany)", () => {
    it("不在交易內 → TenantScopeError", async () => {
      const ids = await createBatch("批次交易外", 2);
      await expect(items.reassignOrgMany(asB1, ids, B2)).rejects.toThrow(
        TenantScopeError,
      );
      expect(await orgOf(asB1, firstOf(ids))).toBe(String(B1));
    });

    it("整批成功:全部搬到新店、各自帶版本條件與同一份 update,只寫一筆稽核(id 清單與筆數)", async () => {
      const ids = await createBatch("批次成功", 3);
      const result = await reassignMany(asB1, ids, B2, {
        expected: Object.fromEntries(
          ids.map((id) => [String(id), { editVersion: 0 }]),
        ),
        update: { $set: { status: "moved" }, $inc: { editVersion: 1 } },
      });
      expect(result.mismatched).toEqual([]);
      expect(sorted(result.moved.map(String))).toEqual(sorted(ids.map(String)));
      for (const id of ids) {
        expect(await items.findById(asB1, id)).toBeNull();
        const atNewStore = await items.findById(asB2, id);
        expect(atNewStore?.orgId.equals(B2)).toBe(true);
        expect(atNewStore?.tenantId?.equals(T)).toBe(true);
        expect(atNewStore?.status).toBe("moved");
        expect(atNewStore?.editVersion).toBe(1);
      }
      const audits = await batchAudits(ids);
      expect(audits).toHaveLength(1);
      expect(String(audits[0]?.actorId)).toBe(String(asB1.actorId));
      expect(audits[0]?.targetType).toBe("reassign_items");
      expect(audits[0]?.after?.count).toBe(3);
      expect(String(audits[0]?.after?.orgId)).toBe(String(B2));
      expect(sorted(audits[0]?.after?.ids as string[])).toEqual(
        sorted(ids.map(String)),
      );
      expect((audits[0]?.before?.orgIds as unknown[]).map(String)).toEqual([
        String(B1),
      ]);
      // 單筆搬家的稽核查詢(targetId)不會誤把批次那筆算進去
      expect(await auditsOf(firstOf(ids))).toHaveLength(0);
    });

    it("以條件(filter)選資料也可以;已在目標組織的跳過(冪等,不再寫稽核)", async () => {
      const ids = await createBatch("批次條件", 2);
      const first = await reassignMany(asB1, { name: /^批次條件-/ }, B2);
      expect(first.moved).toHaveLength(2);
      const again = await reassignMany(asB2, { name: /^批次條件-/ }, B2);
      expect(again.moved).toEqual([]);
      expect(sorted(again.skipped.map(String))).toEqual(
        sorted(ids.map(String)),
      );
      expect(await batchAudits(ids)).toHaveLength(1);
    });

    it("其中一筆版本不符 → 整批不動、回傳不符的那幾筆、不寫稽核", async () => {
      const ids = await createBatch("批次不符", 3);
      const [first, second, third] = ids as [
        Types.ObjectId,
        Types.ObjectId,
        Types.ObjectId,
      ];
      const result = await reassignMany(asB1, ids, B2, {
        expected: {
          [String(first)]: { editVersion: 0 },
          [String(second)]: { editVersion: 7 },
          [String(third)]: { editVersion: 0 },
        },
        update: { $inc: { editVersion: 1 } },
      });
      expect(result.mismatched.map(String)).toEqual([String(second)]);
      expect(result.moved).toEqual([]);
      for (const id of ids) {
        const unchanged = await items.findById(asB1, id);
        expect(unchanged?.orgId.equals(B1)).toBe(true);
        expect(unchanged?.editVersion).toBe(0);
      }
      expect(await batchAudits(ids)).toHaveLength(0);
    });

    it("看不到 / 不存在的 id 算不符,整批不動", async () => {
      const ids = await createBatch("批次看不到", 1);
      const other = firstOf(
        await transactions.withTransaction(() =>
          items.createMany(asB2, [{ name: "批次別店" }]),
        ),
      );
      const missing = new Types.ObjectId();
      const result = await reassignMany(asB1, [...ids, other._id, missing], B2);
      expect(sorted(result.mismatched.map(String))).toEqual(
        sorted([String(other._id), String(missing)]),
      );
      expect(await orgOf(asB1, firstOf(ids))).toBe(String(B1));
    });

    it("搬到別租戶 / 根組織 → VALIDATION_FAILED(orgId);update 不得碰 tenantId", async () => {
      const ids = await createBatch("批次不准", 2);
      for (const target of [U1, root]) {
        const error: unknown = await reassignMany(asB1, ids, target).catch(
          (error_: unknown) => error_,
        );
        expect(isValidationFailed(error, "orgId")).toBe(true);
      }
      await expect(
        reassignMany(asB1, ids, B2, { update: { $set: { tenantId: U } } }),
      ).rejects.toThrow(TenantScopeError);
      expect(await orgOf(asB1, firstOf(ids))).toBe(String(B1));
    });

    it("核對後、寫入前被別人改了 → CONFLICT(EDIT_VERSION_MISMATCH),整批與稽核都不留", async () => {
      const ids = await createBatch("批次並發", 2);
      const raced = firstOf(ids);
      // 核對之後、寫入之前(查來源租戶那一步)模擬別人把其中一筆的版本改掉(同一個交易內寫,不觸發重試)
      const original = orgReassign.currentTenantsOf;
      const spy = jest
        .spyOn(orgReassign, "currentTenantsOf")
        .mockImplementation(async (...args) => {
          await database.connection
            .collection("reassign_items")
            .updateOne(
              { _id: raced },
              { $inc: { editVersion: 1 } },
              { session: currentSession() },
            );
          return original(...args);
        });
      try {
        const error: unknown = await reassignMany(asB1, ids, B2, {
          expected: Object.fromEntries(
            ids.map((id) => [String(id), { editVersion: 0 }]),
          ),
        }).catch((error_: unknown) => error_);
        expect(error).toBeInstanceOf(GraphQLError);
        expect((error as GraphQLError).extensions).toMatchObject({
          code: "CONFLICT",
          reason: "EDIT_VERSION_MISMATCH",
        });
      } finally {
        spy.mockRestore();
      }
      for (const id of ids) {
        const unchanged = await items.findById(asB1, id);
        expect(unchanged?.orgId.equals(B1)).toBe(true);
        expect(unchanged?.editVersion).toBe(0);
      }
      expect(await batchAudits(ids)).toHaveLength(0);
    });

    it("交易回復時整批與稽核一起回復", async () => {
      const ids = await createBatch("批次回復", 2);
      await expect(
        transactions.withTransaction(async () => {
          await items.reassignOrgMany(asB1, ids, B2);
          throw new Error("後續步驟失敗");
        }),
      ).rejects.toThrow("後續步驟失敗");
      expect(await orgOf(asB1, firstOf(ids))).toBe(String(B1));
      expect(await batchAudits(ids)).toHaveLength(0);
    });

    it("1,000 筆在一個交易內完成(記時間),一筆稽核", async () => {
      const ids = await createBatch("批次千筆", 1000);
      const started = Date.now();
      const result = await reassignMany(asB1, ids, B2, {
        expected: Object.fromEntries(
          ids.map((id) => [String(id), { editVersion: 0 }]),
        ),
        update: { $inc: { editVersion: 1 } },
      });
      const elapsed = Date.now() - started;
      // 記錄給 reviewer 看;上限放寬,只擋「每筆各查 / 各寫一次」那種退化
      process.stdout.write(`reassignOrgMany 1,000 筆:${String(elapsed)} ms\n`);
      expect(result.moved).toHaveLength(1000);
      expect(await items.count(asB2, { name: /^批次千筆-/ })).toBe(1000);
      expect(await batchAudits(ids.slice(0, 1))).toHaveLength(1);
      expect(elapsed).toBeLessThan(20_000);
    }, 60_000);
  });

  describe("一次寫多筆(createMany)", () => {
    it("不在交易內 → TenantScopeError(一筆失敗整批不寫要靠交易)", async () => {
      await expect(
        items.createMany(asB1, [{ name: "交易外" }]),
      ).rejects.toThrow(TenantScopeError);
    });

    it("每筆與 create 一樣:缺組織 = 當前組織、推導 tenantId、帶 moduleKey、填建立者", async () => {
      const created = await transactions.withTransaction(() =>
        items.createMany(asB1, [{ name: "多筆一" }, { name: "多筆二" }]),
      );
      expect(created).toHaveLength(2);
      for (const document of created) {
        expect(document.orgId.equals(B1)).toBe(true);
        expect(document.tenantId?.equals(T)).toBe(true);
        expect(document.moduleKey).toBe("reassign-test");
        expect(String(document.createdBy)).toBe(String(asB1.actorId));
      }
      expect(await items.count(asB1, { name: /^多筆/ })).toBe(2);
    });

    it("批次裡給錯的 tenantId 一律依 orgId 推導覆蓋(同 create)", async () => {
      const created = await transactions.withTransaction(() =>
        items.createMany(asB1, [
          { name: "錯租戶一", tenantId: U },
          { name: "錯租戶二", tenantId: null },
          { name: "錯租戶三", orgId: B1, tenantId: new Types.ObjectId() },
        ]),
      );
      expect(created.map((document) => String(document.tenantId))).toEqual([
        String(T),
        String(T),
        String(T),
      ]);
    });

    it("範圍外的組織擋下、整批不寫", async () => {
      await expect(
        transactions.withTransaction(() =>
          items.createMany(asB1, [
            { name: "範圍內" },
            { name: "範圍外", orgId: B2 },
          ]),
        ),
      ).rejects.toThrow(TenantScopeError);
      expect(await items.count(asB1, { name: "範圍內" })).toBe(0);
    });

    it("別租戶的 shareOrgs 擋下(VALIDATION_FAILED)、整批不寫;同租戶的照存", async () => {
      const error: unknown = await transactions
        .withTransaction(() =>
          shared.createMany(asB1, [
            {
              name: "共用一",
              shareOrgs: [{ orgId: B2, includeDescendants: false }],
            },
            {
              name: "共用二",
              shareOrgs: [{ orgId: U1, includeDescendants: false }],
            },
          ]),
        )
        .catch((error_: unknown) => error_);
      expect(isValidationFailed(error, "shareOrgs")).toBe(true);
      expect(await shared.count(asB1, {})).toBe(0);
      const [ok] = await transactions.withTransaction(() =>
        shared.createMany(asB1, [
          {
            name: "共用一",
            shareOrgs: [{ orgId: B2, includeDescendants: false }],
          },
        ]),
      );
      expect(ok?.shareOrgs?.map((entry) => String(entry.orgId))).toEqual([
        String(B2),
      ]);
    });

    it("寫到一半撞唯一索引:交易回復,前面的也不留", async () => {
      await transactions.withTransaction(() =>
        items.createMany(asB1, [{ name: "已存在" }]),
      );
      await expect(
        transactions.withTransaction(() =>
          items.createMany(asB1, [{ name: "新的一筆" }, { name: "已存在" }]),
        ),
      ).rejects.toThrow();
      expect(await items.count(asB1, { name: "新的一筆" })).toBe(0);
    });

    it("1,000 筆在一個交易內完成(記時間)", async () => {
      const started = Date.now();
      const created = await transactions.withTransaction(() =>
        items.createMany(
          asB1,
          Array.from({ length: 1000 }, (_unused, index) => ({
            name: `批次-${String(index).padStart(4, "0")}`,
          })),
        ),
      );
      const elapsed = Date.now() - started;
      // 記錄給 reviewer 看(本機 / CI 的實際耗時);上限放寬,只擋「每筆各查一次組織」那種退化
      process.stdout.write(`createMany 1,000 筆:${String(elapsed)} ms\n`);
      expect(created).toHaveLength(1000);
      expect(await items.count(asB1, { name: /^批次-/ })).toBe(1000);
      expect(elapsed).toBeLessThan(20_000);
    }, 60_000);
  });
});
