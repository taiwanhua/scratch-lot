import { Inject, Injectable } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import type { ClientSession, Connection, Types } from "mongoose";

import { isOwnedUploadPath } from "../storage/upload-rules";
import { CORE_RELATIONSHIPS_COLLECTION } from "./schemas/core-relationship.schema";
import { ORGS_COLLECTION } from "./schemas/org.schema";
import {
  TENANT_PURGE_SOURCES,
  type TenantPurgePlan,
  type TenantPurgeSources,
  dependentKeysOf,
  filterOfStep,
  resolveTenantPurgePlan,
} from "./tenant-purge";

type Filter = Record<string, unknown>;

interface IdDocument {
  _id: Types.ObjectId;
}

/** 根組織底下的租戶頂層(清空前判斷「示範」標記用)。 */
export interface TenantTopRow extends IdDocument {
  name?: string;
  slug?: string;
  isDemo?: boolean;
}

interface LinkDocument {
  firstId: Types.ObjectId;
  secondId: Types.ObjectId;
}

/** 一次清空的結果。 */
export interface TenantPurgeResult {
  /** 有刪到的 collection 與筆數(依名稱排序)。 */
  collections: { collection: string; deleted: number }[];
  deletedDocuments: number;
  purgedUserIds: Types.ObjectId[];
  detachedUserIds: Types.ObjectId[];
  /** 被刪的資料裡引用、本 API 簽出的檔案路徑(交易提交後由呼叫端刪)。 */
  filePaths: string[];
}

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
 * 清空一個租戶的資料層出口(`docs/deployment.md`「示範機構清空 / 重建」;呼叫端 `orgs/demo-tenant-purge.service.ts`)。
 *
 * **以原生 collection 硬刪**,不經 BaseRepository 與 schema 中介層:清空要刪掉這個租戶的**全部**資料
 * (含軟刪除的、只能新增的帳本),中介層的租戶保底與只增不改正是要繞過的東西。所以本出口只做一件事 ——
 * 照登記(`tenant-purge.ts`)刪一整個租戶;判斷能不能刪(根組織、「示範」標記)、交易、審計、刪檔都在呼叫端。
 * 每個讀寫都帶呼叫端給的交易 session(TX-02:原生 driver 不會自動加入),依序執行。
 */
