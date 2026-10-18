import { useTranslations } from "use-intl";

import {
  PrintJobError,
  type PrintJobFieldsFragment,
  PrintJobStatus,
} from "@repo/graphql";
import { Tag, type TagTone } from "@repo/ui/tag";

const TONE: Record<PrintJobStatus, TagTone> = {
  [PrintJobStatus.Pending]: "grey",
  [PrintJobStatus.Sent]: "primary",
  [PrintJobStatus.Printed]: "success",
  [PrintJobStatus.Failed]: "error",
};

export interface PrintJobStatusTagProps {
  job: Pick<PrintJobFieldsFragment, "status" | "error">;
}

/** 列印紀錄「結果」欄(已印出 / 失敗:<原因>)。 */
export const PrintJobStatusTag = ({ job }: PrintJobStatusTagProps) => {
  const t = useTranslations("admin.printers.jobStatus");
  const tError = useTranslations("admin.printers.jobError");
  const label =
    job.status === PrintJobStatus.Failed
      ? t("failedWith", { reason: tError(job.error ?? PrintJobError.Other) })
      : t(job.status);
  return <Tag tone={TONE[job.status]} label={label} />;
};
