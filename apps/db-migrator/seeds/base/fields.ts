import {
  type SeedDocument,
  type SeedDocumentSet,
  seedRef,
} from "../../src/seed/seed-declaration";
import {
  DEMO_CATEGORY_KEY,
  GENDER_CATEGORY_KEY,
  REPRINT_REASON_CATEGORY_KEY,
} from "./field-categories";
import { ROOT_ORG_KEY } from "./orgs";

interface FieldOption {
  value: string;
  label: string;
}

/**
 * 一個類別下的全域選項:key = `<類別 key>.<value>`(同權限 key 以「.」分層),
 * order 依宣告順序 1 起算;categoryId 於執行時由類別 key 解析成該環境的 _id。
 */
function globalOptions(
  categoryKey: string,
  options: FieldOption[],
): SeedDocument[] {
  return options.map(({ value, label }, index) => ({
    key: `${categoryKey}.${value}`,
    data: {
      categoryId: seedRef("field_categories", categoryKey),
      orgId: null,
      value,
      label,
      order: index + 1,
      enabled: true,
    },
  }));
}

/**
 * 全域欄位選項(orgId=null,ADR-0005;seed 選項僅 enabled 可改、不可刪)。
 * 內容正本:docs/modules/field-manager.md「種子內容」— 示範畫面上的「甜點」是租戶自訂示意,不是種子。
 *
 * **認養**:root 在畫面建的選項沒有種子 key(`orgId` = 根組織),所以以 key 找不到時,
 * 改找「同類別、同 value、根組織加的、`isSystem: false`」那一筆認養成全域種子(`_id` 不動);
 * 租戶的自訂選項與 root 加的其他選項不碰。
 */
export const fields: SeedDocumentSet = {
  kind: "documents",
  collection: "fields",
  adoptBy: {
    fields: ["categoryId", "value"],
    where: { isSystem: false, orgId: seedRef("orgs", ROOT_ORG_KEY) },
  },
  entries: [
    ...globalOptions(GENDER_CATEGORY_KEY, [
      { value: "male", label: "男" },
      { value: "female", label: "女" },
      { value: "other", label: "其他" },
      { value: "undisclosed", label: "不透露" },
    ]),
    ...globalOptions(DEMO_CATEGORY_KEY, [
      { value: "staple", label: "主食" },
      { value: "side-dish", label: "小菜" },
      { value: "drink", label: "飲品" },
    ]),
    // 補印原因:值與 `@repo/domain/printing` 的 `REPRINT_REASONS` 一致(`other` = 說明必填)
    ...globalOptions(REPRINT_REASON_CATEGORY_KEY, [
      { value: "lost", label: "遺失" },
      { value: "damaged", label: "破損" },
      { value: "other", label: "其他" },
    ]),
  ],
};
