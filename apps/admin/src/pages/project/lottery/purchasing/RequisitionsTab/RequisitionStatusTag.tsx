import { useTranslations } from "use-intl";

import { FormSubmissionStatus } from "@repo/graphql";
import { Tag, type TagTone } from "@repo/ui/tag";

import { SubmissionStatusTag } from "@/components/base/workflow/SubmissionStatusTag";

import type { RequisitionRow } from "./requisitions";

/** 衍生狀態的色調:待購買(還要處理)/ 已進貨 / 已調貨。 */
const STATE_TONE: Readonly<Record<string, TagTone>> = {
  pending: "warning",
  purchased: "success",
  transferred: "success",
};

export interface RequisitionStatusTagProps {
  row: RequisitionRow;
  /** 已完成那幾筆的衍生狀態(requisitionId → `pending` / `purchased` / `transferred`) */
  states: ReadonlyMap<string, string>;
}

/**
 * 叫貨單的狀態(規格 8.1;Figma PU-01):引擎狀態 + 已完成再細分 待購買 / 已進貨 / 已調貨。
 * 衍生狀態還沒回來(或不認得)時照引擎狀態顯示「已完成」。
 */
export const RequisitionStatusTag = ({
  row,
  states,
}: RequisitionStatusTagProps) => {
  const t = useTranslations("admin.lotteryPurchasing.states");
  const state =
    row.status === FormSubmissionStatus.Completed
      ? states.get(row.id)
      : undefined;
  const tone = state === undefined ? undefined : STATE_TONE[state];
  if (state === undefined || tone === undefined) {
    return <SubmissionStatusTag status={row.status} blocked={row.blocked} />;
  }
  return <Tag tone={tone} label={t(state)} />;
};
