import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { Types } from "mongoose";

import { AuditLogsRepository } from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import {
  AuditLog,
  AuditLogImmutableError,
  AuditLogSchema,
} from "../database/schemas/audit-log.schema";
import {
  HOOK_TIMEOUT_MS,
  type TestDatabase,
  openTestDatabase,
} from "../database/test-support/mongo-connection";
import { AuditActorMissingError, AuditService } from "./audit.service";

const orgA = new Types.ObjectId();
const orgB = new Types.ObjectId();
const actorId = new Types.ObjectId();

/** 在 orgA 執行動作的操作者(可見 orgA 與 orgB,當前組織 orgA)。 */
const inOrgA: OperatorContext = {
  actorId,
  currentOrgId: orgA,
  visibleOrgIds: [orgA, orgB],
  managedOrgIds: [orgA, orgB],
  memberOrgIds: [orgA],
  roleIds: [],
  memberTenants: [],
};

/**
 * 稽核(ADR-0004:授權變更由模組層寫、只增不改)。
 * 對真 MongoDB 驗證(TEST-07);AuditService 這一段還沒有 GraphQL 端點(orgs / users 的
 * resolver 另有測試),故直接對服務這個接縫測,與 BaseRepository 的測試同一寫法。
 */
describe("AuditService(ADR-0004:模組層寫稽核、只增不改;對真 MongoDB 驗證)", () => {
  let database: TestDatabase;
  let auditLogs: AuditLogsRepository;
  let audit: AuditService;

  beforeAll(async () => {
    database = await openTestDatabase("cookhome-test-audit");
    auditLogs = new AuditLogsRepository(
      database.connection.model<AuditLog>(AuditLog.name, AuditLogSchema),
    );
    audit = new AuditService(auditLogs);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  }, HOOK_TIMEOUT_MS);

  describe("record:欄位齊全,actor / actorType / orgId 由操作者上下文取", () => {
    it("動作、對象、前後值照給;操作者與組織脈絡不由呼叫端指定;基礎欄位由 plugin 補", async () => {
      const targetId = new Types.ObjectId();
      await audit.record(inOrgA, {
        action: "org.set-visibility",
        targetType: "org",
        targetId,
        before: { visibility: "own" },
        after: { visibility: "subtree" },
      });

      const [record] = await auditLogs.findMany(inOrgA, {
        action: "org.set-visibility",
      });
      expect(record).toMatchObject({
        action: "org.set-visibility",
        targetType: "org",
        before: { visibility: "own" },
        after: { visibility: "subtree" },
      });
      expect(record?.actorId.equals(actorId)).toBe(true);
      // 後台操作者恆為 user 帳號體系(customer 走會員線)
      expect(record?.actorType).toBe("user");
      // 動作發生的組織脈絡 = 操作者的當前組織
      expect(record?.orgId?.equals(orgA)).toBe(true);
      expect(record?.targetId?.equals(targetId)).toBe(true);
      expect(record?.createdBy?.equals(actorId)).toBe(true);
      expect(record?.createdAt).toBeInstanceOf(Date);
      expect(record?.deletedAt).toBeNull();
    });

    it("只給 action 也寫得進去:選填欄位不給就不落欄位", async () => {
      await audit.record(inOrgA, { action: "user.grant-role" });

      const [record] = await auditLogs.findMany(inOrgA, {
        action: "user.grant-role",
      });
      expect(record?.action).toBe("user.grant-role");
      expect(record?.targetType).toBeUndefined();
      expect(record?.targetId).toBeUndefined();
      expect(record?.before).toBeUndefined();
      expect(record?.after).toBeUndefined();
    });

    it("沒有操作者(無登入主體的流程)→ 拒寫,不留無主稽核", async () => {
      await expect(
        audit.record(
          {
            actorId: null,
            currentOrgId: orgA,
            visibleOrgIds: [orgA],
            managedOrgIds: [orgA],
            memberOrgIds: [orgA],
            roleIds: [],
            memberTenants: [],
          },
          { action: "org.provision" },
        ),
      ).rejects.toThrow(AuditActorMissingError);
    });

    it("orgId 是租戶資料的欄位:別的組織的操作者查不到這一筆(ADR-0005)", async () => {
      await audit.record(inOrgA, {
        action: "org.move",
        targetType: "org",
        targetId: new Types.ObjectId(),
      });

      const asOrgB: OperatorContext = {
        actorId: new Types.ObjectId(),
        currentOrgId: orgB,
        visibleOrgIds: [orgB],
        managedOrgIds: [orgB],
        memberOrgIds: [orgB],
        roleIds: [],
        memberTenants: [],
      };
      expect(await auditLogs.findMany(asOrgB, { action: "org.move" })).toEqual(
        [],
      );
      expect(
        await auditLogs.findMany(inOrgA, { action: "org.move" }),
      ).toHaveLength(1);
    });
  });

  describe("只增不改:同一個對象的多次動作各留一筆,前一筆不被改寫", () => {
    it("記兩次 → 兩筆都在,第一筆的內容與時間戳不變", async () => {
      const targetId = new Types.ObjectId();
      await audit.record(inOrgA, {
        action: "user.toggle-enabled",
        targetType: "user",
        targetId,
        after: { enabled: false },
      });
      const [first] = await auditLogs.findMany(inOrgA, { targetId });

      await audit.record(inOrgA, {
        action: "user.toggle-enabled",
        targetType: "user",
        targetId,
        after: { enabled: true },
      });

      const records = await auditLogs.findMany(inOrgA, { targetId });
      expect(records).toHaveLength(2);
      const kept = records.find(
        (record) => String(record._id) === String(first?._id),
      );
      expect(kept?.after).toEqual({ enabled: false });
      expect(kept?.updatedAt).toEqual(first?.updatedAt);
    });

    it("資料層封死更新與刪除:updateById / updateMany / softDeleteById 一律拒", async () => {
      await audit.record(inOrgA, {
        action: "org.delete",
        targetType: "org",
        targetId: new Types.ObjectId(),
      });
      const [record] = await auditLogs.findMany(inOrgA, {
        action: "org.delete",
      });
      const id = record?._id ?? new Types.ObjectId();

      await expect(
        auditLogs.updateById(inOrgA, id, { $set: { action: "org.edit" } }),
      ).rejects.toThrow(AuditLogImmutableError);
      await expect(
        auditLogs.updateMany(
          inOrgA,
          { action: "org.delete" },
          { $set: { action: "org.edit" } },
        ),
      ).rejects.toThrow(AuditLogImmutableError);
      await expect(auditLogs.softDeleteById(inOrgA, id)).rejects.toThrow(
        AuditLogImmutableError,
      );

      // 三次嘗試之後這筆仍原封不動
      const after = await auditLogs.findById(inOrgA, id);
      expect(after?.action).toBe("org.delete");
      expect(after?.deletedAt).toBeNull();
    });
  });
});
