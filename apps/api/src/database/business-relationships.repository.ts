/* eslint-disable @repo/no-raw-model-query -- 此檔即 business_relationships 的唯一合法出口:不掛 tenantScope,改由本檔每個方法強制帶 tenantId(fail-closed);到期條件:無 */
import mongoose, { type Model, type Types } from "mongoose";

import { OPERATOR_LOCAL_KEY, type OperatorContext } from "./operator-context";
import type { BaseFields } from "./plugins/base-fields.plugin";
import { TenantScopeError } from "./plugins/tenant-scope.plugin";
import type {
  BusinessRelationship,
  BusinessRelationshipType,
} from "./schemas/business-relationship.schema";
import { ORGS_COLLECTION } from "./schemas/org.schema";
import { tenantIdOfOrg } from "./tenant-id";
import { currentSession } from "./transaction";

/** 已落庫的一筆業務關聯(含基礎欄位,ADR-0007)。 */
export type BusinessRelationshipRecord = BusinessRelationship &
  BaseFields & { _id: Types.ObjectId };

/** 查詢條件(`tenantId` 由方法參數給,不在這裡)。 */
export interface BusinessRelationshipFilter {
  type: BusinessRelationshipType;
  firstId?: Types.ObjectId;
  secondId?: Types.ObjectId | { $in: Types.ObjectId[] };
  /** 三方關聯的第三方(`org_form_workflow` 的 workflow;反查「哪些表單綁了這個流程」)。 */
  thirdId?: Types.ObjectId | { $in: Types.ObjectId[] };
  /** `meta` 底下的等值條件(如 `{ enabled: true }` → `meta.enabled: true`)。 */
  meta?: Record<string, unknown>;
}

/** 新增一筆關聯的內容。 */
export interface BusinessRelationshipLink {
  type: BusinessRelationshipType;
  firstId: Types.ObjectId;
  secondId: Types.ObjectId;
  /** 三方關聯的第三方(`org_form_workflow` 必給);其他 type 省略 = null。 */
  thirdId?: Types.ObjectId | null;
  meta?: Record<string, unknown>;
}

/**
 * `business_relationships` 的存取層(`docs/data-model.md`「business_relationships」)。
 *
 * 這張表**不掛可見範圍插件**(部門使用者的可見範圍不含租戶頂層,掛了就查不到本租戶的列),
 * 邊界改成 `tenantId`:**每個讀寫方法第一個參數就是 `tenantId`**,給 `null` / `undefined`
 * 或不是 ObjectId 一律拋 `TenantScopeError`(fail-closed,與插件缺上下文時同一個精神)。
 *
 * `tenantId` 從哪來:`tenantIdFor(operator, requested)` —— 一般操作者只能用自己當前組織的租戶,
 * 根組織操作者可以指定目標租戶(root 分派表單時寫目標租戶的 id)。
 */
export class BusinessRelationshipsRepository {
  constructor(private readonly model: Model<BusinessRelationship>) {}

  /**
   * 這次操作要用的 `tenantId`:
   * - 操作者站在租戶內 → 自己當前組織的租戶頂層;`requested` 給了別的租戶 → 拋錯
   * - 操作者站在根組織 → 必須明給 `requested`(根組織自己不是租戶,沒有預設)
   */
  async tenantIdFor(
    operator: OperatorContext,
    requested?: Types.ObjectId | string | null,
  ): Promise<Types.ObjectId> {
    if (operator.currentOrgId === null) {
      throw new TenantScopeError("business_relationships:操作者沒有當前組織");
    }
    const org = await this.model.db
      .collection<{ ancestors?: Types.ObjectId[] }>(ORGS_COLLECTION)
      .findOne(
        { _id: operator.currentOrgId },
        { projection: { ancestors: 1 }, session: currentSession() },
      );
    if (!org) {
      throw new TenantScopeError(
        `business_relationships:當前組織 ${String(operator.currentOrgId)} 不存在`,
      );
    }
    const own = tenantIdOfOrg({ _id: org._id, ancestors: org.ancestors ?? [] });
    const wanted =
      requested === undefined || requested === null
        ? null
        : new mongoose.Types.ObjectId(String(requested));
    if (own === null) {
      // 根組織操作者:可指定任一租戶,但一定要指定,而且必須是真的租戶頂層 ——
      // 否則會寫出指向不存在租戶(或部門)的孤兒 `org_form`
      return this.assertTenantTop(assertTenantId(wanted));
    }
    if (wanted !== null && !wanted.equals(own)) {
      throw new TenantScopeError(
        "business_relationships:租戶內的操作者只能存取自己租戶的關聯",
      );
    }
    return own;
  }

  /** `tenantId` 必須是存在的租戶頂層(`ancestors` 只有根組織一層),否則拋錯。 */
  private async assertTenantTop(
    tenantId: Types.ObjectId,
  ): Promise<Types.ObjectId> {
    const org = await this.model.db
      .collection<{ ancestors?: Types.ObjectId[] }>(ORGS_COLLECTION)
      .findOne(
        { _id: tenantId },
        { projection: { ancestors: 1 }, session: currentSession() },
      );
    if (org?.ancestors?.length !== 1) {
      throw new TenantScopeError(
        `business_relationships:${String(tenantId)} 不是存在的租戶頂層`,
      );
    }
    return tenantId;
  }

