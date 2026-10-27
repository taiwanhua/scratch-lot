import { Injectable } from "@nestjs/common";
import { GraphQLError } from "graphql";

import { REASON_OPTION_OTHER } from "@repo/domain/form";

import {
  FieldCategoriesRepository,
  FieldsRepository,
  OrgsRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import {
  fieldReadContext,
  resolveFieldVisibility,
  scopeFilterOf,
} from "./field-visibility";

/** 一個欄位管理選項(下拉用)。 */
export interface FieldOption {
  value: string;
  label: string;
}

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
 * - `optionsOf`:某類別**啟用中**的選項,範圍照欄位管理的合併規則(全域 + 上層 + 自己 + 看得到的下層,
 *   `fields/field-visibility.ts`),依排序值、建立順序。不需要欄位管理的權限
 * - `assertReason`:原因必填且是該類別啟用中的選項;選「其他」(`REASON_OPTION_OTHER`)時說明必填。
 *   不合 → `VALIDATION_FAILED`(`fields` 指到原因 / 說明欄)
 *
 * 兩者都要呼叫端傳**允許的類別白名單**:類別 key 不在白名單 → `VALIDATION_FAILED`(`fields: ["categoryKey"]`),
 * 不讓前端帶任意類別讀別的清單。類別不存在 → 沒有選項(fail-closed:原因一律不合法)。
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
    const category = await this.categories.findOne(fieldReadContext(operator), {
      key: categoryKey,
    });
    if (!category) {
      return [];
    }
    const visibility = await resolveFieldVisibility(operator, this.orgs);
    const found = await this.fields.findMany(
      fieldReadContext(operator),
      { categoryId: category._id, enabled: true, ...scopeFilterOf(visibility) },
      { sort: { order: 1, createdAt: 1 } },
    );
    return found.map((option) => ({
      value: option.value,
      label: option.label,
    }));
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
