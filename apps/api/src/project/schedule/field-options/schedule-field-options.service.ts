import { Injectable } from "@nestjs/common";

import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";

import {
  FieldCategoriesRepository,
  FieldsRepository,
  OrgsRepository,
} from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import {
  fieldReadContext,
  resolveFieldVisibility,
  scopeFilterOf,
} from "../../../fields/field-visibility";
import { validationError } from "../shared/schedule-error";
import type { ScheduleFieldOptionModel } from "./schedule-field-option.model";

/** 一個要驗的下拉值:哪個類別、值、錯誤時標回哪個欄位。 */
export interface ScheduleOptionCheck {
  categoryKey: string;
  value: string;
  field: string;
}

const SCHEDULE_CATEGORY_KEYS: ReadonlySet<string> = new Set(
  Object.values(SCHEDULE_FIELD_CATEGORY_KEYS),
);

/**
 * 排班畫面的下拉選項(崗位、執行任務、特殊日類別…):欄位管理類別的合併清單(只列啟用的)。
 * 範圍沿用欄位管理的規則(全域 + 上層 + 自己 + 看得到的下層,`fields/field-visibility.ts`);
 * 只收排班的類別 key(`@repo/domain/project/schedule-fields`),其他類別 → `VALIDATION_FAILED`。
 */
@Injectable()
export class ScheduleFieldOptionsService {
  constructor(
    private readonly categories: FieldCategoriesRepository,
    private readonly fields: FieldsRepository,
    private readonly orgs: OrgsRepository,
  ) {}

  async options(
    operator: OperatorContext,
    categoryKey: string,
  ): Promise<ScheduleFieldOptionModel[]> {
    if (!SCHEDULE_CATEGORY_KEYS.has(categoryKey)) {
      throw validationError(`not a schedule category: ${categoryKey}`, [
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
    const options = await this.fields.findMany(
      fieldReadContext(operator),
      { categoryId: category._id, enabled: true, ...scopeFilterOf(visibility) },
      { sort: { order: 1, createdAt: 1 } },
    );
    return options.map((option) => ({
      value: option.value,
      label: option.label,
    }));
  }

  /**
   * 驗下拉值:每個值都要是該類別(操作者看得到的合併清單裡)**啟用中**的選項;
   * 不是的欄位一起回 `VALIDATION_FAILED`(欄位去重、照檢查的順序)。
   */
  async assertOptions(
    operator: OperatorContext,
    checks: readonly ScheduleOptionCheck[],
  ): Promise<void> {
    const byCategory = new Map<string, Set<string>>();
    for (const categoryKey of new Set(
      checks.map((check) => check.categoryKey),
    )) {
      const options = await this.options(operator, categoryKey);
      byCategory.set(
        categoryKey,
        new Set(options.map((option) => option.value)),
      );
    }
    const invalid = [
      ...new Set(
        checks
          .filter(
            (check) =>
              byCategory.get(check.categoryKey)?.has(check.value) !== true,
          )
          .map((check) => check.field),
      ),
    ];
    if (invalid.length > 0) {
      throw validationError(
        `not an enabled option: ${invalid.join(", ")}`,
        invalid,
      );
    }
  }
}
