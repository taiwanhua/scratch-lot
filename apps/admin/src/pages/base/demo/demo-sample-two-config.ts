/**
 * 示範模組2 的**常數**(模組 key、權限 key、i18n namespace)。
 *
 * 對照組,所以這一份特別短:沒有欄位級權限、沒有頁面自有權限、沒有上傳、沒有分類與狀態。
 * 組成設定物件那一步在 `SampleTwoModule.tsx`。
 *
 * 規則正本:`docs/modules/demo.sample-two.md`;seed 正本:`apps/db-migrator/seeds/base/modules/demo.sample-two.ts`。
 */

/** 列表頁(link)的模組 key;三個隱藏頁掛在它底下。 */
export const SAMPLE_TWO_MODULE_KEY = "demo.sample-two";

/** 四個模組 key = 四個頁面(ADR-0011「模組 = 頁面」)。 */
export const SAMPLE_TWO_MODULE_KEYS = {
  list: SAMPLE_TWO_MODULE_KEY,
  viewPage: `${SAMPLE_TWO_MODULE_KEY}.view-page`,
  createPage: `${SAMPLE_TWO_MODULE_KEY}.create-page`,
  editPage: `${SAMPLE_TWO_MODULE_KEY}.edit-page`,
} as const;

/**
 * 權限 key。對照組只有基本四筆(view / create / edit / delete),**而且整頁層級只用得到兩筆** ——
 * 編輯與刪除是逐列的,一律讀 api 給的 `item.abilities`(已含權限判斷),不與 `usePermissions` 相乘。
 *
 * 六個端點只用到四個 key(停用 / 啟用守 `.edit`),這本身就是「權限與端點不必一一對應」的示範
 * (模組文件「為什麼停用 / 啟用守 `.edit`」)。
 */
export const SAMPLE_TWO_PERMISSIONS = {
  view: `${SAMPLE_TWO_MODULE_KEY}.view`,
  create: `${SAMPLE_TWO_MODULE_KEY}.create`,
  /** 「共用給」欄位:新增時要有它才出現(編輯時讀 `item.abilities.canEdit`) */
  edit: `${SAMPLE_TWO_MODULE_KEY}.edit`,
} as const;

/** i18n 的第二層 key(I18N-02);三頁共用同一個 namespace。 */
export const SAMPLE_TWO_I18N = "admin.demoSampleTwo";

/** 列表每頁筆數(api `DemoItemsTwoInput.pageSize` 預設 20 上限 100)。 */
export const SAMPLE_TWO_PAGE_SIZE = 10;

/** 表格最小寬度(STYLE-11:四欄不折行的合理寬度;比示範模組1 少兩欄所以窄)。 */
export const SAMPLE_TWO_TABLE_MIN_WIDTH = 720;
