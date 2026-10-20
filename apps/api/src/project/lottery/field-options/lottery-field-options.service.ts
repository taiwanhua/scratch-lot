import { Injectable } from "@nestjs/common";
import { GraphQLError } from "graphql";

import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";
import { requiresReasonNote } from "@repo/domain/project/reason-note";

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
import type { LotteryFieldOptionModel } from "./lottery-field-option.model";

const LOTTERY_CATEGORY_KEYS: ReadonlySet<string> = new Set(
  Object.values(LOTTERY_FIELD_CATEGORY_KEYS),
);

function validationError(message: string, fields: string[]): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "VALIDATION_FAILED", fields },
  });
}

/** 原因與說明(欄位管理的原因類別;選「其他」說明必填)。 */
export interface LotteryReasonInput {
  reasonKey?: string | null;
  reasonNote?: string | null;
}

/** 檢查後的原因:去頭尾空白、空字串 = null。 */
export interface LotteryReason {
  reasonKey: string;
  reasonNote: string | null;
}

const blankToNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

/**
 * 刮刮樂畫面的下拉選項(尋回原因、報廢原因、更正跳號原因…;類別 key 見
 * `@repo/domain/project/lottery-fields`):欄位管理類別的合併清單(只列啟用的)。
 * 範圍沿用欄位管理的規則(全域 + 上層 + 自己 + 看得到的下層,`fields/field-visibility.ts`);
 * 只收刮刮樂的類別 key,其他類別 → `VALIDATION_FAILED`。排班的同一套在 `ScheduleFieldOptionsService`
 * (排班不得 import 刮刮樂,所以各一份)。
 */
@Injectable()
export class LotteryFieldOptionsService {
  constructor(
    private readonly categories: FieldCategoriesRepository,
    private readonly fields: FieldsRepository,
    private readonly orgs: OrgsRepository,
  ) {}

  async options(
    operator: OperatorContext,
    categoryKey: string,
  ): Promise<LotteryFieldOptionModel[]> {
    if (!LOTTERY_CATEGORY_KEYS.has(categoryKey)) {
      throw validationError(`not a lottery category: ${categoryKey}`, [
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
   * 原因必填:要是該類別(操作者看得到的合併清單裡)**啟用中**的選項;選「其他」說明必填。
   * 不合 → `VALIDATION_FAILED`(`fields: ["reasonKey"]` / `["reasonNote"]`)。
   */
  async assertReason(
    operator: OperatorContext,
    categoryKey: string,
    input: LotteryReasonInput,
  ): Promise<LotteryReason> {
    const reasonKey = blankToNull(input.reasonKey);
    const reasonNote = blankToNull(input.reasonNote);
    if (reasonKey === null) {
      throw validationError("reason is required", ["reasonKey"]);
    }
    const options = await this.options(operator, categoryKey);
    if (!options.some((option) => option.value === reasonKey)) {
      throw validationError(`not an enabled option: ${reasonKey}`, [
        "reasonKey",
      ]);
    }
    if (requiresReasonNote(reasonKey) && reasonNote === null) {
      throw validationError("reasonNote is required for other", ["reasonNote"]);
    }
    return { reasonKey, reasonNote };
  }
}
