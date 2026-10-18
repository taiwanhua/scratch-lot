import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { AuditService } from "../audit/audit.service";
import {
  AuditLogsRepository,
  DemoItemsOneRepository,
  UsersRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import {
  type PermissionHolding,
  PermissionResolver,
  holdsPermission,
} from "../permission/permission-resolver";
import { StorageService } from "../storage/storage.service";
import {
  UPLOAD_RULES,
  UploadPurpose,
  isOwnedUploadPath,
} from "../storage/upload-rules";
import { DemoCategoryService } from "./demo-category.service";
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPE,
  type DemoItemOneRecord,
  type DemoItemOneViewContext,
  REDACTED,
  SAMPLE_ONE_PERMISSIONS,
  abilitiesOf,
  escapeRegex,
  toDemoItemOneModel,
  toObjectId,
} from "./demo-item-one-mapper";
import {
  forbiddenError,
  notFoundError,
  validationError,
} from "./demo-items-one-error";
import type { CreateDemoItemOneInput } from "./dto/create-demo-item-one.input";
import type { DeleteDemoItemOneInput } from "./dto/delete-demo-item-one.input";
import type { DemoItemOneAttachmentInput } from "./dto/demo-item-one-attachment.input";
import {
  DEFAULT_PAGE_SIZE,
  type DemoItemsOneInput,
  MAX_PAGE_SIZE,
} from "./dto/demo-items-one.input";
import type { SetDemoItemOneEnabledInput } from "./dto/set-demo-item-one-enabled.input";
import type { UpdateDemoItemOneInput } from "./dto/update-demo-item-one.input";
import type {
  DeleteDemoItemOnePayload,
  DemoItemOneAttachmentUrlPayload,
  DemoItemOneHistoryPayload,
  DemoItemsOnePayload,
} from "./models/demo-item-one-payloads.model";
import type { DemoItemOneModel } from "./models/demo-item-one.model";

/** 走上傳票的兩個 input 欄位(ADR-0010 雙路:封面公開、附件私有);錯誤的 `fields` 就標這個名字。 */
type UploadPathField = "coverPath" | "attachment";

/** 附件原始檔名的長度上限(一般檔案系統的單一檔名上限)。 */
const MAX_ATTACHMENT_NAME_LENGTH = 255;

/** 附件在 DB 的四個平行欄位(同生同滅,換檔一起 `$set`、清空一起 `$unset`)。 */
interface AttachmentFields {
  attachmentPath: string;
  attachmentName: string;
  attachmentSize: number;
  attachmentContentType: string;
}

const ATTACHMENT_FIELD_KEYS = [
  "attachmentPath",
  "attachmentName",
  "attachmentSize",
  "attachmentContentType",
] as const satisfies readonly (keyof AttachmentFields)[];

/** 一次更新要送出的 `$set` / `$unset` 與要記進稽核的前後值。 */
interface UpdatePatch {
  set: Record<string, unknown>;
  unset: Record<string, string>;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/**
 * 示範模組1(`demo.sub.sample-one`)。resolver 薄、service 厚(STRUCT-01)。
 *
 * **範圍不在本檔**:`demo_items_one` 掛了 `tenantScopePlugin`(預設 `business`),
 * 所以每一條查詢都自動吃**可見範圍**(ADR-0005)再套**資料範圍規則**(ADR-0008)——
 * 含寫入與刪除的查詢,看不到的資料就改不到也刪不到(`docs/modules/data-scope.md`「執行面」)。
 * 本檔只負責:欄位級權限的投影與寫入守門、分類驗證、雙路檔案、稽核與 `abilities`。
 */
@Injectable()
export class DemoItemsOneService {
  constructor(
    private readonly items: DemoItemsOneRepository,
    private readonly users: UsersRepository,
    private readonly auditLogs: AuditLogsRepository,
    private readonly audit: AuditService,
    private readonly permissions: PermissionResolver,
    private readonly categories: DemoCategoryService,
    private readonly storage: StorageService,
  ) {}

  // ---- 讀 ----

