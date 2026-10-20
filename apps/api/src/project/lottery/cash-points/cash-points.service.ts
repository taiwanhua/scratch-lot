import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  MASTER_DATA_MODULE_KEYS,
  MASTER_DATA_PERMISSIONS,
} from "@repo/domain/project/lottery-master-data";

import { AuditService } from "../../../audit/audit.service";
import type { Persisted } from "../../../database/base.repository";
import {
  FieldCategoriesRepository,
  FieldsRepository,
  type OrgDocument,
  OrgsRepository,
  PrintersRepository,
} from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import {
  type LotteryCashPointDocument,
  LotteryCashPointsRepository,
} from "../../database/lottery-cash-points/lottery-cash-points.repository";
import { isSameValue } from "../games/game-changes";
import { GameFieldErrors, checkNote } from "../games/game-validation";
import { MasterDataAccess, type MasterDataGrant } from "../master-data-access";
import {
  MASTER_DATA_REASONS,
  notFoundError,
  validationError,
} from "../master-data-error";
import { tenantReadContext } from "../master-data-tenant";
import {
  cashPointSnapshotOf,
  checkCashPointName,
  checkCashPointOrder,
  requestedCashPointValues,
} from "./cash-point-changes";
import { isCashPointDeactivationBlocked } from "./cash-point-deactivation";
import type {
  CreateLotteryCashPointInput,
  LotteryCashPointsInput,
  UpdateLotteryCashPointInput,
} from "./dto/lottery-cash-point.input";
import type {
  LotteryCashPointModel,
  LotteryCashPointsPayload,
  LotteryPositionOptionsPayload,
} from "./models/lottery-cash-point.model";
import { type PositionOption, positionOptionsOf } from "./position-options";

type CashPointRecord = Persisted<LotteryCashPointDocument>;
type OrgRecord = Persisted<OrgDocument>;

const AUDIT_TARGET_TYPE = "lottery_cash_point";
const AUDIT = {
  create: "lottery-cash-point.create",
  edit: "lottery-cash-point.edit",
} as const;

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** MongoDB 唯一索引衝突(兩個請求同時送出同崗位 / 同名)。 */
const DUPLICATE_KEY_ERROR = 11_000;

function duplicateKeyField(error: unknown): string | null {
  if (
    typeof error !== "object" ||
    error === null ||
    (error as { code?: unknown }).code !== DUPLICATE_KEY_ERROR
  ) {
    return null;
  }
  const pattern = (error as { keyPattern?: Record<string, unknown> })
    .keyPattern;
  return pattern && "positionKey" in pattern ? "positionKey" : "name";
}

function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function parseId(value: string): Types.ObjectId | null {
  return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;
}

/**
 * 收銀點(`master-data` → 收銀點分頁;專案規格 5.5,正本 `docs/modules/project/master-data.md`)。
 *
 * - **範圍**:操作者的可見範圍(收銀點掛在分店上);讀取要綁 `master-data.cash-points`
 * - **不能刪除**(沒有刪除端點),只能停用;停用前問停用守門(`cash-point-deactivation.ts`,P21 登記)
 * - 崗位、名稱在同一家分店內不重複;崗位要是這家分店看得到的啟用選項
 */
@Injectable()
export class LotteryCashPointsService {
  constructor(
    private readonly cashPoints: LotteryCashPointsRepository,
    private readonly orgs: OrgsRepository,
    private readonly categories: FieldCategoriesRepository,
    private readonly fields: FieldsRepository,
    private readonly printers: PrintersRepository,
    private readonly access: MasterDataAccess,
    private readonly audit: AuditService,
  ) {}

  // ---- 讀 ----

  async list(
    operator: OperatorContext,
    input: LotteryCashPointsInput,
  ): Promise<LotteryCashPointsPayload> {
    const grant = await this.access.assertModule(
      operator,
      MASTER_DATA_MODULE_KEYS.cashPoints,
    );
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const orgId = input.orgId ? parseId(input.orgId) : undefined;
    if (orgId === null) {
      return { items: [], totalCount: 0, page, pageSize };
    }
    const keyword = input.keyword?.trim();
    const filter = {
      ...(orgId === undefined ? {} : { orgId }),
      ...(input.enabled === undefined || input.enabled === null
        ? {}
        : { enabled: input.enabled }),
      ...(keyword
        ? { name: { $regex: escapeRegex(keyword), $options: "i" } }
        : {}),
    };
    const totalCount = await this.cashPoints.count(operator, filter);
    const documents = await this.cashPoints.findMany(operator, filter, {
      sort: { orgId: 1, order: 1, createdAt: 1, _id: 1 },
      skip: (page - 1) * pageSize,
      limit: pageSize,
    });
    return {
      items: await this.decorate(operator, documents, grant),
      totalCount,
      page,
      pageSize,
    };
  }

