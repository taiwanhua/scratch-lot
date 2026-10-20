import { z } from "zod";

import {
  type FormSubmissionFieldsFragment,
  FormSubmissionStatus,
} from "@repo/graphql";

/** 叫貨單列表的一筆(表單引擎的提交)。 */
export type RequisitionRow = FormSubmissionFieldsFragment;

/** 列表的篩選放網址 `?requisitions=`(REACT-14):狀態、頁碼。 */
export const requisitionListSchema = z
  .object({
    status: z.enum(FormSubmissionStatus).nullable().default(null),
    page: z.number().int().min(1).default(1),
  })
  .default({ status: null, page: 1 });

export type RequisitionListFilters = z.infer<typeof requisitionListSchema>;

/** 狀態篩選的選項順序(與表單模組列表相同;叫貨單有草稿,規格 8 共通)。 */
export const REQUISITION_STATUS_ORDER: readonly FormSubmissionStatus[] = [
  FormSubmissionStatus.Draft,
  FormSubmissionStatus.Reviewing,
  FormSubmissionStatus.Returned,
  FormSubmissionStatus.Withdrawn,
  FormSubmissionStatus.Completed,
  FormSubmissionStatus.Rejected,
  FormSubmissionStatus.Voided,
];

/** 已完成的叫貨單(衍生狀態 待購買 / 已進貨 / 已調貨 要另外問 api)。 */
export const completedIdsOf = (rows: readonly RequisitionRow[]): string[] =>
  rows
    .filter((row) => row.status === FormSubmissionStatus.Completed)
    .map((row) => row.id);
