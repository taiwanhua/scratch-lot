import { z } from "zod";

/**
 * 遊戲列表的篩選(網址 `?games=`,REACT-14):狀態、面額、關鍵字、頁碼。
 * 狀態預設「販售中」(Figma MD-01 的預設值);空字串 = 全部。
 */
export const gamesListSchema = z
  .object({
    status: z.enum(["", "on_sale", "discontinued"]).default("on_sale"),
    unitPrice: z.number().int().min(1).nullable().default(null),
    keyword: z.string().default(""),
    page: z.number().int().min(1).default(1),
  })
  .default({ status: "on_sale", unitPrice: null, keyword: "", page: 1 });

export type GamesListFilters = z.infer<typeof gamesListSchema>;

export const GAMES_LIST_KEY = "games";
