import { z } from "zod";

import {
  type FormSubmissionFieldsFragment,
  FormSubmissionStatus,
} from "@repo/graphql";

/**
 * 排班作業 → 支援需求單(規格 14.10)。表單是受管表單(正本
 * `apps/db-migrator/seeds/project/revisions/support_request.r1.seed.ts`),欄位 key 與它一致。
 */
export const SCHEDULE_MANAGE_MODULE_KEY = "schedule.manage";
export const SUPPORT_REQUEST_FORM_KEY = "support_request";

/** 列表的篩選放網址 `?support=`(REACT-14):狀態、頁碼。 */
export const SUPPORT_LIST_KEY = "support";

export const supportListSchema = z
  .object({
    status: z.enum(FormSubmissionStatus).nullable().default(null),
    page: z.number().int().min(1).default(1),
  })
  .default({ status: null, page: 1 });

export type SupportListFilters = z.infer<typeof supportListSchema>;

export const SUPPORT_PAGE_SIZE = 20;

/** 狀態篩選的選項順序(與表單模組列表相同;支援需求單沒有草稿)。 */
export const SUPPORT_STATUS_ORDER: readonly FormSubmissionStatus[] = [
  FormSubmissionStatus.Reviewing,
  FormSubmissionStatus.Returned,
  FormSubmissionStatus.Withdrawn,
  FormSubmissionStatus.Completed,
  FormSubmissionStatus.Rejected,
  FormSubmissionStatus.Voided,
];

export type SupportRequestRow = FormSubmissionFieldsFragment;

/** 分店欄的顯示名(api 的 `displayValues`;沒有就退回存的值)。 */
export const branchLabelOf = (row: SupportRequestRow): string => {
  const item = row.displayValues.find((entry) => entry.fieldKey === "branch")
    ?.items[0];
  const value = row.values.branch;
  return item?.label ?? (typeof value === "string" ? value : "");
};
