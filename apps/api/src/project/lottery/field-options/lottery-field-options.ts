import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";

/**
 * 刮刮樂可讀的欄位管理類別(`@repo/domain/project/lottery-fields`):底座 `FieldOptionsService.optionsOf` /
 * `assertReason` 的類別白名單。不在這份的類別 → `VALIDATION_FAILED`(`fields: ["categoryKey"]`)。
 */
export const LOTTERY_FIELD_CATEGORIES: readonly string[] = Object.values(
  LOTTERY_FIELD_CATEGORY_KEYS,
);
