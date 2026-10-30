import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { GraphQLError } from "graphql";
import { type HydratedDocument, Schema, Types } from "mongoose";

import { AuditActorMissingError, AuditService } from "../audit/audit.service";
import { BaseRepository } from "./base.repository";
import { AuditLogsRepository } from "./database.module";
import type { OperatorContext } from "./operator-context";
import { baseFieldsPlugin } from "./plugins/base-fields.plugin";
import { setDataScopeRuleProvider } from "./plugins/data-scope-provider";
import { fieldEncryptionPlugin } from "./plugins/field-encryption.plugin";
import {
  TenantScopeError,
  tenantScopePlugin,
} from "./plugins/tenant-scope.plugin";
import { AuditLog, AuditLogSchema } from "./schemas/audit-log.schema";
import {
  countDbCommands,
  expectDbCommandsAtMost,
} from "./test-support/db-commands";
import {
  HOOK_TIMEOUT_MS,
  type TestDatabase,
  openTestDatabase,
} from "./test-support/mongo-connection";
import { TransactionService } from "./transaction";

/**
 * 批次寫入出口(TX-06):`BaseRepository.softDeleteMany`、`bulkUpdateByIds` 與 `AuditService.recordMany`,
 * 對真 MongoDB replica set 驗證範圍、欄位保護、筆數核對,以及 1 筆與 50 筆的指令數相同。
 */

interface Row {
  orgId: Types.ObjectId;
  name: string;
  status: string;
  startsAt: Date | null;
  editVersion: number;
  nested?: { note?: string };
  secret?: string;
  tags?: string[];
  history?: { label: string }[];
}

/** 模組資料表(有 moduleKey / tenantId、可共用):資料範圍規則與鎖住欄位的測試用。 */
interface ModuleRow {
  orgId: Types.ObjectId;
  name: string;
  moduleKey: string;
  tenantId: Types.ObjectId | null;
}

type Repo = BaseRepository<Row, HydratedDocument<Row>>;

const root = new Types.ObjectId();
const orgA = new Types.ObjectId();
const orgB = new Types.ObjectId();

/** 只看得到 orgA 的人。 */
const asA: OperatorContext = {
  actorId: new Types.ObjectId(),
  currentOrgId: orgA,
  visibleOrgIds: [orgA],
  managedOrgIds: [],
  memberOrgIds: [orgA],
  roleIds: [],
  memberTenants: [],
};

/** 只看得到 orgB 的人(建 orgB 的資料用)。 */
const asB: OperatorContext = {
  ...asA,
  actorId: new Types.ObjectId(),
  currentOrgId: orgB,
  visibleOrgIds: [orgB],
  memberOrgIds: [orgB],
};

/** 筆數不符的錯誤:`CONFLICT`(`EDIT_VERSION_MISMATCH`)。 */
async function expectConflict(run: Promise<unknown>): Promise<void> {
  const error = await run.then(
    () => null,
    (error_: unknown) => error_,
  );
  expect(error).toBeInstanceOf(GraphQLError);
  expect((error as GraphQLError).extensions).toMatchObject({
    code: "CONFLICT",
    reason: "EDIT_VERSION_MISMATCH",
  });
}

/** 清單的第一筆;空清單 → 拋錯(測試資料沒建起來)。 */
function only(ids: readonly Types.ObjectId[]): Types.ObjectId {
  const [id] = ids;
  if (id === undefined) {
    throw new Error("測試資料沒建起來");
  }
  return id;
}

