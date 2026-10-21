/**
 * `@repo/domain/form` 的出口檔(bunchee 由 `exports` 名反推本檔;GEN-01 的 packages 邊界例外)。
 * 表單引擎的純邏輯(見 `docs/concepts/form-engine.md`),前後端共用:
 *
 * - `types.ts`:FieldDef / Layout / SummaryMap / Prefill / lookup 來源描述 / 表達式與上下文
 * - `keys.ts`:表單 key、欄位 key(含保留字)、租戶短碼、欄位類別 key 的格式(不依賴外部套件)
 * - `semantic.ts`:存值 → 語意值(表達式 `var` 看到的)與選項顯示名
 * - `expression-shape.ts` / `expression.ts`:表達式白名單與上限、JSONLogic + decimal 計算器
 * - `expression-types.ts`:表達式型別表(運算子參數 / 回傳、欄位與系統值的型別;設計器型別導向選擇器用)
 * - `compute.ts` / `dependencies.ts`:計算欄位求值(拓樸順序、最終取位)、受保護依賴鏈
 * - `visibility.ts`:顯示條件與計算的收斂(隱藏的欄位當 null 算;前端預覽與 api 寫入共用)
 * - `layout.ts`、`summary.ts`:版面換算、摘要槽快照
 * - `validate-*.ts`、`issues.ts`、`registry.ts`:定義檢查器與它的登錄表
 * - `values.ts`:提交值的型別正規化與規則驗證(存草稿只驗型別、送出再驗規則)
 * - `template.ts`:顯示模板(頁籤 / 標題模板、lookup `labelTemplate`)的佔位符解析、套用與欄位值的模板文字
 * - `list-settings.ts`:列表欄位配置(`modules.settings.list`)的內建欄開關
 * - `serial.ts`:單號格式(前綴 / 期間 / 位數 / 分隔符)的檢查、期間鍵與組字
 * - `temporal.ts`:日期 / 日期時間的單一入口(時點 `toInstant`、租戶時區的當地日期、日曆加減、`formatTemporal`)
 * - `defaults.ts`:欄位預設值的計算(api 建草稿填空欄、admin 沒碰過的欄位跟著重算)
 * - `upload.ts`:上傳欄的檔型 / 大小上限(平台上限 + 欄位收窄)
 * - `upgrade.ts`:提交的值從一版搬到另一版(舊版資料升級、複製為新單共用)與升級的補值欄位
 * - `void-reason.ts`:原因類別(作廢原因等)的「其他」選項值
 * - `array.ts` / `array-diff.ts`:明細列(`array`)的上限、子欄白名單、`rowId`、列數範圍與以 `rowId` 對列的修訂差異
 */
export * from "./array";
export * from "./array-diff";
export * from "./compute";
export * from "./defaults";
export * from "./dependencies";
export * from "./expression";
export * from "./expression-shape";
export * from "./expression-types";
export * from "./issues";
export * from "./keys";
export * from "./layout";
export * from "./list-settings";
export * from "./lookup-filter";
export * from "./registry";
export * from "./semantic";
export * from "./serial";
export * from "./summary";
export * from "./temporal";
export * from "./template";
export * from "./types";
export * from "./upgrade";
export * from "./upload";
export * from "./validate-definition";
export { REFERENCE_DEFAULT_PATHS, defaultKindsOf } from "./validate-defaults";
export * from "./values";
export * from "./void-reason";
export * from "./visibility";
export {
  FORM_SUBMISSION_PROVIDER,
  PATTERN_FLAGS,
  type RegexSafetyCheck,
  isPrefillCompatible,
} from "./validate-fields";
