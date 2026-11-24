import { Injectable } from "@nestjs/common";

import {
  WHOLESALE_CUSTOMER_TEXT_LIMITS,
  wholesaleCustomerLabel,
} from "@repo/domain/project/lottery";

import { AuditService } from "../../../audit/audit.service";
import { authError } from "../../../auth/auth-error";
import type { Persisted } from "../../../database/base.repository";
import { OrgsRepository } from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { normalizeShareOrgs } from "../../../database/share-orgs";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { TransactionService } from "../../../database/transaction";
import { toShareOrgModels } from "../../../sharing/share-org.model";
import {
  type LotteryWholesaleCustomerDocument,
  LotteryWholesaleCustomersRepository,
} from "../../database/lottery-dealers/lottery-dealers.repository";
import type { WholesaleCustomerStatus } from "../../database/lottery-dealers/lottery-wholesale-customer.schema";
import {
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  DEALERS_PERMISSIONS,
  DEALERS_WHOLESALE_CUSTOMERS_KEY,
} from "./dealer-keys";
import { toObjectId } from "./dealer-links.service";
import { userRefOf } from "./dealer-mapper";
import {
  FieldErrors,
  LICENSE_NO_PATTERN,
  trimToNull,
} from "./dealer-validation";
import { DealerViewService } from "./dealer-view.service";
import { DealersAccess, type DealersGrant } from "./dealers-access";
import {
  DEALER_REASONS,
  notFoundError,
  validationError,
} from "./dealers-error";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./dto/lottery-dealer.input";
import type {
  CreateLotteryWholesaleCustomerInput,
  LotteryWholesaleCustomerSameNamesInput,
  LotteryWholesaleCustomersInput,
  UpdateLotteryWholesaleCustomerInput,
} from "./dto/lottery-wholesale-customer.input";
import type {
  LotteryWholesaleCustomerModel,
  LotteryWholesaleCustomerSameNamesPayload,
  LotteryWholesaleCustomerStatusEnum,
  LotteryWholesaleCustomersPayload,
} from "./models/lottery-wholesale-customer.model";
import { WholesaleCustomerDocuments } from "./wholesale-customer-documents";

type WholesaleCustomerRecord = Persisted<LotteryWholesaleCustomerDocument>;

function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** 批售客戶落庫的值(不含 `label`:由店名、電話算)。 */
interface WholesaleCustomerValues {
  storeName: string;
  licenseNo: string | null;
  contactName: string | null;
  phone: string | null;
  address: string | null;
  status: WholesaleCustomerStatus;
  note: string | null;
}

type WholesaleCustomerDraft = Omit<WholesaleCustomerValues, "storeName"> & {
  storeName: string | null;
};

const TEXT_FIELDS = [
  "storeName",
  "licenseNo",
  "contactName",
  "phone",
  "address",
  "note",
] as const;

const VALUE_FIELDS = [
  ...TEXT_FIELDS,
  "status",
] as const satisfies readonly (keyof WholesaleCustomerValues)[];

const BLANK_DRAFT: WholesaleCustomerDraft = {
  storeName: null,
  licenseNo: null,
  contactName: null,
  phone: null,
  address: null,
  status: "active",
  note: null,
};

function draftOf(record: WholesaleCustomerRecord): WholesaleCustomerDraft {
  return {
    storeName: record.storeName,
    licenseNo: record.licenseNo,
    contactName: record.contactName,
    phone: record.phone,
    address: record.address,
    status: record.status,
    note: record.note,
  };
}

/** 缺席 = 不動、`null` = 清空;店名、狀態是必填,`null` 視同缺席。 */
function applyInput(
  base: WholesaleCustomerDraft,
  input:
    CreateLotteryWholesaleCustomerInput | UpdateLotteryWholesaleCustomerInput,
): WholesaleCustomerDraft {
  const next = { ...base };
  for (const field of TEXT_FIELDS) {
    const value = input[field];
    if (value !== undefined && !(value === null && field === "storeName")) {
      next[field] = trimToNull(value);
    }
  }
  if (input.status) {
    next.status = input.status;
  }
  return next;
}