  /** 崗位選單:這家分店看得到的啟用崗位(要綁收銀點分頁;分店不在可見範圍 → 空清單)。 */
  async positionOptions(
    operator: OperatorContext,
    orgIdText: string,
  ): Promise<LotteryPositionOptionsPayload> {
    await this.access.assertModule(
      operator,
      MASTER_DATA_MODULE_KEYS.cashPoints,
    );
    const org = await this.visibleOrg(operator, orgIdText);
    const items =
      org === null
        ? []
        : await positionOptionsOf(operator, org, {
            categories: this.categories,
            fields: this.fields,
          });
    return { items, totalCount: items.length };
  }

  // ---- 寫 ----

  async create(
    operator: OperatorContext,
    input: CreateLotteryCashPointInput,
  ): Promise<LotteryCashPointModel> {
    const errors = new GameFieldErrors();
    const org = await this.visibleOrg(operator, input.orgId);
    if (org === null) {
      errors.add("orgId");
    }
    const name = checkCashPointName(input.name, errors);
    const note = checkNote(input.note ?? null, errors);
    const order = checkCashPointOrder(input.order ?? 0, errors);
    const positionKey =
      org === null
        ? null
        : await this.checkPosition(operator, org, input.positionKey, errors);
    const printerId =
      org === null
        ? null
        : await this.checkPrinter(
            operator,
            org,
            input.printerId ?? null,
            errors,
          );
    if (errors.fields.length > 0 || org === null || name === null) {
      throw validationError(
        "lottery cash point input is invalid",
        errors.fields,
      );
    }
    await this.assertUnique(operator, org._id, { positionKey, name }, null);
    const data = {
      positionKey: positionKey ?? "",
      name,
      order,
      enabled: true,
      printerId,
      note,
    };
    const created = await this.saving(() =>
      this.cashPoints.create(operator, { ...data, orgId: org._id }),
    );
    await this.audit.record(operator, {
      action: AUDIT.create,
      targetType: AUDIT_TARGET_TYPE,
      targetId: created._id,
      after: { ...data, orgId: org._id },
    });
    return this.decorateOne(operator, created);
  }

  async update(
    operator: OperatorContext,
    input: UpdateLotteryCashPointInput,
  ): Promise<LotteryCashPointModel> {
    const current = await this.mustFind(operator, input.id);
    const org = await this.visibleOrg(operator, String(current.orgId));
    if (org === null) {
      throw notFoundError(`lottery cash point not found: ${input.id}`);
    }
    const errors = new GameFieldErrors();
    const next = requestedCashPointValues(input, errors);
    if (input.positionKey != null) {
      next.positionKey =
        input.positionKey === current.positionKey
          ? current.positionKey
          : await this.checkPosition(operator, org, input.positionKey, errors);
    }
    if (input.printerId !== undefined) {
      next.printerId = await this.checkPrinter(
        operator,
        org,
        input.printerId,
        errors,
      );
    }
    if (errors.fields.length > 0) {
      throw validationError(
        "lottery cash point input is invalid",
        errors.fields,
      );
    }
    const snapshot = cashPointSnapshotOf(current);
    const changed = Object.keys(next).filter(
      (key) => !isSameValue(next[key], snapshot[key]),
    );
    if (changed.length === 0) {
      return this.decorateOne(operator, current);
    }
    if (
      changed.includes("enabled") &&
      next.enabled === false &&
      (await isCashPointDeactivationBlocked(current.tenantId, current._id))
    ) {
      throw validationError(
        "lottery cash point has an open shift or tickets on the counter",
        ["enabled"],
        MASTER_DATA_REASONS.cashPointInUse,
      );
    }
    await this.assertUnique(
      operator,
      current.orgId,
      {
        positionKey: changed.includes("positionKey")
          ? (next.positionKey as string)
          : null,
        name: changed.includes("name") ? (next.name as string) : null,
      },
      current._id,
    );
    const set: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    for (const key of changed) {
      set[key] = next[key];
      before[key] = snapshot[key] ?? null;
    }
    const updated = await this.saving(() =>
      this.cashPoints.updateById(operator, current._id, { $set: set }),
    );
    if (!updated) {
      throw notFoundError(`lottery cash point not found: ${input.id}`);
    }
    await this.audit.record(operator, {
      action: AUDIT.edit,
      targetType: AUDIT_TARGET_TYPE,
      targetId: updated._id,
      before,
      after: set,
    });
    return this.decorateOne(operator, updated);
  }

  // ---- 驗證 ----

  private async checkPosition(
    operator: OperatorContext,
    org: OrgRecord,
    value: string,
    errors: GameFieldErrors,
  ): Promise<string | null> {
    const options = await positionOptionsOf(operator, org, {
      categories: this.categories,
      fields: this.fields,
    });
    return options.some((option) => option.value === value)
      ? value
      : errors.add("positionKey");
  }

  /** 印表機:同分店、啟用中的底座印表機;null = 用分店預設。 */
  private async checkPrinter(
    operator: OperatorContext,
    org: OrgRecord,
    value: string | null,
    errors: GameFieldErrors,
  ): Promise<Types.ObjectId | null> {
    if (value === null) {
      return null;
    }
    const printerId = parseId(value);
    const printer =
      printerId === null
        ? null
        : await this.printers.findOne(operator, {
            _id: printerId,
            orgId: org._id,
            enabled: true,
          });
    return printer ? printer._id : errors.add("printerId");
  }

