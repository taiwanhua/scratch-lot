/**
 * 叫貨與進貨 → 調貨單(`purchasing.transfer`)前端的常數(權限表正本 `docs/modules/project/purchasing.md`「調貨單」)。
 * 模組 key、表單代號、欄位 key、權限與 api / seed 同一份(`@repo/domain/project/lottery`)。
 */
export {
  TRANSFER_FIELD_KEYS,
  TRANSFER_FORM_KEY,
  TRANSFER_MODULE_KEY,
  TRANSFER_PERMISSIONS,
} from "@repo/domain/project/lottery";

/** 調貨單列表的篩選放網址 `?transfers=`(REACT-14):狀態、頁碼。 */
export const TRANSFER_LIST_KEY = "transfers";

/** 列表每頁筆數。 */
export const TRANSFER_PAGE_SIZE = 20;

/** 新增頁從採購清單帶入叫貨單:`?requisition=<單號>&to=<收貨分店 id>`。 */
export const TRANSFER_FROM_REQUISITION = {
  requisition: "requisition",
  to: "to",
} as const;

/** 金額 / 張數的千分位。 */
export const formatMoney = (value: number): string =>
  value.toLocaleString("en-US");