  async findMany(
    tenantId: Types.ObjectId | null | undefined,
    filter: BusinessRelationshipFilter,
  ): Promise<BusinessRelationshipRecord[]> {
    const documents = await this.model
      .find(conditionOf(assertTenantId(tenantId), filter))
      .lean<BusinessRelationshipRecord[]>()
      .session(currentSession() ?? null)
      .exec();
    return documents;
  }

  async findOne(
    tenantId: Types.ObjectId | null | undefined,
    filter: BusinessRelationshipFilter,
  ): Promise<BusinessRelationshipRecord | null> {
    return this.model
      .findOne(conditionOf(assertTenantId(tenantId), filter))
      .lean<BusinessRelationshipRecord>()
      .session(currentSession() ?? null)
      .exec();
  }

  /** 新增一筆;同一 `(tenantId, type, firstId, secondId)` 已存在時由唯一索引拒絕(duplicate key)。 */
  async create(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null | undefined,
    link: BusinessRelationshipLink,
  ): Promise<BusinessRelationshipRecord> {
    const document = new this.model({
      tenantId: assertTenantId(tenantId),
      type: link.type,
      firstId: link.firstId,
      secondId: link.secondId,
      thirdId: link.thirdId ?? null,
      ...(link.meta === undefined ? {} : { meta: link.meta }),
    });
    // baseFields 的 save 中介層從這裡取操作者,填 createdBy / updatedBy(ADR-0007)
    document.$locals[OPERATOR_LOCAL_KEY] = operator;
    await document.save({ session: currentSession() ?? null });
    return document.toObject<BusinessRelationshipRecord>();
  }

  /** 整份覆蓋某筆的 `meta`(如 `org_form` 的 `{ enabled }`);回更新後的列,不存在回 null。 */
  async setMeta(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null | undefined,
    filter: BusinessRelationshipFilter,
    meta: Record<string, unknown>,
  ): Promise<BusinessRelationshipRecord | null> {
    return this.model
      .findOneAndUpdate(
        conditionOf(assertTenantId(tenantId), filter),
        { $set: { meta, updatedBy: operator.actorId } },
        { returnDocument: "after" },
      )
      .lean<BusinessRelationshipRecord>()
      .session(currentSession() ?? null)
      .exec();
  }

  /**
   * 換三方關聯的第三方(`org_form_workflow` 換流程 = 改 `thirdId`);回更新後的列,不存在回 null。
   * 唯一鍵不含 `thirdId`,所以換流程是改同一筆,不是新增。
   */
  async setThirdId(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null | undefined,
    filter: BusinessRelationshipFilter,
    thirdId: Types.ObjectId,
  ): Promise<BusinessRelationshipRecord | null> {
    return this.model
      .findOneAndUpdate(
        conditionOf(assertTenantId(tenantId), filter),
        { $set: { thirdId, updatedBy: operator.actorId } },
        { returnDocument: "after" },
      )
      .lean<BusinessRelationshipRecord>()
      .session(currentSession() ?? null)
      .exec();
  }

  /**
   * 刪除符合條件的列(root 收回分派 = 刪 `org_form` 這筆),回刪除筆數。
   * 關聯是「有 / 沒有」的事實,不留軟刪除殭屍 —— 否則唯一索引會擋住之後再分派(同 `RelationService`)。
   */
  async deleteMany(
    tenantId: Types.ObjectId | null | undefined,
    filter: BusinessRelationshipFilter,
  ): Promise<number> {
    const { deletedCount } = await this.model
      .deleteMany(conditionOf(assertTenantId(tenantId), filter))
      .session(currentSession() ?? null)
      .exec();
    return deletedCount;
  }
}

/** 沒有 `tenantId` 條件的查詢直接拋錯(fail-closed)。 */
function assertTenantId(
  tenantId: Types.ObjectId | null | undefined,
): Types.ObjectId {
  if (!(tenantId instanceof mongoose.Types.ObjectId)) {
    throw new TenantScopeError(
      "business_relationships 的每個讀寫都必須帶 tenantId(以租戶為邊界)",
    );
  }
  return tenantId;
}

function conditionOf(
  tenantId: Types.ObjectId,
  filter: BusinessRelationshipFilter,
): Record<string, unknown> {
  const condition: Record<string, unknown> = {
    tenantId,
    type: filter.type,
    deletedAt: null,
  };
  if (filter.firstId !== undefined) {
    condition.firstId = filter.firstId;
  }
  if (filter.secondId !== undefined) {
    condition.secondId = filter.secondId;
  }
  if (filter.thirdId !== undefined) {
    condition.thirdId = filter.thirdId;
  }
  for (const [key, value] of Object.entries(filter.meta ?? {})) {
    condition[`meta.${key}`] = value;
  }
  return condition;
}
