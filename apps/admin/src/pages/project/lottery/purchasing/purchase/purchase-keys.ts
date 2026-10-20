/**
 * 叫貨與進貨 → 進貨單(`purchasing.purchase`)前端的常數(權限表正本 `docs/modules/project/purchasing.md`「進貨單」)。
 * 模組 key、表單代號、欄位 key、權限與 api / seed 同一份(`@repo/domain/project/lottery`)。
 */
import { PURCHASE_MODULE_KEY } from "@repo/domain/project/lottery";

export {
  PURCHASE_FIELD_KEYS,
  PURCHASE_FORM_KEY,
  PURCHASE_MODULE_KEY,
  PURCHASE_PERMISSIONS,
} from "@repo/domain/project/lottery";

/** 進貨單列表的篩選放網址 `?purchases=`(REACT-14):狀態、頁碼。 */
export const PURCHASE_LIST_KEY = "purchases";

/** 列表每頁筆數。 */
export const PURCHASE_PAGE_SIZE = 20;

/** 新增頁從採購清單帶入叫貨單:`?requisition=<單號>&branch=<分店 id>`。 */
export const PURCHASE_FROM_REQUISITION = {
  requisition: "requisition",
  branch: "branch",
} as const;

/** 金額 / 張數的千分位。 */
export const formatMoney = (value: number): string =>
  value.toLocaleString("en-US");

/** 綁了 `purchasing.purchase` 才看得到甲類詳情的「批購紀錄」分頁。 */
export const hasPurchaseModule = (moduleKeys: ReadonlySet<string>): boolean =>
  moduleKeys.has(PURCHASE_MODULE_KEY);
