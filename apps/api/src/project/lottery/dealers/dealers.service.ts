import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { startOfLocalDay } from "@repo/domain/form";

import { AuditService } from "../../../audit/audit.service";
import { authError } from "../../../auth/auth-error";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { normalizeShareOrgs } from "../../../database/share-orgs";
import { TransactionService } from "../../../database/transaction";
import { RealtimePublisher } from "../../../realtime/realtime-publisher.service";
import { toShareOrgModels } from "../../../sharing/share-org.model";
import {
  LotteryDealerSigninsRepository,
  LotteryDealersRepository,
} from "../../database/lottery-dealers/lottery-dealers.repository";
import {
  PROTECTED_FIELDS,
  applyInput,
  changesOf,
  createdAudit,
  desiredLinks,
  draftOf,
  newDraft,
} from "./dealer-changes";
import { quarterOf, thresholdsOf } from "./dealer-dates";
import {
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  DEALERS_KEY,
  DEALERS_PERMISSIONS,
} from "./dealer-keys";
import {
  DealerLinksService,
  emptyLinks,
  toObjectId,
} from "./dealer-links.service";
import { type DealerRecord, dealerRefOf } from "./dealer-mapper";
import { dealerRefFrom } from "./dealer-tenant";
import { type DealerValues, validateDealerDraft } from "./dealer-validation";
import { DealerViewService } from "./dealer-view.service";
import { DealersAccess, type DealersGrant } from "./dealers-access";
import {
  DEALER_REASONS,
  fieldForbiddenError,
  notFoundError,
  validationError,
} from "./dealers-error";
import {
  type CreateLotteryDealerInput,
  DEFAULT_PAGE_SIZE,
  type LotteryDealersInput,
  MAX_PAGE_SIZE,
  type UpdateLotteryDealerInput,
} from "./dto/lottery-dealer.input";
import type {
  LotteryDealerCoSellersPayload,
  LotteryDealerModel,
  LotteryDealerRef,
  LotteryDealersPayload,
  LotteryOccupiedStoresPayload,
} from "./models/lottery-dealer.model";
import { DealerPurchaseDates } from "./purchase-dates";

function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** 兩個批購基準日 → 各自的 `edit-` 權限。 */
const EDIT_PERMISSION_OF: Record<(typeof PROTECTED_FIELDS)[number], string> = {
  lastPurchaseBaseDate: DEALERS_PERMISSIONS.editLastPurchaseBaseDate,
  lastSelfPurchaseBaseDate: DEALERS_PERMISSIONS.editLastSelfPurchaseBaseDate,
};

/**
 * 經銷商(`dealers` → 甲類 | 乙類分頁;專案規格 5.2、5.4,正本 `docs/modules/project/dealers.md`)。
 *
 * - **範圍**:`lottery_dealers` 掛 `tenantScopePlugin`,讀寫都吃可見範圍(`orgId` = 建立者當時的組織)
 * - **讀取**:要綁 `dealers`;寫入另由 resolver 守 `dealers.create` / `dealers.edit`
 * - **欄位級權限**:兩個批購基準日的投影、寫入守門、稽核 `[redacted]`、keyword 不比對
 * - **主檔與關聯同一個交易**(`DealerLinksService.save`),批購日在同一個交易裡重算
 */
@Injectable()
export class LotteryDealersService {
  constructor(
    private readonly dealers: LotteryDealersRepository,
    private readonly signins: LotteryDealerSigninsRepository,
    private readonly links: DealerLinksService,
    private readonly view: DealerViewService,
    private readonly access: DealersAccess,
    private readonly purchaseDates: DealerPurchaseDates,
    private readonly audit: AuditService,
    private readonly transactions: TransactionService,
    private readonly realtime: RealtimePublisher,
  ) {}

  // ---- 讀 ----

  async list(
    operator: OperatorContext,
    input: LotteryDealersInput,
  ): Promise<LotteryDealersPayload> {
    const grant = await this.access.assertReadable(operator);
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const filter = await this.listFilterOf(operator, grant, input);
    const totalCount = await this.dealers.count(operator, filter);
    const records = await this.dealers.findMany(operator, filter, {
      sort: { licenseNo: 1, _id: 1 },
      skip: (page - 1) * pageSize,
      limit: pageSize,
    });
    return {
      items: await this.view.toModels(operator, grant, records),
      totalCount,
      page,
      pageSize,
    };
  }

