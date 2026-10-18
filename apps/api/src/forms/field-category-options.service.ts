import { Injectable } from "@nestjs/common";

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
} from "../fields/field-visibility";

/** 一個欄位管理選項(value → 顯示名與是否啟用)。 */
export interface CategoryOption {
  label: string;
  enabled: boolean;
}

export type CategoryOptions = ReadonlyMap<string, CategoryOption>;

/**
 * 表單的「欄位管理類別」選項來源(`options.kind = "fieldCategory"`,`options` 三種來源之一)。
 *
 * 可選的範圍 = 欄位管理的**合併範圍**(`docs/modules/field-manager.md`:全域種子 + 上層組織自訂 +
 * 當前組織自訂 + 可見範圍內的下層自訂)——判斷直接沿用 `fields/field-visibility.ts`,不在這裡另寫一份。
 * 新值只收啟用中的;顯示時(現名 vs 快照)停用的仍算「來源還在」。
 * 類別 key 不存在 → 沒有任何選項(fail-closed)。
 */
@Injectable()
export class FieldCategoryOptionsService {
  constructor(
    private readonly fields: FieldsRepository,
    private readonly categories: FieldCategoriesRepository,
    private readonly orgs: OrgsRepository,
  ) {}

  /** 目前全部類別 key(檢查器的 `OPTIONS_UNKNOWN_CATEGORY` 用)。 */
  async categoryKeys(operator: OperatorContext): Promise<ReadonlySet<string>> {
    const found = await this.categories.findMany(operator, {});
    return new Set(found.map((category) => category.key));
  }

  /** 操作者在合併範圍內看得到的選項(含停用的,以 `enabled` 區分;Map 依 `order`、建立時間排)。 */
  async options(
    operator: OperatorContext,
    categoryKey: string,
  ): Promise<CategoryOptions> {
    const category = await this.categories.findOne(operator, {
      key: categoryKey,
    });
    if (!category) {
      return new Map();
    }
    const visibility = await resolveFieldVisibility(operator, this.orgs);
    const found = await this.fields.findMany(
      fieldReadContext(operator),
      { categoryId: category._id, ...scopeFilterOf(visibility) },
      // 選項下拉的順序(`formFieldOptions`)照欄位管理的排序值;同值依建立順序
      { sort: { order: 1, createdAt: 1 } },
    );
    return new Map(
      found.map((field) => [
        field.value,
        { label: field.label, enabled: field.enabled },
      ]),
    );
  }
}
