import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { AuditService } from "../../../audit/audit.service";
import type { Persisted, TenantRef } from "../../../database/base.repository";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import type { ContactRole } from "../../database/lottery-dealers/lottery-dealer-contact.schema";
import type { DealerType } from "../../database/lottery-dealers/lottery-dealer.schema";
import {
  LotteryDealerContactsRepository,
  LotteryDealersRepository,
  type LotteryRelationshipDocument,
  LotteryRelationshipsRepository,
} from "../../database/lottery-dealers/lottery-dealers.repository";
import type { LotteryRelationshipType } from "../../database/lottery-dealers/lottery-relationship.schema";
import { AUDIT_ACTIONS, AUDIT_TARGETS, CONTACT_LIMITS } from "./dealer-keys";
import {
  type ConflictRelationship,
  DEALER_CONFLICT_REASONS,
  DEALER_REASONS,
  conflictError,
  validationError,
} from "./dealers-error";

export const DEALER_CONTACT = "lottery_dealer_lottery_dealer_contact";
export const DEALER_DEALER = "lottery_dealer_lottery_dealer";
export const ORG_DEALER = "org_lottery_dealer";

export type RelationshipRecord = Persisted<LotteryRelationshipDocument>;

/** 經銷商的關聯(主檔編輯畫面上的那幾個欄位)。 */
export interface DealerLinks {
  coSalesDealerId: Types.ObjectId | null;
  contacts: Record<ContactRole, Types.ObjectId[]>;
  storeOrgId: Types.ObjectId | null;
}

export const ROLE_FIELDS: Record<ContactRole, string> = {
  agent: "agentIds",
  trustee: "trusteeIds",
  introducer: "introducerIds",
};

export const CONTACT_ROLES_IN_ORDER: readonly ContactRole[] = [
  "agent",
  "trustee",
  "introducer",
];

export function emptyLinks(): DealerLinks {
  return {
    coSalesDealerId: null,
    contacts: { agent: [], trustee: [], introducer: [] },
    storeOrgId: null,
  };
}

/** 寫關聯時需要知道的那一位經銷商。 */
export interface LinkOwner {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  tenantId: Types.ObjectId | null;
  type: DealerType;
  nationalId: string;
  name: string;
  licenseNo: string;
}

const sameIds = (
  left: readonly Types.ObjectId[],
  right: readonly Types.ObjectId[],
): boolean =>
  left.length === right.length &&
  left.every((id) => right.some((other) => other.equals(id)));

const sameId = (
  left: Types.ObjectId | null,
  right: Types.ObjectId | null,
): boolean =>
  left === null || right === null ? left === right : left.equals(right);

const includesId = (
  ids: readonly Types.ObjectId[],
  id: Types.ObjectId,
): boolean => ids.some((other) => other.equals(id));

/** 一筆要新增 / 解除的關聯。 */
interface LinkSpec {
  type: LotteryRelationshipType;
  firstId: Types.ObjectId;
  secondId: Types.ObjectId;
  role?: ContactRole;
}

const contactLink = (
  owner: LinkOwner,
  id: Types.ObjectId,
  role: ContactRole,
): LinkSpec => ({
  type: DEALER_CONTACT,
  firstId: owner._id,
  secondId: id,
  role,
});

/**
 * 一位關係人能不能掛上去:要存在、本人(身分證字號相同)不能登記;**新加的**還要有該身分且啟用中
 * (已有的關聯在關係人停用後保留)。
 */
function checkContact(
  contact:
    { nationalId: string; roles: ContactRole[]; status: string } | undefined,
  {
    role,
    owner,
    isNew,
  }: { role: ContactRole; owner: LinkOwner; isNew: boolean },
): void {
  const field = ROLE_FIELDS[role];
  if (contact === undefined) {
    throw validationError(
      "contact not found",
      [field],
      DEALER_REASONS.referenceNotFound,
    );
  }
  if (contact.nationalId === owner.nationalId) {
    throw validationError(
      "a dealer cannot be their own contact",
      [field],
      DEALER_REASONS.selfRelation,
    );
  }
  if (!isNew) {
    return;
  }
  if (!contact.roles.includes(role)) {
    throw validationError(
      `contact is not a(n) ${role}`,
      [field],
      DEALER_REASONS.contactRoleMismatch,
    );
  }
  if (contact.status !== "active") {
    throw validationError(
      "contact is disabled",
      [field],
      DEALER_REASONS.contactDisabled,
    );
  }
}

