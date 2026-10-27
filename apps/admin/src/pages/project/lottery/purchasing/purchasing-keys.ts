/**
 * 叫貨與進貨 → 叫貨、採購單(`purchasing.requisition`)前端的常數(權限表正本 `docs/modules/project/purchasing.md`)。
 * 模組 key、表單代號、欄位 key 與 api / seed 同一份(`@repo/domain/project/lottery`)。
 */
export {
  REQUISITION_FIELD_KEYS,
  REQUISITION_FORM_KEY,
  REQUISITION_MODULE_KEY,
} from "@repo/domain/project/lottery";

/** 頁內權限。 */
export const REQUISITION_PERMISSIONS = {
  view: "purchasing.requisition.view",
  create: "purchasing.requisition.create",
  purchaseList: "purchasing.requisition.purchase-list",
} as const;

/** 頁內分頁的值(`?tab=`)。 */
export const REQUISITION_TABS = {
  requisitions: "requisitions",
  purchaseList: "purchase-list",
} as const;

/** 叫貨單列表的篩選放網址 `?requisitions=`(REACT-14):狀態、頁碼。 */
export const REQUISITION_LIST_KEY = "requisitions";

/** 列表每頁筆數。 */
export const REQUISITION_PAGE_SIZE = 20;

/** 金額 / 張數的千分位。 */
export const formatCount = (value: number): string =>
  value.toLocaleString("en-US");
