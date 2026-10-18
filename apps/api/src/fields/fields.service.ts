import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { AuditService } from "../audit/audit.service";
import type { Persisted } from "../database/base.repository";
import {
  FieldCategoriesRepository,
  type FieldCategoryDocument,
  type FieldDocument,
  FieldsRepository,
  OrgsRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import type { CreateFieldInput } from "./dto/create-field.input";
import type { SetFieldEnabledInput } from "./dto/set-field-enabled.input";
import type { UpdateFieldInput } from "./dto/update-field.input";
import {
  type FieldVisibility,
  canEditField,
  canToggleFieldEnabled,
  compareFields,
  fieldReadContext,
  loadOwnerOrgs,
  resolveFieldVisibility,
  scopeFilterOf,
  toFieldModel,
} from "./field-visibility";
import {
  fieldValueDuplicateError,
  forbiddenError,
  notFoundError,
  validationError,
} from "./fields-error";
import type { FieldsPayload } from "./models/field-payloads.model";
import type { FieldModel } from "./models/field.model";

type FieldRecord = Persisted<FieldDocument>;
type CategoryRecord = Persisted<FieldCategoryDocument>;

/** 審計動作名(field-manager.md「審計動作」);`targetType` 一律 `field`。 */
const AUDIT_TARGET_TYPE = "field";
const AUDIT_CREATE = "field.create";
const AUDIT_EDIT = "field.edit";
const AUDIT_TOGGLE_ENABLED = "field.toggle-enabled";

/** MongoDB 唯一索引衝突;唯一索引與表單驗證之間的競態由它兜底。 */
const DUPLICATE_KEY_ERROR = 11_000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY_ERROR
  );
}

function toObjectId(value: string, field: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw validationError(`${field} is not a valid id: ${value}`, [field]);
  }
  return new Types.ObjectId(value);
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw validationError(`${field} must not be empty`, [field]);
  }
  return trimmed;
}

/**
 * 欄位管理(`system.field-manager`)。resolver 薄、service 厚(STRUCT-01)。
 *
 * **合併清單的定義**(規則表正本 field-manager.md):一個類別下看得到的選項 =
 * 全域種子(`orgId = null`)+ **上層組織**自訂(祖先,不受可見性開關影響)+ 當前組織自訂
 * + **可見範圍內的下層**自訂;**只能編輯 / 停用自己這一層加的**。
 * 範圍怎麼算、一列能做什麼都在 `field-visibility.ts`,本檔只負責規則、審計與錯誤碼。
 *
 * **種子選項**(`isSystem`)只有 `enabled` 可改,且那是**全域**開關(ADR-0002:
 * `enabled` 是初始 seed 值欄位、由人在系統內管理),所以限根組織操作者 —
 * 租戶切它會影響其他租戶,違反租戶隔離。
 */
@Injectable()
export class FieldsService {
  constructor(
    private readonly fields: FieldsRepository,
    private readonly categories: FieldCategoriesRepository,
    private readonly orgs: OrgsRepository,
    private readonly audit: AuditService,
  ) {}

  // ---- 讀 ----

  /** 一個類別下的合併清單,依 `order` 再依**組織深度**(全域最前、下層最後)。 */
  async listFields(
    operator: OperatorContext,
    categoryId: string,
  ): Promise<FieldsPayload> {
    const category = await this.mustFindCategory(operator, categoryId);
    const visibility = await resolveFieldVisibility(operator, this.orgs);
    const found = await this.fields.findMany(
      fieldReadContext(operator),
      { categoryId: category._id, ...scopeFilterOf(visibility) },
      { sort: { order: 1, createdAt: 1 } },
    );
    const owners = await loadOwnerOrgs(operator, this.orgs, found);
    // 上面已依 order / createdAt 排好,sort 是穩定的 → 同 order 同深度者維持建立順序
    const items = found
      .toSorted((left, right) => compareFields(left, right, owners))
      .map((item) => toFieldModel(item, visibility, owners));
    return { items, totalCount: items.length };
  }

  // ---- 寫 ----

  /** 新增當前組織的自訂選項(`orgId` 由 BaseRepository 自當前組織寫入,ADR-0005)。 */
  async create(
    operator: OperatorContext,
    input: CreateFieldInput,
  ): Promise<FieldModel> {
    const category = await this.mustFindCategory(operator, input.categoryId);
    const visibility = await resolveFieldVisibility(operator, this.orgs);
    const label = requireText(input.label, "label");
    const value = requireText(input.value, "value");
    await this.assertValueAvailable(operator, visibility, category._id, value);
    let created: FieldRecord;
    try {
      created = await this.fields.create(operator, {
        categoryId: category._id,
        label,
        value,
        order: input.order ?? 0,
        enabled: true,
        isSystem: false,
        ...(input.description === undefined || input.description === null
          ? {}
          : { description: input.description }),
      });
    } catch (error) {
      // 唯一索引擋下的競態(兩個請求同時新增同一個 value)
      if (isDuplicateKeyError(error)) {
        throw fieldValueDuplicateError(
          `field value already exists in this category: ${value}`,
        );
      }
      throw error;
    }
    await this.audit.record(operator, {
      action: AUDIT_CREATE,
      targetType: AUDIT_TARGET_TYPE,
      targetId: created._id,
      after: { categoryId: String(category._id), value, label },
    });
    return this.toModel(operator, created, visibility);
  }

