import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import type { ClientSession, Connection, Types } from "mongoose";

import { AuditService } from "../audit/audit.service";
import type { OperatorContext } from "../database/operator-context";
import { CORE_RELATIONSHIPS_COLLECTION } from "../database/schemas/core-relationship.schema";
import { ORGS_COLLECTION } from "../database/schemas/org.schema";
import {
  TENANT_PURGE_SOURCES,
  type TenantPurgeScope,
  type TenantPurgeSources,
  dependentKeysOf,
  filterOfStep,
  resolveTenantPurgePlan,
} from "../database/tenant-purge";
import { TransactionService, afterCommit } from "../database/transaction";
import { StorageService, isOwnedUploadPath } from "../storage/storage.service";
import type {
  PurgeDemoTenantPayload,
  PurgedCollection,
} from "./models/tenant-ops.model";
import { orgError, orgValidationError } from "./org-error";
import { OwnerProtectionService } from "./owner-protection.service";

/** 審計動作名(docs/modules/org-manager.md「審計」的命名規則;`targetType` = org)。 */
const AUDIT_ACTION = "org.purge-demo";

interface IdDocument {
  _id: Types.ObjectId;
}

interface OrgDocument extends IdDocument {
  name?: string;
  slug?: string;
  isDemo?: boolean;
}

interface LinkDocument {
  firstId: Types.ObjectId;
  secondId: Types.ObjectId;
}

type Filter = Record<string, unknown>;

/** 一路往下找存在資料裡、本 API 簽出來的檔案路徑(商標、附件、表單上傳欄……,位置不必逐表宣告)。 */
function collectFilePaths(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    if (isOwnedUploadPath(value)) {
      into.add(value);
    }
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  // ObjectId、Decimal128、Binary 等 BSON 值、日期與位元組不是容器
  if (
    "_bsontype" in value ||
    value instanceof Date ||
    ArrayBuffer.isView(value)
  ) {
    return;
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    collectFilePaths(child, into);
  }
}

/** 只留有值的分支;一個都沒有回 null(這一步不用刪)。 */
function anyOf(branches: (Filter | null)[]): Filter | null {
  const kept = branches.filter((branch): branch is Filter => branch !== null);
  if (kept.length === 0) {
    return null;
  }
  return kept.length === 1 ? (kept[0] ?? null) : { $or: kept };
}

function idsIn(
  field: string,
  ids: readonly Types.ObjectId[],
  extra: Filter = {},
): Filter | null {
  return ids.length === 0 ? null : { ...extra, [field]: { $in: [...ids] } };
}

function uniqueIds(ids: readonly Types.ObjectId[]): Types.ObjectId[] {
  return [...new Map(ids.map((id) => [String(id), id])).values()];
}

/**
 * 清空示範機構(demo 指令 `--mode=purge` / `rebuild` 呼叫;`docs/deployment.md`「示範機構清空 / 重建」)。
 *
 * - **只在根組織、只對標「示範」的租戶頂層**:以租戶短碼(slug)找根組織底下的租戶頂層;
 *   找不到 → 什麼都不做(`purged: false`);找到卻沒有「示範」標記 → `FORBIDDEN`,一筆都不刪
 * - **刪除範圍照登記**(`database/tenant-purge.ts`):每張 collection 宣告的刪法 ——
 *   帶 `tenantId` 的依 `tenantId`、其餘依組織 / 使用者歸屬;登記不完整時拋錯、一筆都不刪。
 *   組織樹、使用者、角色、核心關聯由本服務自己處理:只屬於這個租戶的人硬刪,
 *   也屬於其他組織的人只移除在這個租戶的所屬與角色
 * - **硬刪、包括只能新增的帳本**:以原生 collection 刪,不經 BaseRepository 與 schema 中介層
 *   (清空 = 當作沒發生過;同一組短碼、帳號之後要能重新建立)
 * - 刪除與審計 `org.purge-demo` 是一個交易(TX-01);檔案在交易提交後刪(TX-03),個別失敗只記 log
 */
@Injectable()
export class DemoTenantPurgeService {
  private readonly logger = new Logger(DemoTenantPurgeService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(TENANT_PURGE_SOURCES) private readonly sources: TenantPurgeSources,
    private readonly transactions: TransactionService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly ownerProtection: OwnerProtectionService,
  ) {}

