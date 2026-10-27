import { Injectable } from "@nestjs/common";

import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";

import type { OperatorContext } from "../../../database/operator-context";
import { FieldOptionsService } from "../../../fields/field-options.service";
import { SCHEDULE_REASONS, validationError } from "../shared/schedule-error";
import type { ScheduleFieldOptionModel } from "./schedule-field-option.model";

/** 一個要驗的下拉值:哪個類別、值、錯誤時標回哪個欄位。 */
export interface ScheduleOptionCheck {
  categoryKey: string;
  value: string;
  field: string;
}

/** 排班可讀的欄位管理類別(`@repo/domain/project/schedule-fields`;底座 `FieldOptionsService` 的白名單)。 */
const SCHEDULE_FIELD_CATEGORIES: readonly string[] = Object.values(
  SCHEDULE_FIELD_CATEGORY_KEYS,
);

/**
 * 排班畫面的下拉選項(崗位、執行任務、特殊日類別…):讀選項用底座的 `FieldOptionsService.optionsOf`
 * (欄位管理的合併範圍、只列啟用的),類別白名單是排班的類別 key,其他類別 → `VALIDATION_FAILED`。
 * 本服務只多一個排班要的「一次驗多個下拉值」(`assertOptions`)。
 */
@Injectable()
export class ScheduleFieldOptionsService {
  constructor(private readonly fieldOptions: FieldOptionsService) {}

  options(
    operator: OperatorContext,
    categoryKey: string,
  ): Promise<ScheduleFieldOptionModel[]> {
    return this.fieldOptions.optionsOf(
      operator,
      categoryKey,
      SCHEDULE_FIELD_CATEGORIES,
    );
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
        SCHEDULE_REASONS.optionDisabled,
      );
    }
  }
}
