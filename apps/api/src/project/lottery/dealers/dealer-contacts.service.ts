import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { AuditService } from "../../../audit/audit.service";
import type { OperatorContext } from "../../../database/operator-context";
import { TransactionService } from "../../../database/transaction";
import type {
  ContactRole,
  ContactStatus,
} from "../../database/lottery-dealers/lottery-dealer-contact.schema";
import {
  LotteryDealerContactsRepository,
  LotteryDealersRepository,
} from "../../database/lottery-dealers/lottery-dealers.repository";
import {
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  DEALERS_PERMISSIONS,
} from "./dealer-keys";
import {
  CONTACT_ROLES_IN_ORDER,
  DealerLinksService,
  toObjectId,
} from "./dealer-links.service";
import { type ContactRecord, dealerRefOf } from "./dealer-mapper";
import {
  FieldErrors,
  checkNationalId,
  checkOptionalText,
  checkRequiredText,
  normalizeNationalId,
  trimToNull,
} from "./dealer-validation";
import { DealerViewService } from "./dealer-view.service";
import {
  DealersAccess,
  type DealersGrant,
  tenantWideReader,
} from "./dealers-access";
import {
  DEALER_CONFLICT_REASONS,
  DEALER_REASONS,
  conflictError,
  notFoundError,
  validationError,
} from "./dealers-error";
import type {
  CreateLotteryDealerContactInput,
  LotteryDealerContactsInput,
  UpdateLotteryDealerContactInput,
} from "./dto/lottery-dealer-contact.input";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./dto/lottery-dealer.input";
import type {
  LotteryDealerContactModel,
  LotteryDealerContactsPayload,
} from "./models/lottery-dealer-contact.model";
import type {
  LotteryContactRoleEnum,
  LotteryContactStatusEnum,
} from "./models/lottery-dealer.model";

function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** 關係人落庫的值。 */
interface ContactValues {
  name: string;
  roles: ContactRole[];
  nationalId: string;
  birthday: Date | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  mailingAddress: string | null;
  residentialAddress: string | null;
  residentialSameAsMailing: boolean;
  status: ContactStatus;
  note: string | null;
}

const TEXT_FIELDS = [
  "name",
  "nationalId",
  "phone",
  "mobile",
  "email",
  "mailingAddress",
  "residentialAddress",
  "note",
] as const;

const REQUIRED_FIELDS = ["name", "roles", "nationalId", "status"] as const;

const VALUE_FIELDS = [
  ...TEXT_FIELDS,
  "roles",
  "birthday",
  "residentialSameAsMailing",
  "status",
] as const satisfies readonly (keyof ContactValues)[];

type ContactDraft = Omit<ContactValues, "name" | "nationalId"> & {
  name: string | null;
  nationalId: string | null;
};

function blankDraft(): ContactDraft {
  return {
    name: null,
    roles: [],
    nationalId: null,
    birthday: null,
    phone: null,
    mobile: null,
    email: null,
    mailingAddress: null,
    residentialAddress: null,
    residentialSameAsMailing: false,
    status: "active",
    note: null,
  };
}

function applyInput(
  base: ContactDraft,
  input: CreateLotteryDealerContactInput | UpdateLotteryDealerContactInput,
): ContactDraft {
  const next = { ...base } as unknown as Record<string, unknown>;
  const given = input as unknown as Record<string, unknown>;
  for (const field of VALUE_FIELDS) {
    const value = given[field];
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      if (!(REQUIRED_FIELDS as readonly string[]).includes(field)) {
        next[field] = field === "residentialSameAsMailing" ? false : null;
      }
      continue;
    }
    next[field] = normalizedValue(field, value);
  }
  return next as unknown as ContactDraft;
}

function normalizedValue(field: string, value: unknown): unknown {
  if ((TEXT_FIELDS as readonly string[]).includes(field)) {
    const text = trimToNull(value as string);
    return field === "nationalId" ? normalizeNationalId(text) : text;
  }
  if (field === "roles") {
    return CONTACT_ROLES_IN_ORDER.filter((role) =>
      (value as string[]).includes(role),
    );
  }
  return value;
}