/**
 * 刮刮樂的關聯 `lottery_relationships`(專案規格 5.4;規則正本 `docs/modules/project/dealers.md`「規則」)。
 *
 * - 讀:看得到經銷商(含共用進來的)就看得到它的關聯;關聯列以租戶為邊界讀(`dealerTenantReader`),
 *   條件一律釘在看得到的經銷商 id 上
 * - 跨可見範圍的問題:對應分店是否已被占用 → `existsInTenant`;共同銷售人數、關係人被誰關聯 → 以租戶為邊界反查;
 *   被引用的經銷商 / 關係人名稱 → `findRefsInTenant`
 * - 寫:由經銷商 / 關係人的 service 在**同一個交易**裡呼叫;每一筆新增、解除各寫一筆 audit_log
 */
@Injectable()
export class DealerLinksService {
  constructor(
    private readonly relationships: LotteryRelationshipsRepository,
    private readonly dealers: LotteryDealersRepository,
    private readonly contacts: LotteryDealerContactsRepository,
    private readonly orgs: OrgsRepository,
    private readonly audit: AuditService,
  ) {}

  /** 多位經銷商(作為 first)的關聯:dealerId → 關聯。 */
  async linksOf(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    dealerIds: readonly Types.ObjectId[],
  ): Promise<Map<string, DealerLinks>> {
    const result = new Map<string, DealerLinks>(
      dealerIds.map((id) => [String(id), emptyLinks()]),
    );
    if (dealerIds.length === 0) {
      return result;
    }
    // 呼叫端給的 dealerIds 一律是操作者看得到的經銷商;關聯列以租戶為邊界讀(共用進來的也讀得到)
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const rows = await this.relationships.findMany(
      reader,
      {
        tenantId,
        type: { $in: [DEALER_CONTACT, DEALER_DEALER] },
        firstId: { $in: [...dealerIds] },
      },
      { sort: { createdAt: 1, _id: 1 } },
    );
    const stores = await this.relationships.findMany(reader, {
      tenantId,
      type: ORG_DEALER,
      secondId: { $in: [...dealerIds] },
    });
    for (const row of rows) {
      const links = result.get(String(row.firstId));
      if (links === undefined) {
        continue;
      }
      if (row.type === DEALER_DEALER) {
        links.coSalesDealerId = row.secondId;
      } else {
        const role = row.meta.role as ContactRole;
        links.contacts[role].push(row.secondId);
      }
    }
    for (const row of stores) {
      const links = result.get(String(row.secondId));
      if (links !== undefined) {
        links.storeOrgId = row.firstId;
      }
    }
    return result;
  }

  /** 乙類的共同銷售人(整個租戶,反查 `lottery_dealer_lottery_dealer`)。 */
  async coSellerRows(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    dealerIds: readonly Types.ObjectId[],
  ): Promise<RelationshipRecord[]> {
    return this.relationships.findMany(
      await tenantBoundaryContext(this.orgs, operator, tenantId),
      { tenantId, type: DEALER_DEALER, secondId: { $in: [...dealerIds] } },
      { sort: { createdAt: 1, _id: 1 } },
    );
  }

  /** 整個租戶已對應乙類的分店。 */
  async occupiedStoreRows(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
  ): Promise<RelationshipRecord[]> {
    return this.relationships.findMany(
      await tenantBoundaryContext(this.orgs, operator, tenantId),
      {
        tenantId,
        type: ORG_DEALER,
      },
    );
  }