function validate(draft: WholesaleCustomerDraft): WholesaleCustomerValues {
  const errors = new FieldErrors();
  const { storeName } = draft;
  if (storeName === null) {
    errors.add("storeName");
  }
  if (draft.licenseNo !== null && !LICENSE_NO_PATTERN.test(draft.licenseNo)) {
    errors.add("licenseNo");
  }
  for (const [field, limit] of Object.entries(WHOLESALE_CUSTOMER_TEXT_LIMITS)) {
    const value = draft[field as keyof typeof WHOLESALE_CUSTOMER_TEXT_LIMITS];
    if (value !== null && value.length > limit) {
      errors.add(field);
    }
  }
  if (draft.phone !== null && !/^\d+$/.test(draft.phone)) {
    errors.add("phone");
  }
  errors.throwIfAny("lottery wholesale customer");
  return { ...draft, storeName: storeName ?? "" };
}

/**
 * 批售客戶(`dealers` → 批售客戶分頁;專案規格 21.2,正本 `docs/modules/project/dealers.md`)。
 *
 * - 讀取要綁 `dealers.wholesale-customers`(分頁的進入條件);寫入由 resolver 守 `create` / `edit`
 * - 店名可以重複(同名只提醒、不擋);證號有填才要租戶內唯一
 * - 被任何批售單(含草稿)引用的不能刪除,只能停用(引用由批售單登記到 `WholesaleCustomerDocuments`)
 */
@Injectable()
export class WholesaleCustomersService {
  constructor(
    private readonly customers: LotteryWholesaleCustomersRepository,
    private readonly orgs: OrgsRepository,
    private readonly documents: WholesaleCustomerDocuments,
    private readonly view: DealerViewService,
    private readonly access: DealersAccess,
    private readonly audit: AuditService,
    private readonly transactions: TransactionService,
  ) {}

  async list(
    operator: OperatorContext,
    input: LotteryWholesaleCustomersInput,
  ): Promise<LotteryWholesaleCustomersPayload> {
    const grant = await this.access.assertReadable(
      operator,
      DEALERS_WHOLESALE_CUSTOMERS_KEY,
    );
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const filter: Record<string, unknown> = {};
    const keyword = input.keyword?.trim();
    if (keyword) {
      const pattern = { $regex: escapeRegex(keyword), $options: "i" };
      filter.$or = [
        { storeName: pattern },
        { licenseNo: pattern },
        { contactName: pattern },
        { phone: pattern },
      ];
    }
    if (input.status) {
      filter.status = input.status;
    }
    const totalCount = await this.customers.count(operator, filter);
    const records = await this.customers.findMany(operator, filter, {
      sort: { createdAt: -1, _id: -1 },
      skip: (page - 1) * pageSize,
      limit: pageSize,
    });
    return {
      items: await this.toModels(operator, grant, records),
      totalCount,
      page,
      pageSize,
    };
  }

  async findOne(
    operator: OperatorContext,
    id: string,
  ): Promise<LotteryWholesaleCustomerModel> {
    const grant = await this.access.assertReadable(
      operator,
      DEALERS_WHOLESALE_CUSTOMERS_KEY,
    );
    return this.toModel(operator, grant, await this.mustFind(operator, id));
  }

  /**
   * 同名提醒:整個租戶(含操作者看不到的)店名相同、還沒刪除的客戶,只回店名與電話。
   * 給新增 / 編輯頁用,要有 `create` 或 `edit`。
   */
  async sameNames(
    operator: OperatorContext,
    input: LotteryWholesaleCustomerSameNamesInput,
  ): Promise<LotteryWholesaleCustomerSameNamesPayload> {
    const grant = await this.access.assertReadable(
      operator,
      DEALERS_WHOLESALE_CUSTOMERS_KEY,
    );
    if (
      !grant.has(DEALERS_PERMISSIONS.wholesaleCustomersCreate) &&
      !grant.has(DEALERS_PERMISSIONS.wholesaleCustomersEdit)
    ) {
      throw authError(
        "FORBIDDEN",
        `Missing permission ${DEALERS_PERMISSIONS.wholesaleCustomersCreate}`,
      );
    }
    const storeName = trimToNull(input.storeName);
    if (storeName === null) {
      return { items: [], totalCount: 0 };
    }
    const found = await this.customers.findMany(
      await tenantBoundaryContext(this.orgs, operator, grant.tenantId),
      {
        storeName,
        ...(input.excludeId
          ? { _id: { $ne: toObjectId(input.excludeId, "excludeId") } }
          : {}),
      },
      { sort: { createdAt: 1, _id: 1 } },
    );
    const items = found.map((record) => ({
      id: String(record._id),
      storeName: record.storeName,
      phone: record.phone,
    }));
    return { items, totalCount: items.length };
  }

