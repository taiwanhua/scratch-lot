import { Injectable } from "@nestjs/common";
import { GraphQLError } from "graphql";

import { REASON_OPTION_OTHER } from "@repo/domain/form";
import type { TagPaletteKey } from "@repo/domain/tag-palette";

import {
  FieldCategoriesRepository,
  FieldsRepository,
  OrgsRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import {
  colorOf,
  fieldReadContext,
  resolveFieldVisibility,
  scopeFilterOf,
} from "./field-visibility";

/** 一個欄位管理選項(下拉用)。 */
export interface FieldOption {
  value: string;
  label: string;
  /** 標籤色票代號;null = 不設定顏色(畫面照舊只顯示文字) */
  color: TagPaletteKey | null;
}

/** 一個選項的完整狀態(含停用的);`optionMapOf` 的值。 */
export interface CategoryOption {
  label: string;
  enabled: boolean;
  /** 同 `FieldOption.color` */
  color: TagPaletteKey | null;
}

/** 選項值 → 選項;依排序值、建立順序。 */
export type CategoryOptions = ReadonlyMap<string, CategoryOption>;

/** 使用者選的原因:選項值 + 說明。 */
export interface ReasonInput {
  reasonKey?: string | null;
  reasonNote?: string | null;
}

/** 驗過的原因:選項值、選項名稱(驗的當下)、說明(去空白;沒填 = null)。 */
export interface CheckedReason {
  reasonKey: string;
  reasonLabel: string;
  reasonNote: string | null;
}

/** `fields` 錯誤要標回的欄位名(預設 `reasonKey` / `reasonNote`)。 */
export interface ReasonFieldNames {
  key?: string;
  note?: string;
}

function validationError(message: string, fields: string[]): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "VALIDATION_FAILED", fields },
  });
}

/**
 * 業務畫面的欄位管理下拉選項與「原因」檢查(底座能力;`docs/modules/field-manager.md`「給業務功能用的選項」):
 *
 * - `optionsOf`:某類別**啟用中**的選項 `{ value, label, color }`,範圍照欄位管理的合併規則(全域 + 上層 + 自己 + 看得到的下層,
 *   `fields/field-visibility.ts`),依排序值、建立順序。不需要欄位管理的權限
 * - `assertReason`:原因必填且是該類別啟用中的選項;選「其他」(`REASON_OPTION_OTHER`)時說明必填。
 *   不合 → `VALIDATION_FAILED`(`fields` 指到原因 / 說明欄)
 *
 * 兩者都要呼叫端傳**允許的類別白名單**:類別 key 不在白名單 → `VALIDATION_FAILED`(`fields: ["categoryKey"]`),
 * 不讓前端帶任意類別讀別的清單。類別不存在 → 沒有選項(fail-closed:原因一律不合法)。
 *
 * 表單引擎(類別 key 來自表單定義,不經白名單)用另外兩支:
 *
 * - `optionMapOf`:同一個合併範圍、**含停用的**選項(以 `enabled` 區分)。新值只收啟用中的;
 *   顯示時(現名 vs 快照)停用的仍算「來源還在」
 * - `categoryKeys`:目前全部類別 key(表單定義檢查的 `OPTIONS_UNKNOWN_CATEGORY` 用)
 */
@Injectable()
export class FieldOptionsService {
  constructor(
    private readonly categories: FieldCategoriesRepository,
    private readonly fields: FieldsRepository,
    private readonly orgs: OrgsRepository,
  ) {}

  async optionsOf(
    operator: OperatorContext,
    categoryKey: string,
    allowedCategories: readonly string[],
  ): Promise<FieldOption[]> {
    if (!allowedCategories.includes(categoryKey)) {
      throw validationError(`category not allowed here: ${categoryKey}`, [
        "categoryKey",
      ]);
    }
    const found = await this.findOptions(operator, categoryKey, {
      enabled: true,
    });
    return found.map((option) => ({
      value: option.value,
      label: option.label,
      color: colorOf(option),
    }));
  }

  /** 合併範圍內的選項,含停用的(以 `enabled` 區分);類別不存在 → 空。 */
  async optionMapOf(
    operator: OperatorContext,
    categoryKey: string,
  ): Promise<CategoryOptions> {
    const found = await this.findOptions(operator, categoryKey, {});
    return new Map(
      found.map((option) => [
        option.value,
        {
          label: option.label,
          enabled: option.enabled,
          color: colorOf(option),
        },
      ]),
    );
  }

  /** 目前全部類別 key(類別是全域種子,不分租戶)。 */
  async categoryKeys(operator: OperatorContext): Promise<ReadonlySet<string>> {
    const found = await this.categories.findMany(
      fieldReadContext(operator),
      {},
    );
    return new Set(found.map((category) => category.key));
  }

  private async findOptions(
    operator: OperatorContext,
    categoryKey: string,
    extra: { enabled?: true },
  ) {
    const category = await this.categories.findOne(fieldReadContext(operator), {
      key: categoryKey,
    });
    if (!category) {
      return [];
    }
    const visibility = await resolveFieldVisibility(operator, this.orgs);
    return this.fields.findMany(
      fieldReadContext(operator),
      { categoryId: category._id, ...extra, ...scopeFilterOf(visibility) },
      // 下拉順序照欄位管理的排序值;同值依建立順序
      { sort: { order: 1, createdAt: 1 } },
    );
  }

  async assertReason(
    operator: OperatorContext,
    categoryKey: string,
    input: ReasonInput,
    allowedCategories: readonly string[],
    names: ReasonFieldNames = {},
  ): Promise<CheckedReason> {
    const keyField = names.key ?? "reasonKey";
    const noteField = names.note ?? "reasonNote";
    const reasonKey = input.reasonKey?.trim() ?? "";
    const note = input.reasonNote?.trim() ?? "";
    if (reasonKey === "") {
      throw validationError(`${keyField} is required`, [keyField]);
    }
    const options = await this.optionsOf(
      operator,
      categoryKey,
      allowedCategories,
    );
    const option = options.find((candidate) => candidate.value === reasonKey);
    if (option === undefined) {
      throw validationError(`not an enabled option: ${reasonKey}`, [keyField]);
    }
    if (reasonKey === REASON_OPTION_OTHER && note === "") {
      throw validationError(
        `${noteField} is required when the reason is other`,
        [noteField],
      );
    }
    return {
      reasonKey,
      reasonLabel: option.label,
      reasonNote: note === "" ? null : note,
    };
  }
}
