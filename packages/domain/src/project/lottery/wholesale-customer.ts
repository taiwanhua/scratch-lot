/**
 * 批售客戶(專案規格 21.2;正本 `docs/modules/project/dealers.md`):文字欄位的長度上限(api 檢查與 admin 欄位下的
 * 格式要求共用)與顯示文字。
 */
export const WHOLESALE_CUSTOMER_TEXT_LIMITS = {
  storeName: 30,
  contactName: 10,
  phone: 15,
  address: 60,
  note: 1000,
} as const;

/** 下拉與單據上的文字:「店名 · 電話」;沒填電話只有店名(店名可以重複,靠電話分辨)。 */
export function wholesaleCustomerLabel(customer: {
  storeName: string;
  phone: string | null;
}): string {
  return customer.phone === null
    ? customer.storeName
    : `${customer.storeName} · ${customer.phone}`;
}