describe("批次寫入出口(TX-06;對真 MongoDB replica set)", () => {
  let database: TestDatabase;
  let rows: Repo;
  let moduleRows: BaseRepository<ModuleRow, HydratedDocument<ModuleRow>>;
  let auditLogs: AuditLogsRepository;
  let audit: AuditService;
  let transactions: TransactionService;
  let serial = 0;
  let previousKey: string | undefined;

  beforeAll(async () => {
    database = await openTestDatabase("cookhome-test-batch-writes");
    const schema = new Schema<Row>(
      {
        orgId: { type: Schema.Types.ObjectId, required: true },
        name: { type: String, required: true },
        status: { type: String, enum: ["open", "closed"], default: "open" },
        startsAt: { type: Date, default: null },
        editVersion: { type: Number, default: 0 },
        nested: { note: { type: String, maxlength: 5 } },
        secret: { type: String },
        tags: [{ type: String, enum: ["a", "b"] }],
        history: [{ label: { type: String, required: true } }],
      },
      { collection: "batch_write_rows", timestamps: true },
    );
    // 加密欄位(同 users / customers 的 fieldEncryptionPlugin):bulkWrite 的更新也要經 setter 加密
    previousKey = process.env.FIELD_ENCRYPTION_KEY;
    process.env.FIELD_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    schema.plugin(fieldEncryptionPlugin, { fields: ["secret"] });
    schema.plugin(baseFieldsPlugin);
    schema.plugin(tenantScopePlugin);
    const rowModel = database.connection.model<Row>("BatchWriteRow", schema);
    const moduleSchema = new Schema<ModuleRow>(
      {
        orgId: { type: Schema.Types.ObjectId, required: true },
        name: { type: String, required: true },
      },
      { collection: "batch_write_module_rows", timestamps: true },
    );
    moduleSchema.plugin(baseFieldsPlugin);
    moduleSchema.plugin(tenantScopePlugin, {
      moduleData: true,
      sharing: { mode: "shareable", defaultShareOrgs: "none", editable: true },
    });
    moduleSchema.path("moduleKey").default("batch-test");
    const moduleModel = database.connection.model<ModuleRow>(
      "BatchWriteModuleRow",
      moduleSchema,
    );
    // 模組資料表建立時依 orgId 的祖先推導 tenantId:orgA / orgB 都是根下的租戶頂層
    await database.connection.collection("orgs").insertMany(
      [orgA, orgB].map((_id) => ({
        _id,
        ancestors: [root],
        parentId: root,
        name: String(_id),
        deletedAt: null,
      })),
    );
    const auditModel = database.connection.model<AuditLog>(
      AuditLog.name,
      AuditLogSchema,
    );
    // 交易內不能隱式建 collection:先建好
    await Promise.all([rowModel.init(), moduleModel.init(), auditModel.init()]);
    rows = new BaseRepository(rowModel);
    moduleRows = new BaseRepository(moduleModel);
    auditLogs = new AuditLogsRepository(auditModel);
    audit = new AuditService(auditLogs);
    transactions = new TransactionService(database.connection);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    if (previousKey === undefined) {
      delete process.env.FIELD_ENCRYPTION_KEY;
    } else {
      process.env.FIELD_ENCRYPTION_KEY = previousKey;
    }
    await database.close();
  }, HOOK_TIMEOUT_MS);

  /** 建 `count` 筆(預設在 orgA),回 id。 */
  async function seed(
    count: number,
    operator: OperatorContext = asA,
  ): Promise<Types.ObjectId[]> {
    const created = await transactions.withTransaction(() =>
      rows.createMany(
        operator,
        Array.from({ length: count }, () => {
          serial += 1;
          return { name: `row-${String(serial)}` };
        }),
      ),
    );
    return created.map((row) => row._id);
  }

  /** 原生讀(含已刪除),不經範圍。 */
  function rawOf(ids: readonly Types.ObjectId[]) {
    return database.connection
      .collection<Row & { deletedAt: Date | null; updatedBy: unknown }>(
        "batch_write_rows",
      )
      .find({ _id: { $in: [...ids] } })
      .toArray();
  }

  /** 同一個動作的三個出口各數一次指令(刪 `count` 筆、改 `count` 筆、寫 `count` 筆稽核)。 */
  async function commandTotals(count: number) {
    const toDelete = await seed(count);
    const toUpdate = await seed(count);
    const softDelete = await countDbCommands(() =>
      transactions.withTransaction(() => rows.softDeleteMany(asA, toDelete)),
    );
    const bulk = await countDbCommands(() =>
      transactions.withTransaction(() =>
        rows.bulkUpdateByIds(
          asA,
          toUpdate.map((id, index) => ({
            id,
            update: { $set: { startsAt: new Date(index * 60_000) } },
            filter: { editVersion: 0 },
          })),
        ),
      ),
    );
    const records = await countDbCommands(() =>
      transactions.withTransaction(() =>
        audit.recordMany(
          asA,
          toUpdate.map((targetId) => ({ action: "batch.count", targetId })),
        ),
      ),
    );
    return { softDelete, bulk, records };
  }

  describe("softDeleteMany", () => {
    it("不在交易內 → TenantScopeError", async () => {
      const ids = await seed(1);
      await expect(rows.softDeleteMany(asA, ids)).rejects.toThrow(
        TenantScopeError,
      );
    });

    it("全部刪到;寫 deletedAt 與 updatedBy,之後預設查詢看不到;重複 id 只算一次", async () => {
      const ids = await seed(3);
      await transactions.withTransaction(() =>
        rows.softDeleteMany(asA, [...ids, String(ids[0])]),
      );
      expect(await rows.count(asA, { _id: { $in: ids } })).toBe(0);
      for (const raw of await rawOf(ids)) {
        expect(raw.deletedAt).toBeInstanceOf(Date);
        expect(String(raw.updatedBy)).toBe(String(asA.actorId));
      }
    });

    it("有範圍外 / 已刪除的 → CONFLICT,交易回復已刪的(沒有部分提交)", async () => {
      const mine = await seed(2);
      const theirs = only(await seed(1, asB));
      const gone = only(await seed(1));
      await transactions.withTransaction(() =>
        rows.softDeleteMany(asA, [gone]),
      );

      for (const extra of [theirs, gone]) {
        await expectConflict(
          transactions.withTransaction(() =>
            rows.softDeleteMany(asA, [...mine, extra]),
          ),
        );
      }
      expect(await rows.count(asA, { _id: { $in: mine } })).toBe(2);
      expect(await rows.count(asB, { _id: theirs })).toBe(1);
    });

    it("空清單不送指令", async () => {
      const counted = await countDbCommands(() =>
        transactions.withTransaction(() => rows.softDeleteMany(asA, [])),
      );
      expect(
        counted.byCommand.get("batch_write_rows.updateMany"),
      ).toBeUndefined();
    });
  });

  describe("bulkUpdateByIds", () => {
    it("不在交易內 → TenantScopeError", async () => {
      const id = only(await seed(1));
      await expect(
        rows.bulkUpdateByIds(asA, [{ id, update: { $set: { name: "x" } } }]),
      ).rejects.toThrow(TenantScopeError);
    });

    it("每筆各自的值;補 updatedBy / updatedAt;值沒變的也算命中", async () => {
      const ids = await seed(3);
      // 先把 updatedAt 推回很久以前:沒套 timestamps 的話,寫入後還會是這個值
      const longAgo = new Date(Date.UTC(2000, 0, 1));
      await database.connection
        .collection("batch_write_rows")
        .updateMany({ _id: { $in: ids } }, { $set: { updatedAt: longAgo } });
      const startedAt = Date.now();
      const times = ids.map(
        (_, index) => new Date(Date.UTC(2026, 0, index + 1)),
      );
      await transactions.withTransaction(() =>
        rows.bulkUpdateByIds(asA, [
          ...ids.slice(0, 2).map((id, index) => ({
            id,
            update: {
              $set: { startsAt: times[index] ?? null, "nested.note": "ok" },
              $inc: { editVersion: 1 },
            },
          })),
          // 第三筆:值和現在一樣(modifiedCount 會是 0,matchedCount 仍是 1)
          { id: String(ids[2]), update: { $set: { status: "open" } } },
        ]),
      );
      const after = await rawOf(ids);
      for (const [index, id] of ids.slice(0, 2).entries()) {
        const row = after.find((item) => item._id.equals(id));
        expect(row?.startsAt?.toISOString()).toBe(times[index]?.toISOString());
        expect(row?.editVersion).toBe(1);
        expect(row?.nested?.note).toBe("ok");
        expect(String(row?.updatedBy)).toBe(String(asA.actorId));
        expect(
          (row as unknown as { updatedAt: Date }).updatedAt.getTime(),
        ).toBeGreaterThanOrEqual(startedAt);
      }
    });

    it("每筆自己的條件(樂觀鎖)不符 / 範圍外 / 已刪除 → CONFLICT,交易回復(沒有部分提交)", async () => {
      const mine = await seed(2);
      const theirs = only(await seed(1, asB));
      const gone = only(await seed(1));
      const first = only(mine);
      const second = only(mine.slice(1));
      await transactions.withTransaction(() =>
        rows.softDeleteMany(asA, [gone]),
      );
      const cases = [
        { id: second, filter: { editVersion: 9 } },
        { id: theirs },
        { id: gone },
      ];
      for (const extra of cases) {
        await expectConflict(
          transactions.withTransaction(() =>
            rows.bulkUpdateByIds(asA, [
              { id: first, update: { $set: { name: "改了" } } },
              { ...extra, update: { $set: { name: "改了" } } },
            ]),
          ),
        );
      }
      expect(await rows.count(asA, { name: "改了" })).toBe(0);
      expect(await rows.count(asB, { name: "改了" })).toBe(0);
    });

    it("加密欄位:DB 內是密文,讀回解密後值正確", async () => {
      const ids = await seed(2);
      await transactions.withTransaction(() =>
        rows.bulkUpdateByIds(
          asA,
          ids.map((id, index) => ({
            id,
            update: { $set: { secret: `機密-${String(index)}` } },
          })),
        ),
      );
      for (const raw of await rawOf(ids)) {
        expect(raw.secret?.startsWith("enc:v1:")).toBe(true);
        expect(raw.secret).not.toContain("機密");
      }
      for (const [index, id] of ids.entries()) {
        const read = await rows.findById(asA, id, { select: "+secret" });
        expect(read?.secret).toBe(`機密-${String(index)}`);
      }
    });

    it("欄位保護、形狀、重複 id、schema 驗證、audit_logs 都擋下", async () => {
      const id = only(await seed(1));
      const run = (update: Record<string, unknown>) =>
        transactions.withTransaction(() =>
          rows.bulkUpdateByIds(asA, [{ id, update }]),
        );
      await expect(run({ $set: { orgId: orgB } })).rejects.toThrow(
        TenantScopeError,
      );
      await expect(run({ $set: { createdBy: null } })).rejects.toThrow(
        TenantScopeError,
      );
      await expect(run({ name: "頂層" })).rejects.toThrow(TenantScopeError);
      await expect(run({ $pull: { tags: "a" } })).rejects.toThrow(
        TenantScopeError,
      );
      await expect(
        run({ $push: { tags: { $each: ["a"], $position: 0 } } }),
      ).rejects.toThrow(TenantScopeError);
      await expect(run({ $push: { "history.$.label": "x" } })).rejects.toThrow(
        TenantScopeError,
      );
      // 必填欄位不能 $unset(同 updateById 的 runValidators);非必填的可以
      await expect(run({ $unset: { name: 1 } })).rejects.toThrow(
        /`name` is required/,
      );
      // $push 的值照 schema 驗:enum 不符、子文件缺必填
      await expect(run({ $push: { tags: "z" } })).rejects.toThrow(/tags/);
      await expect(
        run({ $push: { history: { $each: [{ label: "ok" }, {}] } } }),
      ).rejects.toThrow(/`label` is required/);
      await expect(run({ $set: { "items.$.name": "x" } })).rejects.toThrow(
        TenantScopeError,
      );
      await expect(run({ $set: { status: "bogus" } })).rejects.toThrow(
        /status/,
      );
      await expect(
        run({ $set: { "nested.note": "too long" } }),
      ).rejects.toThrow(/nested\.note/);
      await expect(
        transactions.withTransaction(() =>
          rows.bulkUpdateByIds(asA, [
            { id, update: { $set: { name: "a" } } },
            { id: String(id), update: { $set: { name: "b" } } },
          ]),
        ),
      ).rejects.toThrow(TenantScopeError);
      await expect(
        transactions.withTransaction(() =>
          auditLogs.bulkUpdateByIds(asA, [
            { id, update: { $set: { action: "x" } } },
          ]),
        ),
      ).rejects.toThrow(TenantScopeError);
      const [row] = await rawOf([id]);
      expect(row?.status).toBe("open");
      expect(row?.name).toBeDefined();
      expect(row?.tags ?? []).toEqual([]);
    });

    it("$push(單一元素 / $each)與非必填欄位的 $unset 照寫", async () => {
      const ids = await seed(2);
      await transactions.withTransaction(() =>
        rows.bulkUpdateByIds(asA, [
          {
            id: only(ids),
            update: {
              $push: { tags: "a", history: { label: "第一次" } },
              $unset: { "nested.note": 1 },
            },
          },
          {
            id: only(ids.slice(1)),
            update: {
              $push: { history: { $each: [{ label: "一" }, { label: "二" }] } },
            },
          },
        ]),
      );
      const after = await rawOf(ids);
      const first = after.find((item) => item._id.equals(only(ids)));
      const second = after.find((item) => item._id.equals(only(ids.slice(1))));
      expect(first?.tags).toEqual(["a"]);
      expect(first?.history?.map((entry) => entry.label)).toEqual(["第一次"]);
      expect(second?.history?.map((entry) => entry.label)).toEqual([
        "一",
        "二",
      ]);
    });

    it("模組資料表:moduleKey / tenantId / shareOrgs 拒收;資料範圍規則收窄(規則外的 → CONFLICT、回復)", async () => {
      const created = await transactions.withTransaction(() =>
        moduleRows.createMany(asA, [
          { name: "allowed-1" },
          { name: "blocked-1" },
        ]),
      );
      const allowed = only(
        created.filter((row) => row.name === "allowed-1").map((row) => row._id),
      );
      const blocked = only(
        created.filter((row) => row.name === "blocked-1").map((row) => row._id),
      );
      for (const update of [
        { $set: { moduleKey: "other" } },
        { $set: { tenantId: orgB } },
        { $set: { shareOrgs: [] } },
      ]) {
        await expect(
          transactions.withTransaction(() =>
            moduleRows.bulkUpdateByIds(asA, [{ id: allowed, update }]),
          ),
        ).rejects.toThrow(TenantScopeError);
      }

      setDataScopeRuleProvider({
        conditionFor: (collection) =>
          Promise.resolve(
            collection === "batch_write_module_rows"
              ? { name: /^allowed/ }
              : null,
          ),
      });
      try {
        await expectConflict(
          transactions.withTransaction(() =>
            moduleRows.bulkUpdateByIds(asA, [
              { id: allowed, update: { $set: { name: "allowed-2" } } },
              { id: blocked, update: { $set: { name: "allowed-3" } } },
            ]),
          ),
        );
        await transactions.withTransaction(() =>
          moduleRows.bulkUpdateByIds(asA, [
            { id: allowed, update: { $set: { name: "allowed-4" } } },
          ]),
        );
      } finally {
        setDataScopeRuleProvider(undefined);
      }
      const names = await database.connection
        .collection<ModuleRow>("batch_write_module_rows")
        .find({ _id: { $in: [allowed, blocked] } })
        .toArray();
      expect(
        names
          .map((row) => row.name)
          .toSorted((left, right) => left.localeCompare(right, "zh-Hant")),
      ).toEqual(["allowed-4", "blocked-1"]);
    });
  });

  describe("AuditService.recordMany", () => {
    it("每筆與 record 同形狀(actor / actorType / 組織脈絡由操作者決定);不在交易內 → TenantScopeError", async () => {
      const targets = [new Types.ObjectId(), new Types.ObjectId()];
      await transactions.withTransaction(() =>
        audit.recordMany(
          asA,
          targets.map((targetId, index) => ({
            action: "batch.test",
            targetType: "row",
            targetId,
            after: { index },
          })),
        ),
      );
      const written = await auditLogs.findMany(asA, {
        targetId: { $in: targets },
      });
      expect(written).toHaveLength(2);
      for (const record of written) {
        expect(record.action).toBe("batch.test");
        expect(record.actorType).toBe("user");
        expect(String(record.actorId)).toBe(String(asA.actorId));
        expect(record.orgId?.equals(orgA)).toBe(true);
        expect(String(record.createdBy)).toBe(String(asA.actorId));
      }
      await expect(
        audit.recordMany(asA, [{ action: "batch.outside" }]),
      ).rejects.toThrow(TenantScopeError);
    });

    it("缺操作者 → AuditActorMissingError,整批不寫;空清單不送指令", async () => {
      await expect(
        transactions.withTransaction(() =>
          audit.recordMany({ ...asA, actorId: null }, [
            { action: "batch.no-actor" },
          ]),
        ),
      ).rejects.toThrow(AuditActorMissingError);
      expect(await auditLogs.count(asA, { action: "batch.no-actor" })).toBe(0);
      const counted = await countDbCommands(() =>
        transactions.withTransaction(() => audit.recordMany(asA, [])),
      );
      expect(counted.byCommand.get("audit_logs.insertMany")).toBeUndefined();
    });
  });

  describe("指令數與筆數無關(1 筆與 50 筆相同)", () => {
    it("softDeleteMany / bulkUpdateByIds / recordMany", async () => {
      const one = await commandTotals(1);
      const many = await commandTotals(50);
      for (const key of ["softDelete", "bulk", "records"] as const) {
        expectDbCommandsAtMost(many[key], one[key].total, `${key} 50 筆`);
        // 交易本身不經 Mongoose debug,數到的只有那一次寫入
        expect(one[key].total).toBe(1);
      }
    });
  });
});