function validate(draft: ContactDraft): ContactValues {
  const errors = new FieldErrors();
  checkRequiredText(errors, "name", draft.name);
  checkNationalId(errors, draft.nationalId);
  if (draft.roles.length === 0) {
    errors.add("roles");
  }
  checkOptionalText(errors, "phone", draft.phone, { digitsOnly: true });
  checkOptionalText(errors, "mobile", draft.mobile, { digitsOnly: true });
  checkOptionalText(errors, "email", draft.email, { email: true });
  checkOptionalText(errors, "mailingAddress", draft.mailingAddress);
  checkOptionalText(errors, "residentialAddress", draft.residentialAddress);
  checkOptionalText(errors, "note", draft.note);
  errors.throwIfAny("lottery dealer contact");
  return {
    ...draft,
    name: draft.name ?? "",
    nationalId: draft.nationalId ?? "",
    residentialAddress: draft.residentialSameAsMailing
      ? draft.mailingAddress
      : draft.residentialAddress,
  };
}

function auditValue(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.join(",") === right.join(",");
  }
  return left === right;
}

/**
 * 關係人(`dealers` → 關係人分頁;專案規格 5.3,正本 `docs/modules/project/dealers.md`)。
 *
 * - 讀取要綁 `dealers`(經銷商的表單與詳情也要列關係人);寫入由 resolver 守 `dealers.contacts.create` / `edit`
 * - 身分證字號租戶內唯一;沒有刪除:被關聯的只能停用,停用後既有關聯保留、不能再被選取
 * - 取消的身分還有關聯 → `CONFLICT`(列出關聯);重送 `releaseRelationships: true` 在同一個交易裡一併解除
 */
@Injectable()
export class DealerContactsService {
  constructor(
    private readonly contacts: LotteryDealerContactsRepository,
    private readonly dealers: LotteryDealersRepository,
    private readonly links: DealerLinksService,
    private readonly view: DealerViewService,
    private readonly access: DealersAccess,
    private readonly audit: AuditService,
    private readonly transactions: TransactionService,
  ) {}