  /** 編輯自訂選項的 label / order / description;種子與別層的選項 → `FORBIDDEN`。 */
  async update(
    operator: OperatorContext,
    input: UpdateFieldInput,
  ): Promise<FieldModel> {
    const visibility = await resolveFieldVisibility(operator, this.orgs);
    const current = await this.mustFindOwnField(operator, visibility, input.id);
    const set: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    if (input.label !== undefined) {
      set.label = requireText(input.label, "label");
      before.label = current.label;
    }
    if (input.order !== undefined && input.order !== null) {
      set.order = input.order;
      before.order = current.order;
    }
    const unset: Record<string, string> = {};
    if (input.description !== undefined) {
      before.description = current.description ?? null;
      if (input.description === null) {
        unset.description = "";
      } else {
        set.description = input.description;
      }
    }
    const updated = await this.fields.updateById(operator, current._id, {
      ...(Object.keys(set).length > 0 ? { $set: set } : {}),
      ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
    });
    if (!updated) {
      throw notFoundError(`field not found: ${input.id}`);
    }
    await this.audit.record(operator, {
      action: AUDIT_EDIT,
      targetType: AUDIT_TARGET_TYPE,
      targetId: updated._id,
      before,
      after: {
        ...set,
        ...(unset.description === undefined ? {} : { description: null }),
      },
    });
    return this.toModel(operator, updated, visibility);
  }

  /**
   * 停用 / 啟用:自訂選項 = **自己這一層**加的那筆(上層 / 下層的回 `NOT_OWNER`);
   * 種子選項的 `enabled` 是全域開關,限根組織操作者(見本檔開頭)。
   */
  async setEnabled(
    operator: OperatorContext,
    input: SetFieldEnabledInput,
  ): Promise<FieldModel> {
    const visibility = await resolveFieldVisibility(operator, this.orgs);
    const current = await this.mustFindVisibleField(
      operator,
      visibility,
      input.id,
    );
    if (!canToggleFieldEnabled(current, visibility)) {
      throw current.orgId === null || current.isSystem
        ? forbiddenError(
            `seed field option is a global switch; only the root org can toggle it: ${input.id}`,
            "SEED_GLOBAL_SWITCH",
          )
        : forbiddenError(
            `field option belongs to another org: ${input.id}`,
            "NOT_OWNER",
          );
    }
    const updated = await this.fields.updateById(operator, current._id, {
      $set: { enabled: input.enabled },
    });
    if (!updated) {
      throw notFoundError(`field not found: ${input.id}`);
    }
    await this.audit.record(operator, {
      action: AUDIT_TOGGLE_ENABLED,
      targetType: AUDIT_TARGET_TYPE,
      targetId: updated._id,
      before: { enabled: current.enabled },
      after: { enabled: updated.enabled },
    });
    return this.toModel(operator, updated, visibility);
  }

  // ---- 內部 ----

  /** 寫入 mutation 的回傳:只有一筆,來源組織單獨查一次(清單走 `loadOwnerOrgs`)。 */
  private async toModel(
    operator: OperatorContext,
    field: FieldRecord,
    visibility: FieldVisibility,
  ): Promise<FieldModel> {
    const owners = await loadOwnerOrgs(operator, this.orgs, [field]);
    return toFieldModel(field, visibility, owners);
  }

  private async mustFindCategory(
    operator: OperatorContext,
    categoryId: string,
  ): Promise<CategoryRecord> {
    const category = await this.categories.findById(
      operator,
      toObjectId(categoryId, "categoryId"),
    );
    if (!category) {
      throw notFoundError(`field category not found: ${categoryId}`);
    }
    return category;
  }

  /** 取一筆在合併清單裡看得到的選項(全域 + 上層 + 自己 + 可見範圍內的下層)。 */
  private async mustFindVisibleField(
    operator: OperatorContext,
    visibility: FieldVisibility,
    id: string,
  ): Promise<FieldRecord> {
    const found = await this.fields.findOne(fieldReadContext(operator), {
      _id: toObjectId(id, "id"),
      ...scopeFilterOf(visibility),
    });
    if (!found) {
      throw notFoundError(`field not found: ${id}`);
    }
    return found;
  }

  /** 取一筆**可編輯**的選項:自己這一層的自訂選項;種子與別層的一律 `FORBIDDEN`。 */
  private async mustFindOwnField(
    operator: OperatorContext,
    visibility: FieldVisibility,
    id: string,
  ): Promise<FieldRecord> {
    const found = await this.mustFindVisibleField(operator, visibility, id);
    if (canEditField(found, visibility)) {
      return found;
    }
    throw found.orgId === null || found.isSystem
      ? forbiddenError(
          `seed field option is read-only (only enabled can be changed): ${id}`,
          "SEED_READ_ONLY",
        )
      : forbiddenError(
          `field option belongs to another org: ${id}`,
          "NOT_OWNER",
        );
  }

  /**
   * 同一類別下 value 不可與**上層繼承鏈**上的任一筆重複:自己這一層已有(唯一索引)、
   * 該類別的全域選項、或看得到的上層組織自訂(後兩者唯一索引擋不到 — orgId 不同)。
   * 合併清單是給表單下拉用的,同一個 `value` 出現兩次,存進業務資料後分不出是哪一筆。
   */
  private async assertValueAvailable(
    operator: OperatorContext,
    visibility: FieldVisibility,
    categoryId: Types.ObjectId,
    value: string,
  ): Promise<void> {
    const clash = await this.fields.findOne(fieldReadContext(operator), {
      categoryId,
      value,
      orgId: { $in: visibility.inheritedOrgIds },
    });
    if (clash) {
      throw fieldValueDuplicateError(
        `field value already exists in this category: ${value}`,
      );
    }
  }
}