  /** 清單:`keyword`(名稱 / 備註)、`category`、`enabled` 三個篩選,新到舊。 */
  async list(
    operator: OperatorContext,
    input: DemoItemsOneInput,
  ): Promise<DemoItemsOnePayload> {
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const totalCount = await this.items.count(operator, listFilterOf(input));
    const records = await this.items.findMany(operator, listFilterOf(input), {
      sort: { createdAt: -1, _id: -1 },
      skip: (page - 1) * pageSize,
      limit: pageSize,
    });
    const context = await this.viewContext(operator, records);
    return {
      items: records.map((record) => toDemoItemOneModel(record, context)),
      totalCount,
      page,
      pageSize,
    };
  }

  /** 單筆;可見範圍 / 資料範圍外一律 `NOT_FOUND`(不透露它存在)。 */
  async findOne(
    operator: OperatorContext,
    id: string,
  ): Promise<DemoItemOneModel> {
    const record = await this.mustFind(operator, id);
    return this.toModel(operator, record);
  }

  /**
   * 變更歷程:讀 `audit_logs`(target = 該筆);需 `edit-page.show-history`(resolver 守門)。
   * **先驗這筆資料看不看得到**,否則歷程會變成繞過資料範圍規則的側門。
   */
  async history(
    operator: OperatorContext,
    id: string,
  ): Promise<DemoItemOneHistoryPayload> {
    const record = await this.mustFind(operator, id);
    const logs = await this.auditLogs.findMany(
      operator,
      { targetType: AUDIT_TARGET_TYPE, targetId: record._id },
      { sort: { createdAt: -1, _id: -1 } },
    );
    const actors = await this.loadUserNames(
      operator,
      logs.map((log) => log.actorId),
    );
    const items = logs.map((log) => {
      const actorName = actors.get(String(log.actorId));
      return {
        id: String(log._id),
        action: log.action,
        actor:
          actorName === undefined
            ? null
            : { id: String(log.actorId), name: actorName },
        before: log.before ?? null,
        after: log.after ?? null,
        createdAt: log.createdAt,
      };
    });
    return { items, totalCount: items.length };
  }

  /**
   * 私有附件的短效下載網址(ADR-0010);需 `view`(resolver 守門)。
   * 「這個人看得到這筆資料嗎」在此驗(`mustFind` 已含租戶保底 + 資料範圍規則),
   * 沒有附件 → `NOT_FOUND`。
   */
  async attachmentUrl(
    operator: OperatorContext,
    id: string,
  ): Promise<DemoItemOneAttachmentUrlPayload> {
    const record = await this.mustFind(operator, id);
    const url = await this.storage.readUrlOf(record.attachmentPath);
    if (url === null) {
      throw notFoundError(`demo item has no attachment: ${id}`);
    }
    return { url };
  }

  // ---- 寫 ----

  /** 新增(需 `create`);資料寫進操作者的當前組織(ADR-0005)。 */
  async create(
    operator: OperatorContext,
    input: CreateDemoItemOneInput,
  ): Promise<DemoItemOneModel> {
    const holding = await this.permissionsOf(operator);
    this.assertInternalNoteWritable(input, holding);
    const name = requireText(input.name, "name");
    const options = await this.categories.options(operator);
    const category = this.categories.assertSelectable(options, input.category);
    const created = await this.items.create(operator, {
      name,
      ...(category === null ? {} : { category }),
      ...(input.status === undefined || input.status === null
        ? {}
        : { status: input.status }),
      ...optionalOf("note", trimToNull(input.note)),
      ...optionalOf("internalNote", trimToNull(input.internalNote)),
      ...optionalOf("coverPath", uploadPathOf("coverPath", input.coverPath)),
      ...attachmentFieldsOf(input.attachment),
    });
    await this.audit.record(operator, {
      action: AUDIT_ACTIONS.create,
      targetType: AUDIT_TARGET_TYPE,
      targetId: created._id,
      after: {
        name,
        category,
        status: created.status,
        ...(input.internalNote === undefined ? {} : { internalNote: REDACTED }),
      },
    });
    return this.toModel(operator, created);
  }