@Injectable()
export class TenantPurgeStore {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(TENANT_PURGE_SOURCES) private readonly sources: TenantPurgeSources,
  ) {}

  /** 驗證登記並排出刪除步驟;登記不完整拋 `TenantPurgeRegistrationError`(在任何讀寫之前呼叫)。 */
  plan(): TenantPurgePlan {
    return resolveTenantPurgePlan(this.sources);
  }

  /** 根組織底下短碼相同的租戶頂層(含已軟刪除的;短碼唯一索引同樣含它們)。 */
  async findTenantTopBySlug(slug: string): Promise<TenantTopRow | null> {
    const orgs = this.db().collection<TenantTopRow>(ORGS_COLLECTION);
    const root = await orgs.findOne({ parentId: null });
    if (root === null) {
      throw new Error("找不到根組織(seed 未跑?)");
    }
    return orgs.findOne({ slug, parentId: root._id });
  }

  /**
   * 刪掉一個租戶:先照登記逐表刪(依賴的表在前),再刪核心關聯、角色、只屬於它的使用者與組織樹。
   * 也屬於租戶外組織(含根組織)的人不刪,只少了這個租戶的所屬與角色。
   */
  async purgeTenant(
    plan: TenantPurgePlan,
    tenantId: Types.ObjectId,
    session: ClientSession,
  ): Promise<TenantPurgeResult> {
    const files = new Set<string>();
    const counts = new Map<string, number>();
    const remove = async (
      collection: string,
      filter: Filter | null,
    ): Promise<Record<string, unknown>[]> => {
      if (filter === null) {
        return [];
      }
      const target = this.db().collection(collection);
      // 讀出來是為了找檔案路徑與後面步驟要對的值
      const cursor = target.find({ ...filter }, { session });
      const documents = await cursor.toArray();
      for (const document of documents) {
        collectFilePaths(document, files);
      }
      const { deletedCount } = await target.deleteMany(filter, { session });
      if (deletedCount > 0) {
        counts.set(collection, (counts.get(collection) ?? 0) + deletedCount);
      }
      return documents;
    };

    const tenantOrgIds = await this.tenantOrgIds(tenantId, session);
    const { purgedUserIds, detachedUserIds } = await this.membersOf(
      tenantOrgIds,
      session,
    );
    const roleLinks = await this.links(
      { type: "org_role", firstId: { $in: tenantOrgIds } },
      session,
    );
    const roleIds = roleLinks.map((link) => link.secondId);

    const deletedValues = new Map<string, Map<string, unknown[]>>();
    const scope = { tenantId, tenantOrgIds, purgedUserIds, deletedValues };
    const dependentKeys = dependentKeysOf(plan);
    for (const step of plan.steps) {
      const documents = await remove(
        step.collection,
        filterOfStep(step, scope),
      );
      const keys = dependentKeys.get(step.collection) ?? [];
      if (keys.length > 0) {
        deletedValues.set(
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
    );
    await remove("roles", idsIn("_id", roleIds));
    await remove("users", idsIn("_id", purgedUserIds));
    await remove(ORGS_COLLECTION, idsIn("_id", tenantOrgIds));

    const collections = [...counts]
      .map(([collection, deleted]) => ({ collection, deleted }))
      .toSorted((left, right) =>
        left.collection.localeCompare(right.collection),
      );
    return {
      collections,
      deletedDocuments: collections.reduce(
        (sum, entry) => sum + entry.deleted,
        0,
      ),
      purgedUserIds,
      detachedUserIds,
      filePaths: [...files],
    };
  }

  private db() {
    const { db } = this.connection;
    if (db === undefined) {
      throw new Error("資料庫連線尚未建立");
    }
    return db;
  }

  /** 租戶頂層與它所有下層(物化路徑 ancestors)。 */
  private async tenantOrgIds(
    tenantId: Types.ObjectId,
    session: ClientSession,
  ): Promise<Types.ObjectId[]> {
    const cursor = this.db()
      .collection<IdDocument>(ORGS_COLLECTION)
      .find(
        { $or: [{ _id: tenantId }, { ancestors: tenantId }] },
        { projection: { _id: 1 }, session },
      );
    const orgs = await cursor.toArray();
    return orgs.map((org) => org._id);
  }

  private links(
    filter: Filter,
    session: ClientSession,
  ): Promise<LinkDocument[]> {
    return this.db()
      .collection<LinkDocument>(CORE_RELATIONSHIPS_COLLECTION)
      .find({ ...filter }, { projection: { firstId: 1, secondId: 1 }, session })
      .toArray();
  }

  /** 這個租戶的成員分兩種:所屬組織全在租戶內 → 刪掉;另外還屬於租戶外的組織 → 只移除所屬。 */
  private async membersOf(
    tenantOrgIds: readonly Types.ObjectId[],
    session: ClientSession,
  ): Promise<{
    purgedUserIds: Types.ObjectId[];
    detachedUserIds: Types.ObjectId[];
  }> {
    const memberLinks = await this.links(
      { type: "org_user", firstId: { $in: [...tenantOrgIds] } },
      session,
    );
    const members = uniqueIds(memberLinks.map((link) => link.secondId));
    if (members.length === 0) {
      return { purgedUserIds: [], detachedUserIds: [] };
    }
    const inTenant = new Set(tenantOrgIds.map(String));
    const allLinks = await this.links(
      { type: "org_user", secondId: { $in: members } },
      session,
    );
    const outside = new Set(
      allLinks
        .filter((link) => !inTenant.has(String(link.firstId)))
        .map((link) => String(link.secondId)),
    );
    return {
      purgedUserIds: members.filter((id) => !outside.has(String(id))),
      detachedUserIds: members.filter((id) => outside.has(String(id))),
    };
  }
}
