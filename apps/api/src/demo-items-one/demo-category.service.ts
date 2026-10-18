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
import { validationError } from "./demo-items-one-error";

/**
 * 欄位管理的「示範分類」類別 key(seed 正本 `apps/db-migrator/seeds/base/field-categories.ts`)。
 */
export const DEMO_CATEGORY_KEY = "demo-category";

/** value → 顯示名稱;清單一次查完後用它把每一列的 `categoryLabel` 填上(不逐列查)。 */
export type DemoCategoryOptions = ReadonlyMap<string, string>;

/**
 * 示範項目的 `category` 是**欄位管理**的選項值,不是自由字串。
 *
 * 可選的範圍 = 欄位管理的**合併範圍**(規則正本 `docs/modules/field-manager.md`:
 * 全域種子 + 上層組織自訂 + 當前組織自訂 + 可見範圍內的下層自訂)且 `enabled` —— 判斷直接沿用
 * `fields/field-visibility.ts`,不在本模組重寫一份範圍規則(兩份一定會走偏)。
 *
 * 種子類別不存在(seed 未跑)時視同「沒有任何選項」:所有非空的 `category` 都會被擋下,
 * 這比靜默放行安全(fail-closed)。
 */
@Injectable()
export class DemoCategoryService {
  constructor(
    private readonly fields: FieldsRepository,
    private readonly categories: FieldCategoriesRepository,
    private readonly orgs: OrgsRepository,
  ) {}

  /** 操作者此刻選得到的「示範分類」選項(value → label)。 */
  async options(operator: OperatorContext): Promise<DemoCategoryOptions> {
    const category = await this.categories.findOne(operator, {
      key: DEMO_CATEGORY_KEY,
    });
    if (!category) {
      return new Map();
    }
    const visibility = await resolveFieldVisibility(operator, this.orgs);
    const found = await this.fields.findMany(fieldReadContext(operator), {
      categoryId: category._id,
      enabled: true,
      ...scopeFilterOf(visibility),
    });
    return new Map(found.map((field) => [field.value, field.label]));
  }

  /**
   * 驗一個寫入的分類值:不在合併範圍內或已停用 → `VALIDATION_FAILED`,`fields: ["category"]`。
   * `null` / 空白 = 不分類(合法);回傳去空白後要落庫的值(`null` = 清空)。
   */
  assertSelectable(
    options: DemoCategoryOptions,
    value: string | null | undefined,
  ): string | null {
    const trimmed = value?.trim() ?? "";
    if (trimmed === "") {
      return null;
    }
    if (!options.has(trimmed)) {
      throw validationError(
        `category is not a selectable option of "${DEMO_CATEGORY_KEY}": ${trimmed}`,
        ["category"],
      );
    }
    return trimmed;
  }
}