  async create(
    operator: OperatorContext,
    input: CreateLotteryWholesaleCustomerInput,
  ): Promise<LotteryWholesaleCustomerModel> {
    const grant = await this.access.grantOf(operator);
    const values = validate(applyInput(BLANK_DRAFT, input));
    const shareOrgs = input.shareOrgs ?? [];
    if (
      shareOrgs.length > 0 &&
      !grant.has(DEALERS_PERMISSIONS.wholesaleCustomersEdit)
    ) {
      throw authError(
        "FORBIDDEN",
        `Missing permission ${DEALERS_PERMISSIONS.wholesaleCustomersEdit}`,
      );
    }
    const created = await this.transactions.withTransaction(async () => {
      await this.assertLicenseUnique(operator, grant, values.licenseNo);
      const record = await this.customers.create(operator, {
        ...values,
        label: wholesaleCustomerLabel(values),
        shareOrgs: normalizeShareOrgs(shareOrgs),
      });
      await this.audit.record(operator, {
        action: AUDIT_ACTIONS.wholesaleCustomerCreate,
        targetType: AUDIT_TARGETS.wholesaleCustomer,
        targetId: record._id,
        after: {
          ...Object.fromEntries(
            VALUE_FIELDS.filter((field) => values[field] !== null).map(
              (field) => [field, values[field]],
            ),
          ),
          ...(shareOrgs.length > 0
            ? { shareOrgs: toShareOrgModels(record.shareOrgs) }
            : {}),
        },
      });
      return record;
    });
    return this.toModel(operator, grant, created);
  }

  async update(
    operator: OperatorContext,
    input: UpdateLotteryWholesaleCustomerInput,
  ): Promise<LotteryWholesaleCustomerModel> {
    const grant = await this.access.grantOf(operator);
    const current = await this.mustFindOwn(operator, input.id);
    if (input.shareOrgs === null) {
      throw validationError("shareOrgs cannot be null", ["shareOrgs"]);
    }
    const before = draftOf(current);
    const values = validate(applyInput(before, input));
    const changed = VALUE_FIELDS.filter(
      (field) => before[field] !== values[field],
    );
    const pick = (source: WholesaleCustomerDraft) =>
      Object.fromEntries(changed.map((field) => [field, source[field]]));
    const set: Record<string, unknown> = {
      ...pick(values),
      ...(changed.length > 0 ? { label: wholesaleCustomerLabel(values) } : {}),
      ...(input.shareOrgs === undefined ? {} : { shareOrgs: input.shareOrgs }),
    };
    if (Object.keys(set).length > 0) {
      await this.transactions.withTransaction(async () => {
        if (changed.includes("licenseNo")) {
          await this.assertLicenseUnique(operator, grant, values.licenseNo);
        }
        const updated = await this.customers.updateById(operator, current._id, {
          $set: set,
        });
        if (updated === null) {
          throw notFoundError(`wholesale customer not found: ${input.id}`);
        }
        const isShareGiven = input.shareOrgs !== undefined;
        await this.audit.record(operator, {
          action: AUDIT_ACTIONS.wholesaleCustomerEdit,
          targetType: AUDIT_TARGETS.wholesaleCustomer,
          targetId: current._id,
          before: {
            ...pick(before),
            ...(isShareGiven
              ? { shareOrgs: toShareOrgModels(current.shareOrgs) }
              : {}),
          },
          after: {
            ...pick(values),
            ...(isShareGiven
              ? { shareOrgs: toShareOrgModels(updated.shareOrgs) }
              : {}),
          },
        });
      });
    }
    return this.toModel(
      operator,
      grant,
      await this.mustFind(operator, input.id),
    );
  }

