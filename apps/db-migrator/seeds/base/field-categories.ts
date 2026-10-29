import { VOID_REASON_CATEGORY_KEY } from "@repo/domain/form";

import type {
  SeedDocument,
  SeedDocumentSet,
} from "../../src/seed/seed-declaration";

export const GENDER_CATEGORY_KEY = "gender";
export const DEMO_CATEGORY_KEY = "demo-category";
/** 補印原因(列印的補印對話框;`@repo/domain/printing` 的 `REPRINT_REASON_CATEGORY_KEY`)。 */
export const REPRINT_REASON_CATEGORY_KEY = "reprint-reason";

/**
 * 一個系統類別的宣告。名稱與說明是「每次都 seed 的欄位」—— 說明沒寫就同步成 `null`,
 * 認養 root 在畫面建的同 key 類別時,名稱 / 說明才會以 seed 為準;`enabled` 是初始 seed 值的欄位(ADR-0002)。
 */
function category(
  key: string,
  name: string,
  description: string | null = null,
): SeedDocument {
  return { key, data: { name, description, enabled: true } };
}

/**
 * 欄位類別(母檔;全域資料,ADR-0005)。內容正本:docs/modules/field-manager.md「種子內容」。
 *
 * 類別有兩個來源:這裡宣告的**系統類別**(跨環境同步,底座 / 模組固定要用的),與 root 在
 * 欄位管理畫面新增的類別(只在該環境)。畫面建的類別要固定下來就在這裡宣告同一個 key ——
 * seed 以 key **認養**那一筆(`isSystem` 改 true、名稱 / 說明以 seed 為準、`_id` 不動)。
 * 沒宣告的畫面類別 seed 一律不碰。
 */
export const fieldCategories: SeedDocumentSet = {
  kind: "documents",
  collection: "field_categories",
  entries: [
    category(GENDER_CATEGORY_KEY, "性別"),
    category(DEMO_CATEGORY_KEY, "示範分類"),
    category(
      REPRINT_REASON_CATEGORY_KEY,
      "補印原因",
      "列印的補印原因;選「其他」時補印說明必填(docs/modules/printers.md)",
    ),
    category(
      VOID_REASON_CATEGORY_KEY,
      "作廢原因",
      "表單作廢的原因(表單設定 voidReasonCategoryKey 指到它);選「其他」時作廢說明必填(docs/modules/forms.md)",
    ),
  ],
};
