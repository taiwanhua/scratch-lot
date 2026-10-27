import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { isTagPaletteKey } from "@repo/domain/project/tag-palette";

import { AuditService } from "../../audit/audit.service";
import type { Persisted } from "../../database/base.repository";
import {
  FieldCategoriesRepository,
  type FieldDocument,
  FieldsRepository,
  OrgsRepository,
} from "../../database/database.module";
import type { OperatorContext } from "../../database/operator-context";
import { tenantIdOfOrg } from "../../database/tenant-id";
import {
  canToggleFieldEnabled,
  fieldReadContext,
  resolveFieldVisibility,
  scopeFilterOf,
} from "../../fields/field-visibility";
import {
  forbiddenError,
  notFoundError,
  validationError,
} from "../../fields/fields-error";
import {
  type FieldOptionColorDocument,
  FieldOptionColorsRepository,
} from "../database/field-option-colors/field-option-colors.repository";
import type { SetFieldOptionColorInput } from "./dto/set-field-option-color.input";
import type {
  FieldOptionColorModel,
  FieldOptionColorsPayload,
} from "./models/field-option-color.model";

type FieldRecord = Persisted<FieldDocument>;
type ColorRecord = Persisted<FieldOptionColorDocument>;

/** 審計:沿用欄位管理的 `targetType = field`(顏色是選項的屬性,升格後就是 `fields.color`)。 */
const AUDIT_TARGET_TYPE = "field";
const AUDIT_SET_COLOR = "field.set-color";

/** MongoDB 唯一索引衝突(兩個請求同時第一次設定同一選項的顏色)。 */
const DUPLICATE_KEY_ERROR = 11_000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY_ERROR
  );
}

/**
 * 欄位選項顏色(S2 專案客製,規格 18.5;升格後是底座 `fields.color`)。
 *
 * - **讀**:一個類別的合併清單(範圍沿用底座 `fields/field-visibility.ts`)裡有顏色的選項
 * - **寫**:誰能設顏色 = 誰能停用 / 啟用那一筆(`canToggleFieldEnabled`):自訂選項限加它的那一層,
 *   全域種子限根組織 —— 每個選項只有一個擁有者,所以每個選項最多一筆顏色
 * - 只能從色票選:不在清單的代號(含色碼)回 `VALIDATION_FAILED`
 */
@Injectable()
export class FieldOptionColorsService {
  constructor(
    private readonly colors: FieldOptionColorsRepository,
    private readonly fields: FieldsRepository,
    private readonly categories: FieldCategoriesRepository,
    private readonly orgs: OrgsRepository,
    private readonly audit: AuditService,
  ) {}

  /** 類別(以 key 指定)合併清單裡有顏色的選項;不存在的類別 key → `NOT_FOUND`。 */
  async list(
    operator: OperatorContext,
    categoryKey: string,
  ): Promise<FieldOptionColorsPayload> {
    const category = await this.categories.findOne(operator, {
      key: categoryKey,
    });
    if (!category) {
      throw notFoundError(`field category not found: ${categoryKey}`);
    }
    const visibility = await resolveFieldVisibility(operator, this.orgs);
    const options = await this.fields.findMany(
      fieldReadContext(operator),
      { categoryId: category._id, ...scopeFilterOf(visibility) },
      { sort: { order: 1, createdAt: 1 } },
    );
    if (options.length === 0) {
      return { items: [], totalCount: 0 };
    }
    // 查詢釘死在合併清單的選項 id 上(見 `fieldReadContext`):顏色的擁有者可能是根組織或上層組織;
    // 另釘租戶 —— 只有全域選項的顏色(根組織設,tenantId = null)與自己租戶設的,別租戶的一律不讀
    const tenantId = await this.tenantIdOf(operator);
    const colors = await this.colors.findMany(fieldReadContext(operator), {
      fieldId: { $in: options.map((option) => option._id) },
      tenantId: { $in: tenantId === null ? [null] : [null, tenantId] },
    });
    const byField = new Map(
      colors.map((color) => [String(color.fieldId), color.paletteKey]),
    );
    const items = options.flatMap((option): FieldOptionColorModel[] => {
      const paletteKey = byField.get(String(option._id)) ?? null;
      return paletteKey === null
        ? []
        : [{ fieldId: String(option._id), value: option.value, paletteKey }];
    });
    return { items, totalCount: items.length };
  }

