import { z } from "zod";

import { PrintJobStatus } from "@repo/graphql";

/**
 * 三個分頁的列表篩選存在網址的哪個 key(REACT-14)。同申請中心:三個分頁共用這一個 key,
 * 同一時間只有一個分頁的列表在畫面上,切分頁時清回預設(`PrintersPage`)。
 */
export const PRINTERS_LIST_KEY = "list";

/** 分頁值(`?tab=`)。 */
export const PRINTERS_TABS = {
  printers: "printers",
  agents: "agents",
  jobs: "jobs",
} as const;

export type PrintersTabValue =
  (typeof PRINTERS_TABS)[keyof typeof PRINTERS_TABS];

/** 印表機分頁的「狀態」篩選:印表機本身啟用 / 停用(api `printers` 的 `enabled`)。 */
export type PrinterEnabledFilter = "all" | "enabled" | "disabled";

/** 印表機分頁:所屬組織、啟用狀態、頁碼。 */
export const printersListSchema = z
  .object({
    org: z.string().nullable().default(null),
    enabled: z.enum(["all", "enabled", "disabled"]).default("all"),
    page: z.number().int().min(1).default(1),
  })
  .default({ org: null, enabled: "all", page: 1 });

/**
 * 代理程式分頁:「顯示已停用」開關(預設關 = 只列啟用中的,底座規格「離線、逾時、重新配對與停用」表)、頁碼。
 * 開關是列表的篩選,所以放網址。
 */
export const agentsListSchema = z
  .object({
    showDisabled: z.boolean().default(false),
    page: z.number().int().min(1).default(1),
  })
  .default({ showDisabled: false, page: 1 });

/** 列印紀錄分頁:印表機、結果、頁碼。 */
export const printJobsListSchema = z
  .object({
    printer: z.string().nullable().default(null),
    status: z.enum(PrintJobStatus).nullable().default(null),
    page: z.number().int().min(1).default(1),
  })
  .default({ printer: null, status: null, page: 1 });

/** 每頁筆數(api 上限 100)。 */
export const PRINTERS_PAGE_SIZE = 20;