  async purge(
    operator: OperatorContext,
    slugInput: string,
  ): Promise<PurgeDemoTenantPayload> {
    if (!(await this.ownerProtection.canActAsRoot(operator))) {
      throw orgError(
        "FORBIDDEN",
        "purgeDemoTenant is only available from the root org",
      );
    }
    const slug = slugInput.trim();
    if (slug === "") {
      throw orgValidationError("slug must not be empty", ["slug"]);
    }
    // 登記不完整就在任何讀寫之前停下
    const plan = resolveTenantPurgePlan(this.sources);

    const tenant = await this.findTenantTop(slug);
    if (tenant === null) {
      return {
        purged: false,
        orgId: null,
        deletedDocuments: 0,
        deletedUsers: 0,
        detachedUsers: 0,
        deletedFiles: 0,
        collections: [],
      };
    }
    if (tenant.isDemo !== true) {
      throw orgError(
        "FORBIDDEN",
        `Org with slug ${slug} is not marked as demo; nothing was deleted`,
      );
    }

    return this.transactions.withTransaction(async (session) => {
      const files = new Set<string>();
      const counts = new Map<string, number>();
      const remove = async (
        collection: string,
        filter: Filter | null,
        scanFiles: boolean,
      ): Promise<Record<string, unknown>[]> => {
        if (filter === null) {
          return [];
        }
        const target = this.db().collection(collection);
        // 交易內依序讀寫(TX-02);讀出來是為了找檔案路徑與後面步驟要對的值
        const documents = scanFiles
          ? await target.find(filter, { session }).toArray()
          : [];
        for (const document of documents) {
          collectFilePaths(document, files);
        }
        const { deletedCount } = await target.deleteMany(filter, { session });
        if (deletedCount > 0) {
          counts.set(collection, (counts.get(collection) ?? 0) + deletedCount);
        }
        return documents;
      };

      const tenantOrgIds = await this.tenantOrgIds(tenant._id, session);
      const { purgedUserIds, detachedUserIds } = await this.membersOf(
        tenantOrgIds,
        session,
      );
      const roleIds = (
        await this.links(
          { type: "org_role", firstId: { $in: tenantOrgIds } },
          session,
        )
      ).map((link) => link.secondId);

      const scope: TenantPurgeScope & {
        deletedValues: Map<string, Map<string, unknown[]>>;
      } = {
        tenantId: tenant._id,
        tenantOrgIds,
        purgedUserIds,
        deletedValues: new Map(),
      };
      const dependentKeys = dependentKeysOf(plan);
      for (const step of plan.steps) {
        const documents = await remove(
          step.collection,
          filterOfStep(step, scope),
          true,
        );
        const keys = dependentKeys.get(step.collection) ?? [];
        if (keys.length > 0) {
          scope.deletedValues.set(
            step.collection,
            new Map(
              keys.map((key) => [
                key,
                documents.flatMap((document) =>
                  document[key] === undefined ? [] : [document[key]],
                ),
              ]),
            ),
          );
        }
      }

      // 核心關聯:租戶組織的成員 / 角色 / 主管關聯、被刪的人與被刪的角色的所有關聯
      // (兼屬其他組織的人只少了這個租戶的所屬與角色)
      await remove(
        CORE_RELATIONSHIPS_COLLECTION,
        anyOf([
          idsIn("firstId", tenantOrgIds, {
            type: { $in: ["org_user", "org_role", "org_manager"] },
          }),
          idsIn("secondId", purgedUserIds, {
            type: { $in: ["org_user", "org_manager"] },
          }),
          idsIn("firstId", purgedUserIds, { type: "user_role" }),
          idsIn("secondId", roleIds, { type: "user_role" }),
          idsIn("firstId", roleIds, {
            type: { $in: ["role_module", "role_permission"] },
          }),
        ]),
        false,
      );
      await remove("roles", idsIn("_id", roleIds), false);
      await remove("users", idsIn("_id", purgedUserIds), true);
      await remove(ORGS_COLLECTION, idsIn("_id", tenantOrgIds), true);

      const collections: PurgedCollection[] = [...counts]
        .map(([collection, deleted]) => ({ collection, deleted }))
        .toSorted((left, right) =>
          left.collection.localeCompare(right.collection),
        );
      const deletedDocuments = collections.reduce(
        (sum, entry) => sum + entry.deleted,
        0,
      );
      await this.audit.record(operator, {
        action: AUDIT_ACTION,
        targetType: "org",
        targetId: tenant._id,
        before: {
          name: tenant.name ?? null,
          slug,
          deletedDocuments,
          deletedUsers: purgedUserIds.length,
          detachedUsers: detachedUserIds.length,
        },
      });

      const paths = [...files];
      afterCommit(() => this.deleteFiles(paths));
      return {
        purged: true,
        orgId: String(tenant._id),
        deletedDocuments,
        deletedUsers: purgedUserIds.length,
        detachedUsers: detachedUserIds.length,
        deletedFiles: paths.length,
        collections,
      };
    });
  }

