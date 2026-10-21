import { z } from "zod";

import { LotteryContactRole, LotteryContactStatus } from "@repo/graphql";

/**
 * 三個分頁的列表篩選存在網址的哪個 key(REACT-14)。同印表機管理:三個分頁共用這一個 key,
 * 同一時間只有一個分頁的列表在畫面上,切分頁時清回預設(`DealersPage`)。
 */
export const DEALERS_LIST_KEY = "list";

/**
 * 甲類:見簽狀態、距上次批購、證照、頁碼。快速篩選(逾 150 / 180 天、本季未見簽)只是把
 * 對應的篩選設成那個值,不另外存。
 */
export const classAListSchema = z
  .object({
    signin: z.enum(["all", "signed", "unsigned"]).default("all"),
    purchase: z.enum(["all", "150", "180"]).default("all"),
    license: z.enum(["all", "expiring", "expired"]).default("all"),
    page: z.number().int().min(1).default(1),
  })
  .default({ signin: "all", purchase: "all", license: "all", page: 1 });

export type ClassAListFilters = z.infer<typeof classAListSchema>;

/** 乙類:頁碼。 */
export const classBListSchema = z
  .object({ page: z.number().int().min(1).default(1) })
  .default({ page: 1 });

/** 關係人:身分、狀態、關鍵字、頁碼。 */
export const contactsListSchema = z
  .object({
    role: z.enum(LotteryContactRole).nullable().default(null),
    status: z.enum(LotteryContactStatus).nullable().default(null),
    keyword: z.string().default(""),
    page: z.number().int().min(1).default(1),
  })
  .default({ role: null, status: null, keyword: "", page: 1 });