  async findOne(
    operator: OperatorContext,
    id: string,
  ): Promise<LotteryDealerModel> {
    const grant = await this.access.assertReadable(operator);
    const record = await this.mustFind(operator, id);
    return this.toModel(operator, grant, record);
  }

  /** 乙類的共同銷售人(甲類,整個租戶;超過 6 位只警告)。 */
  async coSellers(
    operator: OperatorContext,
    id: string,
  ): Promise<LotteryDealerCoSellersPayload> {
    const grant = await this.access.assertReadable(operator);
    const record = await this.mustFind(operator, id);
    const rows = await this.links.coSellerRows(operator, grant.tenantId, [
      record._id,
    ]);
    const byId = await this.dealerRefs(
      operator,
      grant.tenantId,
      rows.map((row) => row.firstId),
    );
    const items = rows.flatMap((row) => {
      const dealer = byId.get(String(row.firstId));
      return dealer === undefined
        ? []
        : [{ dealer, registeredAt: row.createdAt }];
    });
    return { items, totalCount: items.length };
  }

  /** 已對應乙類的分店(整個租戶):對應分店的組織樹上停用並註明原因。 */
  async occupiedStores(
    operator: OperatorContext,
  ): Promise<LotteryOccupiedStoresPayload> {
    const grant = await this.access.assertReadable(operator);
    const rows = await this.links.occupiedStoreRows(operator, grant.tenantId);
    const byId = await this.dealerRefs(
      operator,
      grant.tenantId,
      rows.map((row) => row.secondId),
    );
    const items = rows.flatMap((row) => {
      const dealer = byId.get(String(row.secondId));
      return dealer === undefined
        ? []
        : [{ orgId: String(row.firstId), dealer }];
    });
    return { items, totalCount: items.length };
  }

  // ---- 寫 ----

  async create(
    operator: OperatorContext,
    input: CreateLotteryDealerInput,
  ): Promise<LotteryDealerModel> {
    const grant = await this.access.grantOf(operator);
    // 新增時 `null` 視同缺席(沒有東西可清):有值才要 `edit-` 權限
    for (const field of PROTECTED_FIELDS) {
      if (
        input[field] !== undefined &&
        input[field] !== null &&
        !grant.has(EDIT_PERMISSION_OF[field])
      ) {
        throw fieldForbiddenError(field);
      }
    }
    const values = validateDealerDraft(newDraft(input));
    const desired = desiredLinks(emptyLinks(), input);
    const shareOrgs = input.shareOrgs ?? [];
    if (shareOrgs.length > 0 && !grant.has(DEALERS_PERMISSIONS.edit)) {
      throw authError(
        "FORBIDDEN",
        `Missing permission ${DEALERS_PERMISSIONS.edit}`,
      );
    }
    const created = await this.transactions.withTransaction(async () => {
      await this.assertUnique(operator, grant, values, null);
      const record = await this.dealers.create(operator, {
        ...values,
        shareOrgs: normalizeShareOrgs(shareOrgs),
        lastPurchaseDate: null,
        lastSelfPurchaseDate: null,
      });
      await this.links.save(operator, record, emptyLinks(), desired, {
        releaseAgents: false,
        agentsGiven: input.agentIds !== undefined,
      });
      await this.purchaseDates.recomputeDealerPurchaseDates(
        null,
        record.tenantId,
        record._id,
        operator,
      );
      await this.audit.record(operator, {
        action: AUDIT_ACTIONS.dealerCreate,
        targetType: AUDIT_TARGETS.dealer,
        targetId: record._id,
        after: createdAudit(values),
      });
      return record;
    });
    await this.publishBadge(operator, created.tenantId);
    return this.toModel(
      operator,
      grant,
      await this.mustFind(operator, String(created._id)),
    );
  }

