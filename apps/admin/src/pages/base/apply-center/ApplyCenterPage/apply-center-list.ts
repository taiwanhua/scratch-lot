import { z } from "zod";

import { FormSubmissionStatus } from "@repo/graphql";

/**
 * 申請中心列表的篩選存在網址的哪個 key(網址列:`?tab=mine&list={"form":…,"status":…,"page":1}`)。
 * 兩個分頁共用這一個 key:同一時間只有一個分頁的列表在畫面上,切分頁時清回預設(`ApplyCenterPage`),
 * 不會把「我的申請」的狀態篩選帶進「待我審核」。
 */
export const APPLY_CENTER_LIST_KEY = "list";

/** 「待我審核」的待處理 / 已處理。 */
export type DoneFilter = "pending" | "done";

/** 「我的申請」:模組、表單、狀態、頁碼。 */
export const myApplicationsListSchema = z
  .object({
    module: z.string().nullable().default(null),
    form: z.string().nullable().default(null),
    status: z.enum(FormSubmissionStatus).nullable().default(null),
    page: z.number().int().min(1).default(1),
  })
  .default({ module: null, form: null, status: null, page: 1 });

/** 「待我審核」:模組、表單、待處理 / 已處理、頁碼。 */
export const myTasksListSchema = z
  .object({
    module: z.string().nullable().default(null),
    form: z.string().nullable().default(null),
    done: z.enum(["pending", "done"]).default("pending"),
    page: z.number().int().min(1).default(1),
  })
  .default({ module: null, form: null, done: "pending", page: 1 });