  /** 關係人被哪些經銷商關聯(整個租戶)。 */
  async contactRows(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    contactIds: readonly Types.ObjectId[],
  ): Promise<RelationshipRecord[]> {
    return this.relationships.findMany(
      await tenantBoundaryContext(this.orgs, operator, tenantId),
      { tenantId, type: DEALER_CONTACT, secondId: { $in: [...contactIds] } },
      { sort: { createdAt: 1, _id: 1 } },
    );
  }

  /**
   * 驗證並寫入一位經銷商的關聯(在呼叫端的交易內):`desired` 是最後要的樣子,`current` 是現在的樣子。
   * `releaseAgents`:移除共同銷售處所但還有代理人時一併解除(沒給 → `CONFLICT` 列出代理人)。
   */
  async save(
    operator: OperatorContext,
    owner: LinkOwner,
    current: DealerLinks,
    desired: DealerLinks,
    options: { releaseAgents: boolean; agentsGiven: boolean },
  ): Promise<void> {
    const next = await this.resolveCoSalesRemoval(
      operator,
      owner,
      current,
      desired,
      options,
    );
    this.checkLimits(owner.type, next);
    await this.checkContacts(operator, owner, current, next);
    await this.checkCoSales(operator, owner, current, next);
    await this.checkStore(operator, owner, current, next);
    await this.apply(operator, owner, current, next);
  }

  /**
   * 甲類要先有共同銷售處所才能設代理人:
   * - 這次移除共同銷售處所、代理人沒跟著改 → 還有代理人就 `CONFLICT`(列出代理人);`releaseAgents` → 一併解除
   * - 其他情況(新設代理人但沒有共同銷售處所)→ `VALIDATION_FAILED`(`AGENT_REQUIRES_CO_SALES`)
   */
  private async resolveCoSalesRemoval(
    operator: OperatorContext,
    owner: LinkOwner,
    current: DealerLinks,
    desired: DealerLinks,
    options: { releaseAgents: boolean; agentsGiven: boolean },
  ): Promise<DealerLinks> {
    if (
      owner.type !== "a" ||
      desired.coSalesDealerId !== null ||
      desired.contacts.agent.length === 0
    ) {
      return desired;
    }
    const removingCoSales =
      current.coSalesDealerId !== null &&
      (!options.agentsGiven ||
        sameIds(desired.contacts.agent, current.contacts.agent));
    if (!removingCoSales) {
      throw validationError(
        "class A needs a co-sales store before agents",
        ["agentIds"],
        DEALER_REASONS.agentRequiresCoSales,
      );
    }
    if (!options.releaseAgents) {
      const names = await this.contactNames(
        operator,
        owner,
        desired.contacts.agent,
      );
      throw conflictError(
        "removing the co-sales store while agents remain",
        DEALER_CONFLICT_REASONS.agentsRequireCoSales,
        desired.contacts.agent.map((contactId) => ({
          role: "agent",
          dealerId: String(owner._id),
          dealerName: owner.name,
          licenseNo: owner.licenseNo,
          contactId: String(contactId),
          contactName: names.get(String(contactId)) ?? "",
        })),
      );
    }
    return { ...desired, contacts: { ...desired.contacts, agent: [] } };
  }

  /** 甲:代理人 2、受託人 2、介紹人 1;乙:代理人 2、介紹人 1、不能有受託人。 */
  private checkLimits(type: DealerType, links: DealerLinks): void {
    for (const role of CONTACT_ROLES_IN_ORDER) {
      const ids = links.contacts[role];
      const unique = ids.filter(
        (id, index) => ids.findIndex((other) => other.equals(id)) === index,
      );
      if (unique.length !== ids.length) {
        throw validationError(`duplicate ${role}`, [ROLE_FIELDS[role]]);
      }
      const limit = CONTACT_LIMITS[type][role];
      if (ids.length > limit) {
        throw validationError(
          `too many ${role} for class ${type}`,
          [ROLE_FIELDS[role]],
          limit === 0
            ? DEALER_REASONS.trusteeNotAllowed
            : DEALER_REASONS.roleLimit,
        );
      }
    }
  }