  async list(
    operator: OperatorContext,
    input: LotteryDealerContactsInput,
  ): Promise<LotteryDealerContactsPayload> {
    const grant = await this.access.assertReadable(operator);
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const and: Record<string, unknown>[] = [];
    const keyword = input.keyword?.trim();
    if (keyword) {
      const pattern = { $regex: escapeRegex(keyword), $options: "i" };
      and.push({
        $or: [{ name: pattern }, { mobile: pattern }, { nationalId: pattern }],
      });
    }
    if (input.role) {
      and.push({ roles: input.role });
    }
    if (input.status) {
      and.push({ status: input.status });
    }
    const filter = and.length === 0 ? {} : { $and: and };
    const totalCount = await this.contacts.count(operator, filter);
    const records = await this.contacts.findMany(operator, filter, {
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
  ): Promise<LotteryDealerContactModel> {
    const grant = await this.access.assertReadable(operator);
    return this.toModel(operator, grant, await this.mustFind(operator, id));
  }

  async create(
    operator: OperatorContext,
    input: CreateLotteryDealerContactInput,
  ): Promise<LotteryDealerContactModel> {
    const grant = await this.access.grantOf(operator);
    const values = validate(applyInput(blankDraft(), input));
    const created = await this.transactions.withTransaction(async () => {
      await this.assertUnique(operator, grant, values.nationalId, null);
      const record = await this.contacts.create(operator, values);
      await this.audit.record(operator, {
        action: AUDIT_ACTIONS.contactCreate,
        targetType: AUDIT_TARGETS.contact,
        targetId: record._id,
        after: Object.fromEntries(
          VALUE_FIELDS.filter(
            (field) => values[field] !== null && values[field] !== false,
          ).map((field) => [field, auditValue(values[field])]),
        ),
      });
      return record;
    });
    return this.toModel(operator, grant, created);
  }

  async update(
    operator: OperatorContext,
    input: UpdateLotteryDealerContactInput,
  ): Promise<LotteryDealerContactModel> {
    const grant = await this.access.grantOf(operator);
    const current = await this.mustFind(operator, input.id);
    const before = applyInput(blankDraft(), {
      ...Object.fromEntries(
        VALUE_FIELDS.map((field) => [field, current[field]]),
      ),
    });
    const values = validate(applyInput(before, input));
    const removedRoles = before.roles.filter(
      (role) => !values.roles.includes(role),
    );
    const linked =
      removedRoles.length === 0
        ? []
        : await this.links.contactRows(operator, grant.tenantId, [current._id]);
    const inUse = linked.filter((row) =>
      removedRoles.includes(row.meta.role as ContactRole),
    );
    if (inUse.length > 0 && input.releaseRelationships !== true) {
      throw conflictError(
        "roles still in use",
        DEALER_CONFLICT_REASONS.roleInUse,
        await this.links.describe(operator, grant.tenantId, inUse),
      );
    }
    const set: Record<string, unknown> = {};
    const auditBefore: Record<string, unknown> = {};
    const auditAfter: Record<string, unknown> = {};
    for (const field of VALUE_FIELDS) {
      if (!sameValue(before[field], values[field])) {
        set[field] = values[field];
        auditBefore[field] = auditValue(before[field]);
        auditAfter[field] = auditValue(values[field]);
      }
    }
    await this.transactions.withTransaction(async () => {
      if (values.nationalId !== before.nationalId) {
        await this.assertUnique(
          operator,
          grant,
          values.nationalId,
          current._id,
        );
      }
      await this.links.releaseContactRoles(operator, inUse);
      if (Object.keys(set).length > 0) {
        await this.contacts.updateById(operator, current._id, { $set: set });
        await this.audit.record(operator, {
          action: AUDIT_ACTIONS.contactEdit,
          targetType: AUDIT_TARGETS.contact,
          targetId: current._id,
          before: auditBefore,
          after: auditAfter,
        });
      }
    });
    return this.toModel(
      operator,
      grant,
      await this.mustFind(operator, input.id),
    );
  }

  // ---- 內部 ----

  private async mustFind(
    operator: OperatorContext,
    id: string,
  ): Promise<ContactRecord> {
    const record = await this.contacts.findById(operator, toObjectId(id, "id"));
    if (record === null) {
      throw notFoundError(`contact not found: ${id}`);
    }
    return record;
  }

  private async assertUnique(
    operator: OperatorContext,
    grant: DealersGrant,
    nationalId: string,
    selfId: Types.ObjectId | null,
  ): Promise<void> {
    const count = await this.contacts.count(tenantWideReader(operator), {
      tenantId: grant.tenantId,
      nationalId,
      ...(selfId === null ? {} : { _id: { $ne: selfId } }),
    });
    if (count > 0) {
      throw validationError(
        "national id already exists",
        ["nationalId"],
        DEALER_REASONS.nationalIdDuplicate,
      );
    }
  }

  private async toModel(
    operator: OperatorContext,
    grant: DealersGrant,
    record: ContactRecord,
  ): Promise<LotteryDealerContactModel> {
    const [model] = await this.toModels(operator, grant, [record]);
    if (model === undefined) {
      throw notFoundError(`contact not found: ${String(record._id)}`);
    }
    return model;
  }

  /** 關聯經銷商以租戶為邊界讀(看得到關係人就看得到他掛在哪些經銷商)。 */
  private async toModels(
    operator: OperatorContext,
    grant: DealersGrant,
    records: readonly ContactRecord[],
  ): Promise<LotteryDealerContactModel[]> {
    const rows =
      records.length === 0
        ? []
        : await this.links.contactRows(
            operator,
            grant.tenantId,
            records.map((record) => record._id),
          );
    const dealers =
      rows.length === 0
        ? []
        : await this.dealers.findMany(tenantWideReader(operator), {
            tenantId: grant.tenantId,
            _id: { $in: rows.map((row) => row.firstId) },
          });
    const dealerOf = new Map(
      dealers.map((dealer) => [String(dealer._id), dealer]),
    );
    const users = await this.view.userNames(
      operator,
      records.map((record) => record.createdBy),
    );
    const canEdit = grant.has(DEALERS_PERMISSIONS.contactsEdit);
    return records.map((record) => {
      const links = rows
        .filter((row) => row.secondId.equals(record._id))
        .flatMap((row) => {
          const dealer = dealerOf.get(String(row.firstId));
          return dealer === undefined
            ? []
            : [
                {
                  dealer: dealerRefOf(dealer),
                  role: row.meta.role as LotteryContactRoleEnum,
                },
              ];
        });
      return {
        id: String(record._id),
        name: record.name,
        roles: record.roles as LotteryContactRoleEnum[],
        nationalId: record.nationalId,
        birthday: record.birthday,
        phone: record.phone,
        mobile: record.mobile,
        email: record.email,
        mailingAddress: record.mailingAddress,
        residentialAddress: record.residentialAddress,
        residentialSameAsMailing: record.residentialSameAsMailing,
        status: record.status as LotteryContactStatusEnum,
        note: record.note,
        dealerCount: new Set(links.map((link) => link.dealer.id)).size,
        links,
        createdBy:
          record.createdBy === null
            ? null
            : {
                id: String(record.createdBy),
                name: users.get(String(record.createdBy)) ?? "",
              },
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        abilities: { canEdit },
      };
    });
  }
}
