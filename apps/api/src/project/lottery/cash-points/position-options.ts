import type { Types } from "mongoose";

import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";

import type {
  FieldCategoriesRepository,
  FieldsRepository,
} from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { fieldReadContext } from "../../../fields/field-visibility";

/** 收銀點的「對應崗位」= 欄位管理「崗位」類別(專案 seed;排班與刮刮樂共用)。 */
export const POSITION_CATEGORY_KEY = SCHEDULE_FIELD_CATEGORY_KEYS.position;

export interface PositionOption {
  value: string;
  label: string;
}

/**
 * 某家分店看得到的崗位選項:全域種子 + 這家分店的上層(一路到租戶頂層)+ 自己加的,
 * 只取啟用中的,依欄位管理的排序值排。規則同欄位管理的「上層繼承」(`fields/field-visibility.ts`):
 * 祖先不在可見範圍內,所以讀取改用 `fieldReadContext` 並把 orgId 釘在這條鏈上。
 *
 * 選項清單與送出時的驗證共用這一支 —— 列得出來的就送得進去。類別不存在(seed 未跑)→ 空清單。
 */
export async function positionOptionsOf(
  operator: OperatorContext,
  org: { _id: Types.ObjectId; ancestors: readonly Types.ObjectId[] },
  repositories: {
    categories: FieldCategoriesRepository;
    fields: FieldsRepository;
  },
): Promise<PositionOption[]> {
  const category = await repositories.categories.findOne(operator, {
    key: POSITION_CATEGORY_KEY,
  });
  if (!category) {
    return [];
  }
  const options = await repositories.fields.findMany(
    fieldReadContext(operator),
    {
      categoryId: category._id,
      enabled: true,
      orgId: { $in: [null, ...org.ancestors, org._id] },
    },
    { sort: { order: 1, createdAt: 1 } },
  );
  const seen = new Set<string>();
  return options.flatMap((option) => {
    if (seen.has(option.value)) {
      return [];
    }
    seen.add(option.value);
    return [{ value: option.value, label: option.label }];
  });
}