  /**
   * 關係人:要存在、本人(身分證字號相同)不能登記;**新加的**還要有該身分且啟用中
   * (已有的關聯在關係人停用後保留)。
   */
  private async checkContacts(
    operator: OperatorContext,
    owner: LinkOwner,
    current: DealerLinks,
    next: DealerLinks,
  ): Promise<void> {
    const allIds = CONTACT_ROLES_IN_ORDER.flatMap(
      (role) => next.contacts[role],
    );
    if (allIds.length === 0) {
      return;
    }
    const found = await this.contactRefs(operator, owner.tenantId, allIds);
    const byId = new Map(
      found.map((contact) => [
        String(contact._id),
        {
          nationalId: String(contact.nationalId),
          roles: contact.roles as ContactRole[],
          status: String(contact.status),
        },
      ]),
    );
    for (const role of CONTACT_ROLES_IN_ORDER) {
      for (const id of next.contacts[role]) {
        checkContact(byId.get(String(id)), {
          role,
          owner,
          isNew: !includesId(current.contacts[role], id),
        });
      }
    }
  }

  /** 共同銷售處所:只有甲類;要是乙類、新選的不能是解約的。 */
  private async checkCoSales(
    operator: OperatorContext,
    owner: LinkOwner,
    current: DealerLinks,
    next: DealerLinks,
  ): Promise<void> {
    const target = next.coSalesDealerId;
    if (target === null || sameId(target, current.coSalesDealerId)) {
      return;
    }
    if (owner.type !== "a") {
      throw validationError(
        "only class A has a co-sales store",
        ["coSalesDealerId"],
        DEALER_REASONS.notForType,
      );
    }
    // 共同銷售處所可以是操作者看不到的乙類:只讀判斷要的欄位(租戶內引用名稱出口)
    const [dealer] =
      owner.tenantId === null
        ? []
        : await this.dealers.findRefsInTenant(operator, owner.tenantId, [
            target,
          ]);
    if (dealer === undefined) {
      throw validationError(
        "co-sales dealer not found",
        ["coSalesDealerId"],
        DEALER_REASONS.referenceNotFound,
      );
    }
    if (dealer.type !== "b") {
      throw validationError(
        "co-sales store must be class B",
        ["coSalesDealerId"],
        DEALER_REASONS.coSalesNotClassB,
      );
    }
    if (dealer.status === "terminated") {
      throw validationError(
        "co-sales dealer is terminated",
        ["coSalesDealerId"],
        DEALER_REASONS.dealerTerminated,
      );
    }
  }

  /** 對應分店:只有乙類;要是租戶底下的組織、還沒對應其他乙類(一對一)。 */
  private async checkStore(
    operator: OperatorContext,
    owner: LinkOwner,
    current: DealerLinks,
    next: DealerLinks,
  ): Promise<void> {
    const orgId = next.storeOrgId;
    if (orgId === null || sameId(orgId, current.storeOrgId)) {
      return;
    }
    if (owner.type !== "b") {
      throw validationError(
        "only class B has a store",
        ["storeOrgId"],
        DEALER_REASONS.notForType,
      );
    }
    // 對應分店可以是操作者看不到的分店:以租戶的組織樹讀(讀不到 = 不在這個租戶)
    const org =
      owner.tenantId === null
        ? null
        : await this.orgs.findById(
            await tenantBoundaryContext(this.orgs, operator, owner.tenantId),
            orgId,
          );
    if (
      org === null ||
      owner.tenantId === null ||
      org._id.equals(owner.tenantId) ||
      !org.ancestors.some((ancestor) => ancestor.equals(owner.tenantId))
    ) {
      throw validationError(
        "store must be an org under the tenant",
        ["storeOrgId"],
        DEALER_REASONS.storeNotBranch,
      );
    }
    // 一對一:整個租戶有沒有別的乙類對應了這家店(現在對應的就是它的話,上面已經提早回了)
    const taken = await this.relationships.existsInTenant(
      operator,
      owner.tenantId,
      { type: ORG_DEALER, firstId: orgId },
    );
    if (taken) {
      throw validationError(
        "store already belongs to another class B dealer",
        ["storeOrgId"],
        DEALER_REASONS.storeOccupied,
      );
    }
  }