  async update(
    operator: OperatorContext,
    input: UpdateLotteryDealerInput,
  ): Promise<LotteryDealerModel> {
    const grant = await this.access.grantOf(operator);
    // 編輯時欄位一出現(含 `null` 清空)就要 `edit-` 權限
    for (const field of PROTECTED_FIELDS) {
      if (input[field] !== undefined && !grant.has(EDIT_PERMISSION_OF[field])) {
        throw fieldForbiddenError(field);
      }
    }
    const current = await this.mustFind(operator, input.id);
    // 共用進來的(歸屬組織不在可見範圍)只能看:寫入照可見範圍(ADR-0014)
    if (!isOrgVisible(operator, current.orgId)) {
      throw notFoundError(`dealer not found: ${input.id}`);
    }
    if (input.shareOrgs === null) {
      throw validationError("shareOrgs cannot be null", ["shareOrgs"]);
    }
    const before = draftOf(current);
    const values = validateDealerDraft(applyInput(before, input));
    const changes = changesOf(before, values);
    const linksById = await this.links.linksOf(operator, grant.tenantId, [
      current._id,
    ]);
    const currentLinks = linksById.get(String(current._id)) ?? emptyLinks();
    const desired = desiredLinks(currentLinks, input);

    await this.transactions.withTransaction(async () => {
      await this.assertUnique(operator, grant, values, before);
      if (Object.keys(changes.set).length > 0) {
        const updated = await this.dealers.updateById(operator, current._id, {
          $set: changes.set,
        });
        if (updated === null) {
          throw notFoundError(`dealer not found: ${input.id}`);
        }
      }
      const owner = {
        _id: current._id,
        orgId: current.orgId,
        tenantId: current.tenantId,
        type: current.type,
        nationalId: values.nationalId,
        name: values.name,
        licenseNo: values.licenseNo,
      };
      await this.links.save(operator, owner, currentLinks, desired, {
        releaseAgents: input.releaseAgents === true,
        agentsGiven: input.agentIds !== undefined,
      });
      if (PROTECTED_FIELDS.some((field) => field in changes.set)) {
        await this.purchaseDates.recomputeDealerPurchaseDates(
          null,
          current.tenantId,
          current._id,
          operator,
        );
      }
      if (input.shareOrgs !== undefined) {
        const shared = await this.dealers.updateById(operator, current._id, {
          $set: { shareOrgs: input.shareOrgs },
        });
        await this.audit.record(operator, {
          action: AUDIT_ACTIONS.dealerEdit,
          targetType: AUDIT_TARGETS.dealer,
          targetId: current._id,
          before: { shareOrgs: toShareOrgModels(current.shareOrgs) },
          after: { shareOrgs: toShareOrgModels(shared?.shareOrgs) },
        });
      }
      if (Object.keys(changes.set).length > 0) {
        await this.audit.record(operator, {
          action: AUDIT_ACTIONS.dealerEdit,
          targetType: AUDIT_TARGETS.dealer,
          targetId: current._id,
          before: changes.auditBefore,
          after: changes.auditAfter,
        });
      }
    });
    await this.publishBadge(operator, current.tenantId);
    return this.toModel(
      operator,
      grant,
      await this.mustFind(operator, input.id),
    );
  }

  // ---- 內部 ----

  async mustFind(operator: OperatorContext, id: string): Promise<DealerRecord> {
    const record = await this.dealers.findById(operator, toObjectId(id, "id"));
    if (record === null) {
      throw notFoundError(`dealer not found: ${id}`);
    }
    return record;
  }

  /** 被引用的經銷商(可能看不到)→ 參照;租戶內引用名稱出口。 */
  private async dealerRefs(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    ids: readonly Types.ObjectId[],
  ): Promise<Map<string, LotteryDealerRef>> {
    if (ids.length === 0) {
      return new Map();
    }
    let refs: LotteryDealerRef[];
    if (tenantId === null) {
      const found = await this.dealers.findMany(operator, {
        _id: { $in: [...ids] },
      });
      refs = found.map((dealer) => dealerRefOf(dealer));
    } else {
      const found = await this.dealers.findRefsInTenant(
        operator,
        tenantId,
        ids,
      );
      refs = found.map((ref) => dealerRefFrom(ref));
    }
    return new Map(refs.map((ref) => [ref.id, ref]));
  }