  /** 同一家分店內崗位、名稱不重複(給 null 的那一項不查)。 */
  private async assertUnique(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    values: { positionKey: string | null; name: string | null },
    selfId: Types.ObjectId | null,
  ): Promise<void> {
    const others = selfId === null ? {} : { _id: { $ne: selfId } };
    const reader = tenantReadContext(operator);
    const fields: string[] = [];
    let reason: string | undefined;
    if (
      values.positionKey !== null &&
      (await this.cashPoints.findOne(reader, {
        orgId,
        positionKey: values.positionKey,
        ...others,
      }))
    ) {
      fields.push("positionKey");
      reason = MASTER_DATA_REASONS.positionDuplicate;
    }
    if (
      values.name !== null &&
      (await this.cashPoints.findOne(reader, {
        orgId,
        name: values.name,
        ...others,
      }))
    ) {
      fields.push("name");
      reason ??= MASTER_DATA_REASONS.nameDuplicate;
    }
    if (fields.length > 0) {
      throw validationError(
        `lottery cash point duplicated in the same branch: ${fields.join(", ")}`,
        fields,
        reason as (typeof MASTER_DATA_REASONS)[keyof typeof MASTER_DATA_REASONS],
      );
    }
  }

  /** 寫入撞到唯一索引(同時送出)時,與事前檢查回同一個錯誤。 */
  private async saving<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      const field = duplicateKeyField(error);
      if (field === null) {
        throw error;
      }
      throw validationError(
        `lottery cash point duplicated in the same branch: ${field}`,
        [field],
        field === "positionKey"
          ? MASTER_DATA_REASONS.positionDuplicate
          : MASTER_DATA_REASONS.nameDuplicate,
      );
    }
  }

  // ---- 內部 ----

  private async visibleOrg(
    operator: OperatorContext,
    orgIdText: string,
  ): Promise<OrgRecord | null> {
    const orgId = parseId(orgIdText);
    if (orgId === null || !isOrgVisible(operator, orgId)) {
      return null;
    }
    return this.orgs.findById(tenantReadContext(operator), orgId);
  }

  private async mustFind(
    operator: OperatorContext,
    id: string,
  ): Promise<CashPointRecord> {
    const cashPointId = parseId(id);
    const found =
      cashPointId === null
        ? null
        : await this.cashPoints.findById(operator, cashPointId);
    if (!found) {
      throw notFoundError(`lottery cash point not found: ${id}`);
    }
    return found;
  }

  private async decorateOne(
    operator: OperatorContext,
    document: CashPointRecord,
  ): Promise<LotteryCashPointModel> {
    const grant = await this.access.grantOf(operator);
    const [model] = await this.decorate(operator, [document], grant);
    if (!model) {
      throw notFoundError(
        `lottery cash point not found: ${String(document._id)}`,
      );
    }
    return model;
  }

  /** 一次查完分店名稱、印表機名稱、崗位顯示名(清單不逐列查)。 */
  private async decorate(
    operator: OperatorContext,
    documents: CashPointRecord[],
    grant: MasterDataGrant,
  ): Promise<LotteryCashPointModel[]> {
    const reader = tenantReadContext(operator);
    const orgIds = [...new Set(documents.map((doc) => String(doc.orgId)))];
    const orgs = await this.orgs.findMany(reader, {
      _id: { $in: orgIds.map((id) => new Types.ObjectId(id)) },
    });
    const printerIds = documents.flatMap((doc) =>
      doc.printerId === null ? [] : [doc.printerId],
    );
    const printers =
      printerIds.length === 0
        ? []
        : await this.printers.findMany(reader, { _id: { $in: printerIds } });
    const orgById = new Map(orgs.map((org) => [String(org._id), org]));
    const printerName = new Map(
      printers.map((printer) => [String(printer._id), printer.name]),
    );
    const labelsByOrg = new Map<string, PositionOption[]>();
    for (const org of orgs) {
      labelsByOrg.set(
        String(org._id),
        await positionOptionsOf(operator, org, {
          categories: this.categories,
          fields: this.fields,
        }),
      );
    }
    const canEdit = grant.has(MASTER_DATA_PERMISSIONS.cashPointsEdit);
    return documents.map((doc) => {
      const orgKey = String(doc.orgId);
      const printerKey = doc.printerId === null ? null : String(doc.printerId);
      const printer =
        printerKey === null ? undefined : printerName.get(printerKey);
      return {
        id: String(doc._id),
        org: { id: orgKey, name: orgById.get(orgKey)?.name ?? "" },
        positionKey: doc.positionKey,
        positionLabel:
          labelsByOrg
            .get(orgKey)
            ?.find((option) => option.value === doc.positionKey)?.label ?? null,
        name: doc.name,
        order: doc.order,
        enabled: doc.enabled,
        printer:
          printerKey === null || printer === undefined
            ? null
            : { id: printerKey, name: printer },
        note: doc.note ?? null,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        abilities: { canEdit },
      };
    });
  }
}
