import { DemoItemOneStatus, UploadPurpose } from "@repo/graphql";

/**
 * 示範模組1 的**常數**(模組 key、權限 key、i18n namespace、欄位定義、上傳規則)。
 *
 * 組成共用元件吃的設定物件那一步在 `demo-sample-one-module.tsx`
 * (`DemoModuleConfig`,介面與 JSDoc 見 `shared/demo-module-config.ts`);
 * 常數單獨一份是因為 mock 模式的夾具與測試也要用,那兩邊不該把整個設定物件(含 React 元件)拉進去。
 *
 * 規則正本:`docs/modules/demo.sub.sample-one.md`(模組樹 / 權限表 / api 介面);
 * seed 正本:`apps/db-migrator/seeds/base/modules/demo.sub.sample-one.ts`。
 */

/** 列表頁(link)的模組 key;三個隱藏頁掛在它底下。 */
export const SAMPLE_ONE_MODULE_KEY = "demo.sub.sample-one";

/**
 * 四個模組 key = 四個頁面(ADR-0011「模組 = 頁面」)。
 * `module-pages.tsx` 四個 key 各登記一個元件;**沒綁該模組就進不去**,連帶「進入那一頁的按鈕」也不顯示。
 */
export const SAMPLE_ONE_MODULE_KEYS = {
  list: SAMPLE_ONE_MODULE_KEY,
  viewPage: `${SAMPLE_ONE_MODULE_KEY}.view-page`,
  createPage: `${SAMPLE_ONE_MODULE_KEY}.create-page`,
  editPage: `${SAMPLE_ONE_MODULE_KEY}.edit-page`,
} as const;

/**
 * 權限 key(正本見模組文件的權限表;判斷走 ADR-0011「頁內功能」)。
 *
 * **逐列的 `canEdit` / `canDelete` / `canEditInternalNote` 不在這裡** —— 那三個由 api 算在
 * `item.abilities` 上、已含權限判斷,前端直接用,不要再與 `usePermissions` 相乘(模組文件「回傳欄位的語意」)。
 * 這裡列的是「整頁層級」才問得到的:新增鈕、內部備註欄要不要渲染、兩個頁面自有區塊。
 */
export const SAMPLE_ONE_PERMISSIONS = {
  view: `${SAMPLE_ONE_MODULE_KEY}.view`,
  create: `${SAMPLE_ONE_MODULE_KEY}.create`,
  showInternalNote: `${SAMPLE_ONE_MODULE_KEY}.show-internal-note`,
  editInternalNote: `${SAMPLE_ONE_MODULE_KEY}.edit-internal-note`,
  showTips: `${SAMPLE_ONE_MODULE_KEYS.createPage}.show-tips`,
  showHistory: `${SAMPLE_ONE_MODULE_KEYS.editPage}.show-history`,
} as const;

/**
 * 分類下拉的選項來源:欄位管理的「示範分類」(`docs/modules/field-manager.md`「api 介面」)。
 * `fieldCategories` / `fields` 兩個 query 都掛在 `system.field-manager.view` 底下,
 * 所以沒有那個權限的人拿不到選項 —— 列表的分類篩選整個不顯示、表單的分類欄退成唯讀(見 `useDemoCategoryOptions`)。
 */
export const DEMO_CATEGORY_KEY = "demo-category";
export const FIELD_MANAGER_VIEW_PERMISSION = "system.field-manager.view";

/** i18n 的第二層 key(I18N-02);三頁共用同一個 namespace。 */
export const SAMPLE_ONE_I18N = "admin.demoSampleOne";

/** 列表每頁筆數(api `DemoItemsOneInput.pageSize` 上限 100)。 */
export const SAMPLE_ONE_PAGE_SIZE = 10;

/** 表格最小寬度(STYLE-11:六欄不折行的合理寬度)。 */
export const SAMPLE_ONE_TABLE_MIN_WIDTH = 960;

/** 狀態下拉的選項順序(值的正本是 seed 的資料範圍宣告與 schema 的 `status`)。 */
export const SAMPLE_ONE_STATUSES = [
  DemoItemOneStatus.Draft,
  DemoItemOneStatus.Published,
  DemoItemOneStatus.Archived,
] as const;

/**
 * 上傳規則(ADR-0010;**api 正本** `apps/api/src/storage/upload-rules.ts` 的 `UPLOAD_RULES`)。
 * 封面走公開 bucket(回穩定 URL,可直接放 `<img src>`),附件走私有 bucket(下載時才現簽)。
 *
 * 兩者的規則不同,而且要跟著 api 那一份走 —— 前端的 `accept` / `maxSize` 只是先擋一手,
 * 真正把關的是 `createUploadUrl`(不合就在那一步回 `UPLOAD_REJECTED`):
 * - **封面**:圖片 + 2MB(公開的東西刻意收得緊)
 * - **附件**:圖片 + pdf / doc(x) / xls(x) / zip + 20MB(已放寬;設計稿畫的 pdf 附件現在收得了)
 */
export const SAMPLE_ONE_UPLOAD = {
  cover: {
    purpose: UploadPurpose.DemoCover,
    accept: ["image/png", "image/jpeg", "image/webp"] as readonly string[],
    maxSize: 2 * 1024 * 1024,
  },
  attachment: {
    purpose: UploadPurpose.DemoAttachment,
    accept: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/zip",
      // Windows 的檔案總管壓出來的 zip 走這個 content type,不收就等於 Windows 使用者傳不了
      "application/x-zip-compressed",
    ] as readonly string[],
    maxSize: 20 * 1024 * 1024,
  },
} as const;
