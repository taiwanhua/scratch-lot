/**
 * 經銷商與關係人文字欄位的長度上限(專案規格 5.2、5.3;正本 `docs/modules/project/dealers.md`「資料」)。
 * api 的格式檢查(`dealer-validation.ts`)與 admin 欄位下的格式要求(REACT-18)共用同一份。
 */
export const DEALER_TEXT_LIMITS = {
  name: 10,
  storeName: 30,
  businessAddress: 60,
  storePhone: 15,
  terminalNo: 20,
  phone: 15,
  mobile: 15,
  email: 60,
  mailingAddress: 60,
  residentialAddress: 60,
  note: 1000,
} as const;