  /** 編輯(需 `edit`);缺席 = 不動、null = 清空(GQL-06,逐欄語意見 input 註解)。 */
  async update(
    operator: OperatorContext,
    input: UpdateDemoItemOneInput,
  ): Promise<DemoItemOneModel> {
    const holding = await this.permissionsOf(operator);
    this.assertInternalNoteWritable(input, holding);
    const current = await this.mustFind(operator, input.id);
    const patch: UpdatePatch = { set: {}, unset: {}, before: {}, after: {} };

    applyRequired(
      patch,
      "name",
      current.name,
      input.name === undefined || input.name === null
        ? undefined
        : requireText(input.name, "name"),
    );
    applyRequired(patch, "status", current.status, input.status ?? undefined);
    if (input.category !== undefined) {
      const options = await this.categories.options(operator);
      applyClearable(
        patch,
        "category",
        current.category ?? null,
        this.categories.assertSelectable(options, input.category),
      );
    }
    if (input.note !== undefined) {
      applyClearable(
        patch,
        "note",
        current.note ?? null,
        trimToNull(input.note),
      );
    }
    if (input.coverPath !== undefined) {
      applyClearable(
        patch,
        "coverPath",
        current.coverPath ?? null,
        uploadPathOf("coverPath", input.coverPath),
      );
    }
    if (input.attachment !== undefined) {
      applyAttachment(
        patch,
        current.attachmentPath ?? null,
        attachmentFieldsOf(input.attachment),
      );
    }
    if (input.internalNote !== undefined) {
      applyClearable(
        patch,
        "internalNote",
        REDACTED,
        trimToNull(input.internalNote),
      );
      // 稽核只記「動過」,不記內容(REDACTED 的理由見 demo-item-one-mapper.ts)
      patch.after.internalNote = REDACTED;
    }

    const updated = await this.items.updateById(operator, current._id, {
      ...(Object.keys(patch.set).length > 0 ? { $set: patch.set } : {}),
      ...(Object.keys(patch.unset).length > 0 ? { $unset: patch.unset } : {}),
    });
    if (!updated) {
      throw notFoundError(`demo item not found: ${input.id}`);
    }
    await this.audit.record(operator, {
      action: AUDIT_ACTIONS.edit,
      targetType: AUDIT_TARGET_TYPE,
      targetId: updated._id,
      before: patch.before,
      after: patch.after,
    });
    return this.toModel(operator, updated);
  }

  /** 軟刪除(ADR-0007;需 `delete`)。 */
  async remove(
    operator: OperatorContext,
    input: DeleteDemoItemOneInput,
  ): Promise<DeleteDemoItemOnePayload> {
    const current = await this.mustFind(operator, input.id);
    const deleted = await this.items.softDeleteById(operator, current._id);
    if (!deleted) {
      throw notFoundError(`demo item not found: ${input.id}`);
    }
    await this.audit.record(operator, {
      action: AUDIT_ACTIONS.delete,
      targetType: AUDIT_TARGET_TYPE,
      targetId: current._id,
      before: { name: current.name },
    });
    return { success: true, deletedId: String(current._id) };
  }

  /** 停用 / 啟用(需 `edit`);不套自鎖保護,理由見 input 的註解。 */
  async setEnabled(
    operator: OperatorContext,
    input: SetDemoItemOneEnabledInput,
  ): Promise<DemoItemOneModel> {
    const current = await this.mustFind(operator, input.id);
    const updated = await this.items.updateById(operator, current._id, {
      $set: { enabled: input.enabled },
    });
    if (!updated) {
      throw notFoundError(`demo item not found: ${input.id}`);
    }
    await this.audit.record(operator, {
      action: AUDIT_ACTIONS.toggleEnabled,
      targetType: AUDIT_TARGET_TYPE,
      targetId: updated._id,
      before: { enabled: current.enabled },
      after: { enabled: updated.enabled },
    });
    return this.toModel(operator, updated);
  }

  // ---- 內部 ----

