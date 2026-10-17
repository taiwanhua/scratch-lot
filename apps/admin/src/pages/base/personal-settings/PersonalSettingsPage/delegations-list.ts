import { z } from "zod";

/** 個人設定的分頁值(`?tab=`);不帶或認不得 → 第一個分頁(偏好)。 */
export const PERSONAL_SETTINGS_TABS = {
  preferences: "preferences",
  delegations: "delegations",
} as const;

/** 代理人清單的頁碼存在網址的哪個 key(REACT-14);切分頁時清回預設。 */
export const DELEGATIONS_LIST_KEY = "list";

export const delegationsListSchema = z
  .object({ page: z.number().int().min(1).default(1) })
  .default({ page: 1 });

/** 每頁筆數(api 上限 100)。 */
export const DELEGATIONS_PAGE_SIZE = 20;