  /** 差異寫入:要的沒有就新增、有的不要就解除(軟刪除);各寫一筆稽核。 */
  private async apply(
    operator: OperatorContext,
    owner: LinkOwner,
    current: DealerLinks,
    next: DealerLinks,
  ): Promise<void> {
    for (const role of CONTACT_ROLES_IN_ORDER) {
      const before = current.contacts[role];
      const after = next.contacts[role];
      for (const id of before.filter((id) => !includesId(after, id))) {
        await this.unlink(operator, owner, contactLink(owner, id, role));
      }
      for (const id of after.filter((id) => !includesId(before, id))) {
        await this.link(operator, owner, contactLink(owner, id, role));
      }
    }
    await this.replaceSingle(
      operator,
      owner,
      current.coSalesDealerId,
      next.coSalesDealerId,
      (id) => ({ type: DEALER_DEALER, firstId: owner._id, secondId: id }),
    );
    await this.replaceSingle(
      operator,
      owner,
      current.storeOrgId,
      next.storeOrgId,
      (id) => ({ type: ORG_DEALER, firstId: id, secondId: owner._id }),
    );
    if (!sameId(current.storeOrgId, next.storeOrgId)) {
      // 對應分店在經銷商上的副本(資料共用的 sharedByFields,ADR-0014):與關聯同一個交易
      await this.dealers.updateById(operator, owner._id, {
        $set: { storeOrgId: next.storeOrgId },
      });
    }
  }

  /** 一對一的關聯(共同銷售處所、對應分店):換了就先解除舊的再新增新的。 */
  private async replaceSingle(
    operator: OperatorContext,
    owner: LinkOwner,
    before: Types.ObjectId | null,
    after: Types.ObjectId | null,
    linkOf: (id: Types.ObjectId) => LinkSpec,
  ): Promise<void> {
    if (sameId(before, after)) {
      return;
    }
    if (before !== null) {
      await this.unlink(operator, owner, linkOf(before));
    }
    if (after !== null) {
      await this.link(operator, owner, linkOf(after));
    }
  }

  /**
   * 關係人取消身分時一併解除那些關聯(關係人 service 已確認操作者同意,在同一個交易內)。
   * **例外寫入**(`docs/modules/project/dealers.md`「規則」):關聯的 `orgId` 屬各經銷商,可能在操作者的
   * 可見範圍外 —— 畫面先告訴他「另有 N 筆你看不到的關聯也會一起解除」,確認後以租戶為邊界解除。
   */
  async releaseContactRoles(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    rows: readonly RelationshipRecord[],
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    const writer = await tenantBoundaryContext(this.orgs, operator, tenantId);
    for (const row of rows) {
      await this.relationships.softDeleteById(writer, row._id);
      await this.recordAudit(operator, AUDIT_ACTIONS.relationshipDelete, row);
    }
  }