  private async mustFind(
    operator: OperatorContext,
    id: string,
  ): Promise<DemoItemOneRecord> {
    const record = await this.items.findById(operator, toObjectId(id, "id"));
    if (!record) {
      throw notFoundError(`demo item not found: ${id}`);
    }
    return record;
  }

  private async permissionsOf(
    operator: OperatorContext,
  ): Promise<PermissionHolding> {
    if (!operator.actorId) {
      // 防呆:全域 AuthGuard 已擋掉未登入,這裡只是讓型別收斂
      return { permissionKeys: new Set(), foreignPermissionKeys: new Set() };
    }
    return this.permissions.resolve(operator.actorId, operator.currentOrgId);
  }

  /**
   * 欄位級權限的**寫入**守門(ADR-0004):`internalNote` 只要出現在 input 裡(含送 `null`
   * 要清空)就需要 `edit-internal-note`。投影(讀)與這裡(寫)是兩件事,各守一層。
   */
  private assertInternalNoteWritable(
    input: { internalNote?: string | null },
    holding: PermissionHolding,
  ): void {
    if (input.internalNote === undefined) {
      return;
    }
    if (!holdsPermission(holding, SAMPLE_ONE_PERMISSIONS.editInternalNote)) {
      throw forbiddenError(
        `Missing permission ${SAMPLE_ONE_PERMISSIONS.editInternalNote} for field internalNote`,
        "FIELD_FORBIDDEN",
      );
    }
  }

  private async toModel(
    operator: OperatorContext,
    record: DemoItemOneRecord,
  ): Promise<DemoItemOneModel> {
    const context = await this.viewContext(operator, [record]);
    return toDemoItemOneModel(record, context);
  }

  /** 每次回傳前算一次:權限旗標、分類顯示名、建立者名稱、公開網址產生器。 */
  private async viewContext(
    operator: OperatorContext,
    records: readonly DemoItemOneRecord[],
  ): Promise<DemoItemOneViewContext> {
    const holding = await this.permissionsOf(operator);
    const [categories, users] = await Promise.all([
      this.categories.options(operator),
      this.loadUserNames(
        operator,
        records.map((record) => record.createdBy),
      ),
    ]);
    return {
      canShowInternalNote: holdsPermission(
        holding,
        SAMPLE_ONE_PERMISSIONS.showInternalNote,
      ),
      abilities: abilitiesOf(holding),
      categories,
      users,
      publicUrlOf: (objectPath) => this.storage.publicUrlOf(objectPath),
    };
  }

  /** userId → 名稱;一次查完(N+1 防呆)。`users` 不是租戶資料,範圍不適用。 */
  private async loadUserNames(
    operator: OperatorContext,
    ids: readonly (Types.ObjectId | null)[],
  ): Promise<ReadonlyMap<string, string>> {
    const unique = [...new Set(ids.filter((id) => id !== null).map(String))];
    if (unique.length === 0) {
      return new Map();
    }
    const found = await this.users.findMany(operator, {
      _id: { $in: unique.map((id) => new Types.ObjectId(id)) },
    });
    return new Map(found.map((user) => [String(user._id), user.name]));
  }
}

/**
 * 清單的篩選條件。**關鍵字不比對內部備註** —— 否則沒有 `show-internal-note` 的人
 * 可以用關鍵字把它一個字一個字試出來(投影擋得住直接讀,擋不住這種側面查詢)。
 */
function listFilterOf(input: DemoItemsOneInput): Record<string, unknown> {
  const keyword = input.keyword?.trim();
  const category = input.category?.trim();
  return {
    ...(keyword
      ? {
          $or: [
            { name: { $regex: escapeRegex(keyword), $options: "i" } },
            { note: { $regex: escapeRegex(keyword), $options: "i" } },
          ],
        }
      : {}),
    ...(category ? { category } : {}),
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
  };
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw validationError(`${field} is required`, [field]);
  }
  return trimmed;
}

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * 上傳路徑的守門(ADR-0010,與組織商標同一條):只收本 API 簽出來的路徑,
 * 不讓呼叫端把任意 bucket 物件塞進 DB。空字串 / null = 沒有檔案。
 */