  private async toModel(
    operator: OperatorContext,
    grant: DealersGrant,
    record: DealerRecord,
  ): Promise<LotteryDealerModel> {
    const [model] = await this.view.toModels(operator, grant, [record]);
    if (model === undefined) {
      throw notFoundError(`dealer not found: ${String(record._id)}`);
    }
    return model;
  }

  /**
   * 證號、身分證字號在租戶內唯一(整個租戶,不限操作者看得到的;租戶邊界出口只回有無)。
   * 編輯時只查**變了的**那一欄(`before` = 改之前),命中的一定是別筆;根組織(沒有租戶)靠唯一索引守。
   */
  private async assertUnique(
    operator: OperatorContext,
    grant: DealersGrant,
    values: DealerValues,
    before: { licenseNo: string | null; nationalId: string | null } | null,
  ): Promise<void> {
    const tenantId = grant.tenantId;
    const taken = async (equals: Record<string, string>): Promise<boolean> =>
      tenantId !== null &&
      (await this.dealers.existsInTenant(operator, tenantId, equals));
    if (
      before?.licenseNo !== values.licenseNo &&
      (await taken({ licenseNo: values.licenseNo }))
    ) {
      throw validationError(
        "license number already exists",
        ["licenseNo"],
        DEALER_REASONS.licenseNoDuplicate,
      );
    }
    if (
      before?.nationalId !== values.nationalId &&
      (await taken({ nationalId: values.nationalId }))
    ) {
      throw validationError(
        "national id already exists",
        ["nationalId"],
        DEALER_REASONS.nationalIdDuplicate,
      );
    }
  }

  /**
   * 清單條件。**關鍵字不比對兩個批購基準日**(欄位級權限欄);比對證號、姓名、店名、身分證字號。
   * 「逾 N 天」= 最近一次批購日或本人批購日距今超過 N 天(兩個都無紀錄的不算)。
   */
  private async listFilterOf(
    operator: OperatorContext,
    grant: DealersGrant,
    input: LotteryDealersInput,
  ): Promise<Record<string, unknown>> {
    const and: Record<string, unknown>[] = [{ type: input.type }];
    const keyword = input.keyword?.trim();
    if (keyword) {
      const pattern = { $regex: escapeRegex(keyword), $options: "i" };
      and.push({
        $or: [
          { licenseNo: pattern },
          { name: pattern },
          { storeName: pattern },
          { nationalId: pattern },
        ],
      });
    }
    if (input.status) {
      and.push({ status: input.status });
    }
    if (input.selectable === true) {
      and.push({ status: { $ne: "terminated" } });
    }
    const thresholds = thresholdsOf(grant.today, grant.timezone);
    if (
      input.purchaseOverDays !== undefined &&
      input.purchaseOverDays !== null
    ) {
      const before = thresholds.purchaseBefore(input.purchaseOverDays);
      and.push({
        $or: [
          { lastPurchaseDate: { $lt: before } },
          { lastSelfPurchaseDate: { $lt: before } },
        ],
      });
    }
    if (input.licenseState) {
      const todayStart = new Date(startOfLocalDay(grant.today, grant.timezone));
      const ranges = {
        expired: { $lt: todayStart },
        expiring: { $gte: todayStart, $lt: thresholds.licenseBefore },
        ok: { $gte: thresholds.licenseBefore },
      };
      and.push({ licenseExpiresAt: ranges[input.licenseState] });
    }
    if (
      input.currentQuarterSigned !== undefined &&
      input.currentQuarterSigned !== null
    ) {
      const signed = await this.signins.findMany(operator, {
        year: grant.today.year,
        quarter: quarterOf(grant.today),
      });
      const ids = signed.map((row) => row.dealerId);
      and.push({
        _id: input.currentQuarterSigned ? { $in: ids } : { $nin: ids },
      });
    }
    return { $and: and };
  }

  /** 側欄計數可能變了:對操作者送 `badge:dealers`(其他人下次重抓;交易後送)。 */
  private async publishBadge(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
  ): Promise<void> {
    if (operator.actorId === null) {
      return;
    }
    await this.realtime.publishBadge(tenantId, DEALERS_KEY, [operator.actorId]);
  }
}
