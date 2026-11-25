import { z } from "zod";

import { useMe } from "@/hooks/base/useMe";
import { useUrlState } from "@/hooks/base/useUrlState";

/**
 * 庫存分頁的篩選放同一個 key(REACT-14):分店、遊戲、狀態、批購日起迄、本號、來源、第幾頁;空字串 = 預設 / 不篩。
 * 頁首 [期初建檔] 讀同一個 key 的分店(`useStockOrgId`)。
 */
export const stockSchema = z
  .object({
    org: z.string().default(""),
    game: z.string().default(""),
    state: z.string().default(""),
    from: z.string().default(""),
    to: z.string().default(""),
    bookNo: z.string().default(""),
    source: z.string().default(""),
    page: z.number().int().min(1).default(1),
  })
  .default({
    org: "",
    game: "",
    state: "",
    from: "",
    to: "",
    bookNo: "",
    source: "",
    page: 1,
  });

/** 庫存分頁選的分店(沒選 = 目前組織);頁首 [期初建檔] 用。 */
export const useStockOrgId = (): string => {
  const me = useMe();
  const [filters] = useUrlState("stock", stockSchema);
  return filters.org === "" ? (me.data?.me.currentOrg?.id ?? "") : filters.org;
};