  async delete(operator: OperatorContext, id: string): Promise<string> {
    const current = await this.mustFindOwn(operator, id);
    await this.transactions.withTransaction(async () => {
      if (
        await this.documents.isReferenced(
          operator,
          current.tenantId,
          current._id,
        )
      ) {
        throw validationError(
          "wholesale customer is used by wholesale documents: deactivate it instead",
          ["id"],
          DEALER_REASONS.wholesaleCustomerInUse,
        );
      }
      const deleted = await this.customers.softDeleteById(
        operator,
        current._id,
      );
      if (!deleted) {
        throw notFoundError(`wholesale customer not found: ${id}`);
      }
      await this.audit.record(operator, {
        action: AUDIT_ACTIONS.wholesaleCustomerDelete,
        targetType: AUDIT_TARGETS.wholesaleCustomer,
        targetId: current._id,
        before: { ...draftOf(current) },
      });
    });
    return String(current._id);
  }

  // ---- 內部 ----

  private async mustFind(
    operator: OperatorContext,
    id: string,
  ): Promise<WholesaleCustomerRecord> {
    const record = await this.customers.findById(
      operator,
      toObjectId(id, "id"),
    );
    if (record === null) {
      throw notFoundError(`wholesale customer not found: ${id}`);
    }
    return record;
  }

  /** 要改的客戶:看得到,且歸屬組織在可見範圍內(共用進來的只能看 → `NOT_FOUND`,ADR-0014)。 */
  private async mustFindOwn(
    operator: OperatorContext,
    id: string,
  ): Promise<WholesaleCustomerRecord> {
    const record = await this.mustFind(operator, id);
    if (!isOrgVisible(operator, record.orgId)) {
      throw notFoundError(`wholesale customer not found: ${id}`);
    }
    return record;
  }

  /** 證號有填時整個租戶唯一(含操作者看不到的;租戶邊界出口只回有無)。編輯只在證號變了才查。 */
  private async assertLicenseUnique(
    operator: OperatorContext,
    grant: DealersGrant,
    licenseNo: string | null,
  ): Promise<void> {
    if (licenseNo === null || grant.tenantId === null) {
      return;
    }
    if (
      await this.customers.existsInTenant(operator, grant.tenantId, {
        licenseNo,
      })
    ) {
      throw validationError(
        "license number already exists",
        ["licenseNo"],
        DEALER_REASONS.wholesaleLicenseNoDuplicate,
      );
    }
  }

  private async toModel(
    operator: OperatorContext,
    grant: DealersGrant,
    record: WholesaleCustomerRecord,
  ): Promise<LotteryWholesaleCustomerModel> {
    const [model] = await this.toModels(operator, grant, [record]);
    if (model === undefined) {
      throw notFoundError(
        `wholesale customer not found: ${String(record._id)}`,
      );
    }
    return model;
  }

  private async toModels(
    operator: OperatorContext,
    grant: DealersGrant,
    records: readonly WholesaleCustomerRecord[],
  ): Promise<LotteryWholesaleCustomerModel[]> {
    const users = await this.view.userNames(
      operator,
      records.flatMap((record) => [record.createdBy, record.updatedBy]),
    );
    const orgNames = await this.view.orgNames(
      operator,
      grant.tenantId,
      records.map((record) => record.orgId),
    );
    const lastShippedAt = await this.documents.lastShippedAt(
      operator,
      grant.tenantId,
      records.map((record) => record._id),
    );
    const mayEdit = grant.has(DEALERS_PERMISSIONS.wholesaleCustomersEdit);
    return records.map((record) => {
      const isOwned = isOrgVisible(operator, record.orgId);
      return {
        id: String(record._id),
        storeName: record.storeName,
        licenseNo: record.licenseNo,
        contactName: record.contactName,
        phone: record.phone,
        address: record.address,
        status: record.status as LotteryWholesaleCustomerStatusEnum,
        note: record.note,
        lastWholesaleAt: lastShippedAt.get(String(record._id)) ?? null,
        createdBy: userRefOf(record.createdBy, users),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        updatedBy: userRefOf(record.updatedBy, users),
        ownerOrgName: orgNames.get(String(record.orgId)) ?? null,
        shareOrgs: toShareOrgModels(record.shareOrgs),
        isShared: !isOwned,
        abilities: { canEdit: isOwned && mayEdit },
      };
    });
  }
}