  private db() {
    const { db } = this.connection;
    if (db === undefined) {
      throw new Error("資料庫連線尚未建立");
    }
    return db;
  }

  /** 根組織底下短碼相同的租戶頂層(含已軟刪除的;短碼唯一索引同樣含它們)。 */
  private async findTenantTop(slug: string): Promise<OrgDocument | null> {
    const orgs = this.db().collection<OrgDocument>(ORGS_COLLECTION);
    const root = await orgs.findOne({ parentId: null });
    if (root === null) {
      throw new Error("找不到根組織(seed 未跑?)");
    }
    return orgs.findOne({ slug, parentId: root._id });
  }

  /** 租戶頂層與它所有下層(物化路徑 ancestors)。 */
  private async tenantOrgIds(
    tenantId: Types.ObjectId,
    session: ClientSession,
  ): Promise<Types.ObjectId[]> {
    const orgs = await this.db()
      .collection<IdDocument>(ORGS_COLLECTION)
      .find(
        { $or: [{ _id: tenantId }, { ancestors: tenantId }] },
        { projection: { _id: 1 }, session },
      )
      .toArray();
    return orgs.map((org) => org._id);
  }

  private links(
    filter: Filter,
    session: ClientSession,
  ): Promise<LinkDocument[]> {
    return this.db()
      .collection<LinkDocument>(CORE_RELATIONSHIPS_COLLECTION)
      .find(filter, { projection: { firstId: 1, secondId: 1 }, session })
      .toArray();
  }

  /**
   * 這個租戶的成員分兩種:所屬組織全在租戶內 → 刪掉;另外還屬於租戶外的組織(含根組織)→ 只移除所屬。
   */
  private async membersOf(
    tenantOrgIds: readonly Types.ObjectId[],
    session: ClientSession,
  ): Promise<{
    purgedUserIds: Types.ObjectId[];
    detachedUserIds: Types.ObjectId[];
  }> {
    const members = uniqueIds(
      (
        await this.links(
          { type: "org_user", firstId: { $in: [...tenantOrgIds] } },
          session,
        )
      ).map((link) => link.secondId),
    );
    if (members.length === 0) {
      return { purgedUserIds: [], detachedUserIds: [] };
    }
    const inTenant = new Set(tenantOrgIds.map(String));
    const outside = new Set(
      (
        await this.links(
          { type: "org_user", secondId: { $in: members } },
          session,
        )
      )
        .filter((link) => !inTenant.has(String(link.firstId)))
        .map((link) => String(link.secondId)),
    );
    return {
      purgedUserIds: members.filter((id) => !outside.has(String(id))),
      detachedUserIds: members.filter((id) => outside.has(String(id))),
    };
  }

  /** 交易提交後刪檔(路徑歸屬由 `deleteObject` 再驗一次);清不掉只是留下孤兒物件,記 warn 不擋。 */
  private async deleteFiles(paths: readonly string[]): Promise<void> {
    for (const path of paths) {
      try {
        await this.storage.deleteObject(path);
      } catch (error) {
        this.logger.warn(
          `清空示範機構:檔案 ${path} 刪除失敗(${error instanceof Error ? error.message : String(error)})`,
        );
      }
    }
  }
}