function uploadPathOf(
  field: UploadPathField,
  value: string | null | undefined,
): string | null {
  const trimmed = trimToNull(value);
  if (trimmed !== null && !isOwnedUploadPath(trimmed)) {
    throw validationError(`${field} is not an upload path of this API`, [
      field,
    ]);
  }
  return trimmed;
}

/**
 * 附件 input → DB 的四個平行欄位;`null` / 缺席 = 沒有附件。
 * 路徑照封面同一條守門(`isOwnedUploadPath`);檔名 / 大小 / 檔型是顯示用的中繼資料,
 * 只驗形狀(不驗與 bucket 物件一致),不合一律 `VALIDATION_FAILED`,`fields: ["attachment"]`。
 */
function attachmentFieldsOf(
  input: DemoItemOneAttachmentInput | null | undefined,
): AttachmentFields | null {
  if (input === null || input === undefined) {
    return null;
  }
  const path = uploadPathOf("attachment", input.path);
  if (path === null) {
    throw validationError("attachment.path is required", ["attachment"]);
  }
  const name = input.name.trim();
  if (name === "" || name.length > MAX_ATTACHMENT_NAME_LENGTH) {
    throw validationError(
      `attachment.name must be 1-${String(MAX_ATTACHMENT_NAME_LENGTH)} characters`,
      ["attachment"],
    );
  }
  const rule = UPLOAD_RULES[UploadPurpose.DEMO_ATTACHMENT];
  if (
    !Number.isInteger(input.size) ||
    input.size < 0 ||
    input.size > rule.maxBytes
  ) {
    throw validationError(
      `attachment.size must be 0-${String(rule.maxBytes)} bytes`,
      ["attachment"],
    );
  }
  const contentType = input.contentType.trim().toLowerCase();
  if (!(contentType in rule.extensions)) {
    throw validationError(
      `attachment.contentType is not allowed: ${input.contentType}`,
      ["attachment"],
    );
  }
  return {
    attachmentPath: path,
    attachmentName: name,
    attachmentSize: input.size,
    attachmentContentType: contentType,
  };
}

/**
 * 附件的編輯:四欄一起換或一起清。稽核只記路徑(`attachmentPath`)——
 * 歷程的欄位名沿用原本的那一個,檔名等中繼資料不進稽核。
 */
function applyAttachment(
  patch: UpdatePatch,
  currentPath: string | null,
  fields: AttachmentFields | null,
): void {
  if (fields === null) {
    for (const key of ATTACHMENT_FIELD_KEYS) {
      patch.unset[key] = "";
    }
  } else {
    Object.assign(patch.set, fields);
  }
  patch.before.attachmentPath = currentPath;
  patch.after.attachmentPath = fields?.attachmentPath ?? null;
}

/** 新增時的選填欄位:沒值就不寫這個欄位(不落 null,ADR-0002 只約束初始 seed 值欄位)。 */
function optionalOf(
  field: string,
  value: string | null,
): Record<string, string> {
  return value === null ? {} : { [field]: value };
}

/**
 * 不可清空的欄位(`name` / `status`):送 `null` 視同缺席;值沒變就不記進稽核。
 * 型別刻意收成 `string` —— enum 與落庫的字串是同一組值(見 `DemoItemOneStatusEnum`)。
 */
function applyRequired(
  patch: UpdatePatch,
  field: string,
  current: string,
  given: string | undefined,
): void {
  if (given === undefined || given === current) {
    return;
  }
  patch.set[field] = given;
  patch.before[field] = current;
  patch.after[field] = given;
}

/** 可清空的欄位:`null` → `$unset`(欄位消失)、有值 → `$set`(GQL-06)。 */
function applyClearable(
  patch: UpdatePatch,
  field: string,
  current: string | null,
  value: string | null,
): void {
  if (value === null) {
    patch.unset[field] = "";
  } else {
    patch.set[field] = value;
  }
  patch.before[field] = current;
  patch.after[field] = value;
}