  /**
   * 衝突清單:關聯 → 列給使用者看的經銷商與關係人名稱。**只列操作者看得到的經銷商**上的關聯,
   * 看不到的只回筆數(`hiddenCount`;畫面提示「另有 N 筆你看不到的關聯也會一起解除」)。
   */
  async describe(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    rows: readonly RelationshipRecord[],
  ): Promise<{ relationships: ConflictRelationship[]; hiddenCount: number }> {
    const dealerIds = rows.map((row) => row.firstId);
    const visibleDealers =
      dealerIds.length === 0
        ? []
        : await this.dealers.findMany(operator, { _id: { $in: dealerIds } });
    const dealerOf = new Map(
      visibleDealers.map((dealer) => [String(dealer._id), dealer]),
    );
    const visible = rows.filter((row) => dealerOf.has(String(row.firstId)));
    const contacts = await this.contactRefs(
      operator,
      tenantId,
      visible.map((row) => row.secondId),
    );
    const contactOf = new Map(
      contacts.map((contact) => [String(contact._id), String(contact.name)]),
    );
    return {
      relationships: visible.map((row) => {
        const dealer = dealerOf.get(String(row.firstId));
        return {
          role: String(row.meta.role),
          dealerId: String(row.firstId),
          dealerName: dealer?.name ?? "",
          licenseNo: dealer?.licenseNo ?? "",
          contactId: String(row.secondId),
          contactName: contactOf.get(String(row.secondId)) ?? "",
        };
      }),
      hiddenCount: rows.length - visible.length,
    };
  }

  /** 關係人的判斷 / 顯示欄位(租戶內引用名稱出口:看得到經銷商就看得到它關聯的關係人)。 */
  private async contactRefs(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    ids: readonly Types.ObjectId[],
  ): Promise<TenantRef[]> {
    if (ids.length === 0) {
      return [];
    }
    if (tenantId === null) {
      const found = await this.contacts.findMany(operator, {
        _id: { $in: [...ids] },
      });
      return found.map((contact) => ({
        _id: contact._id,
        name: contact.name,
        status: contact.status,
        nationalId: contact.nationalId,
        roles: contact.roles,
      }));
    }
    return this.contacts.findRefsInTenant(operator, tenantId, ids);
  }

  private async contactNames(
    operator: OperatorContext,
    owner: LinkOwner,
    ids: readonly Types.ObjectId[],
  ): Promise<Map<string, string>> {
    const found = await this.contactRefs(operator, owner.tenantId, ids);
    return new Map(
      found.map((contact) => [String(contact._id), String(contact.name)]),
    );
  }

  private async link(
    operator: OperatorContext,
    owner: LinkOwner,
    link: LinkSpec,
  ): Promise<void> {
    // 關聯的 orgId = 經銷商的 orgId(操作者正在改這位經銷商,一定在他的可見範圍內)
    const created = await this.relationships.create(operator, {
      orgId: owner.orgId,
      tenantId: owner.tenantId,
      type: link.type,
      firstId: link.firstId,
      secondId: link.secondId,
      thirdId: null,
      meta: link.role === undefined ? {} : { role: link.role },
    });
    await this.recordAudit(operator, AUDIT_ACTIONS.relationshipCreate, created);
  }

  private async unlink(
    operator: OperatorContext,
    owner: LinkOwner,
    link: LinkSpec,
  ): Promise<void> {
    const row = await this.relationships.findOne(operator, {
      tenantId: owner.tenantId,
      type: link.type,
      firstId: link.firstId,
      secondId: link.secondId,
      ...(link.role === undefined ? {} : { "meta.role": link.role }),
    });
    if (row === null) {
      return;
    }
    await this.relationships.softDeleteById(operator, row._id);
    await this.recordAudit(operator, AUDIT_ACTIONS.relationshipDelete, row);
  }

  private async recordAudit(
    operator: OperatorContext,
    action: string,
    row: RelationshipRecord,
  ): Promise<void> {
    const snapshot = {
      type: row.type,
      firstId: String(row.firstId),
      secondId: String(row.secondId),
      ...(row.meta.role === undefined ? {} : { role: row.meta.role }),
    };
    await this.audit.record(operator, {
      action,
      targetType: AUDIT_TARGETS.relationship,
      targetId: row._id,
      ...(action === AUDIT_ACTIONS.relationshipCreate
        ? { after: snapshot }
        : { before: snapshot }),
    });
  }
}

export function toObjectIds(
  values: readonly string[],
  field: string,
): Types.ObjectId[] {
  return values.map((value) => toObjectId(value, field));
}

export function toObjectId(value: string, field: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw validationError(`${field} is not a valid id: ${value}`, [field]);
  }
  return new Types.ObjectId(value);
}
