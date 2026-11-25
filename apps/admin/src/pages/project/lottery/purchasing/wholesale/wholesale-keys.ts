import { z } from "zod";

import { WHOLESALE_PAYMENT_MODE } from "@repo/domain/project/lottery";
import { FormSubmissionStatus } from "@repo/graphql";

/**
 * 叫貨與進貨 → 批售單(`purchasing.wholesale`)前端的常數(權限表正本 `docs/modules/project/purchasing.md`「批售單」)。
 * 模組 key、表單代號、欄位 key、權限與 api / seed 同一份(`@repo/domain/project/lottery`)。
 */
export {
  WHOLESALE_FIELD_KEYS,
  WHOLESALE_FORM_KEY,
  WHOLESALE_MODULE_KEY,
  WHOLESALE_PAYMENT_MODE,
  WHOLESALE_PERMISSIONS,
} from "@repo/domain/project/lottery";

/** 批售單列表的篩選放網址 `?wholesales=`(REACT-14)。 */
export const WHOLESALE_LIST_KEY = "wholesales";

/** 列表每頁筆數。 */
export const WHOLESALE_PAGE_SIZE = 20;

/** 收款方式的選項順序。 */
export const WHOLESALE_PAYMENT_MODES = [
  WHOLESALE_PAYMENT_MODE.collectFirst,
  WHOLESALE_PAYMENT_MODE.autoBank,
] as const;

/** 列表的篩選:狀態(含草稿)、出貨分店、批售客戶、收款方式、頁碼。 */
export const wholesaleListSchema = z
  .object({
    status: z.enum(FormSubmissionStatus).nullable().default(null),
    fromOrgId: z.string().nullable().default(null),
    customerId: z.string().nullable().default(null),
    paymentMode: z.enum(WHOLESALE_PAYMENT_MODES).nullable().default(null),
    page: z.number().int().min(1).default(1),
  })
  .default({
    status: null,
    fromOrgId: null,
    customerId: null,
    paymentMode: null,
    page: 1,
  });

export type WholesaleListFilters = z.infer<typeof wholesaleListSchema>;

/** 金額 / 張數的千分位。 */
export const formatMoney = (value: number): string =>
  value.toLocaleString("en-US");

/** 顯示用本號(開頭 0 去掉)。 */
export const displayBookNo = (bookNo: string): string =>
  bookNo.replace(/^0/, "");
