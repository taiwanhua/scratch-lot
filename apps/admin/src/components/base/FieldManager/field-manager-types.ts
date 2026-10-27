import type { FieldCategoriesQuery, FieldsQuery } from "@repo/graphql";
import type { TableColumn } from "@repo/ui/table";

/**
 * 左欄的一個欄位類別。兩種來源(`isSystem`):開發者在 seed 宣告的系統類別(跨環境同步、不可停用),
 * 與 root 在本頁新增的類別(只在該環境);畫面建的要固定下來就加進 seed、同 key 認養。
 * `enabled = false` 只影響表單設計器的類別清單,既有欄位照常顯示。
 */
export type FieldCategoryLike =
  FieldCategoriesQuery["fieldCategories"]["items"][number];

/** 右表格的一列:合併清單的一筆選項(`source` 決定它是全域還是本組織自訂)。 */
export type FieldOptionLike = FieldsQuery["fields"]["items"][number];

/**
 * 本頁會分流的錯誤碼(正本 `docs/modules/field-manager.md`「api 介面」的「錯誤」節)。
 * `FIELD_VALUE_DUPLICATE` / `FIELD_CATEGORY_KEY_DUPLICATE` 是本模組新增的碼,分別標在
 * 選項彈窗的「值」與類別彈窗的「key」欄位上,不進頁面 Alert。
 * `NOT_OWNER` / `SYSTEM_CATEGORY` / `ROOT_ONLY` 不是獨立的 code,是 `FORBIDDEN` 的 `extensions.reason` ——
 * 本頁把它們當成各自一碼,因為對使用者是不同的話。
 */
export type FieldManagerErrorCode =
  | "FIELD_VALUE_DUPLICATE"
  | "FIELD_CATEGORY_KEY_DUPLICATE"
  | "FORBIDDEN"
  | "NOT_OWNER"
  | "SYSTEM_CATEGORY"
  | "ROOT_ONLY"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "UNEXPECTED";

/**
 * 選項表的擴充欄:依選中的類別產生要多加的欄位(接在「顯示名稱」之後,依陣列順序)。
 * 給客製替換頁用(例:專案的選項顏色欄);欄位內容自己決定能不能改,權限照樣只跟 api 給的列旗標取交集。
 */
export type FieldOptionColumnsSlot = (
  category: FieldCategoryLike,
) => readonly TableColumn<FieldOptionLike>[];