  /** 設定 / 清掉一個選項的顏色(清掉 = 存 `null`,不刪資料)。 */
  async set(
    operator: OperatorContext,
    input: SetFieldOptionColorInput,
  ): Promise<FieldOptionColorModel> {
    const paletteKey = input.paletteKey ?? null;
    if (paletteKey !== null && !isTagPaletteKey(paletteKey)) {
      throw validationError(`paletteKey is not a tag palette: ${paletteKey}`, [
        "paletteKey",
      ]);
    }
    const field = await this.mustFindOwnedField(operator, input.fieldId);
    const tenantId = await this.tenantIdOf(operator);
    const before = await this.findColor(operator, tenantId, field._id);
    const saved = await this.save(operator, {
      existing: before,
      tenantId,
      fieldId: field._id,
      paletteKey,
    });
    await this.audit.record(operator, {
      action: AUDIT_SET_COLOR,
      targetType: AUDIT_TARGET_TYPE,
      targetId: field._id,
      before: { paletteKey: before?.paletteKey ?? null },
      after: { paletteKey: saved.paletteKey },
    });
    return {
      fieldId: String(field._id),
      value: field.value,
      paletteKey: saved.paletteKey,
    };
  }

  // ---- 內部 ----

  /** 第一次設定就建一筆,之後更新同一筆;同時第一次設定的競態由唯一索引兜底、改成更新。 */
  private async save(
    operator: OperatorContext,
    target: {
      existing: ColorRecord | null;
      tenantId: Types.ObjectId | null;
      fieldId: Types.ObjectId;
      paletteKey: string | null;
    },
  ): Promise<ColorRecord> {
    const { existing, tenantId, fieldId, paletteKey } = target;
    if (existing !== null) {
      return this.mustUpdate(operator, existing._id, paletteKey);
    }
    try {
      return await this.colors.create(operator, {
        tenantId,
        fieldId,
        paletteKey,
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
      const raced = await this.findColor(operator, tenantId, fieldId);
      if (raced === null) {
        throw error;
      }
      return this.mustUpdate(operator, raced._id, paletteKey);
    }
  }

  private async mustUpdate(
    operator: OperatorContext,
    id: Types.ObjectId,
    paletteKey: string | null,
  ): Promise<ColorRecord> {
    const updated = await this.colors.updateById(operator, id, {
      $set: { paletteKey },
    });
    if (!updated) {
      throw notFoundError(`field option color not found: ${String(id)}`);
    }
    return updated;
  }

  private findColor(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    fieldId: Types.ObjectId,
  ): Promise<ColorRecord | null> {
    return this.colors.findOne(operator, { tenantId, fieldId });
  }

  /** 當前組織的租戶頂層(根組織 = null:全域選項的顏色)。 */
  private async tenantIdOf(
    operator: OperatorContext,
  ): Promise<Types.ObjectId | null> {
    const { currentOrgId } = operator;
    if (currentOrgId === null) {
      return null;
    }
    const org = await this.orgs.findById(
      fieldReadContext(operator),
      currentOrgId,
    );
    if (!org) {
      throw notFoundError(`current org not found: ${String(currentOrgId)}`);
    }
    return tenantIdOfOrg({ _id: org._id, ancestors: org.ancestors });
  }

  /** 看得到、而且這一層能設顏色的選項;看不到 → `NOT_FOUND`,別人的 → `FORBIDDEN`。 */
  private async mustFindOwnedField(
    operator: OperatorContext,
    fieldId: string,
  ): Promise<FieldRecord> {
    if (!Types.ObjectId.isValid(fieldId)) {
      throw validationError(`fieldId is not a valid id: ${fieldId}`, [
        "fieldId",
      ]);
    }
    const visibility = await resolveFieldVisibility(operator, this.orgs);
    const field = await this.fields.findOne(fieldReadContext(operator), {
      _id: new Types.ObjectId(fieldId),
      ...scopeFilterOf(visibility),
    });
    if (!field) {
      throw notFoundError(`field not found: ${fieldId}`);
    }
    if (!canToggleFieldEnabled(field, visibility)) {
      throw field.orgId === null || field.isSystem
        ? forbiddenError(
            `seed field option color is global; only the root org can set it: ${fieldId}`,
            "SEED_GLOBAL_SWITCH",
          )
        : forbiddenError(
            `field option belongs to another org: ${fieldId}`,
            "NOT_OWNER",
          );
    }
    return field;
  }
}
