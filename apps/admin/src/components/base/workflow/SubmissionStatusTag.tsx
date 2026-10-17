import { useTranslations } from "use-intl";

import { FormSubmissionStatus } from "@repo/graphql";
import { Tag, type TagTone } from "@repo/ui/tag";

/** 提交狀態七值的色調(Spec 6b §6「提交狀態」);審核中被阻擋時另標「待處理」。 */
const STATUS_TONE: Record<FormSubmissionStatus, TagTone> = {
  [FormSubmissionStatus.Draft]: "grey",
  [FormSubmissionStatus.Reviewing]: "primary",
  [FormSubmissionStatus.Returned]: "warning",
  [FormSubmissionStatus.Withdrawn]: "grey",
  [FormSubmissionStatus.Completed]: "success",
  [FormSubmissionStatus.Rejected]: "error",
  [FormSubmissionStatus.Voided]: "grey",
};

export interface SubmissionStatusTagProps {
  status: FormSubmissionStatus;
  /** 實例被阻擋(`form_submissions.blocked`):「審核中(待處理)」 */
  blocked?: boolean;
}

/**
 * 提交狀態的 chip(表單模組列表、詳情、申請中心共用):草稿 / 審核中(含待處理)/ 已退回 / 已撤回 /
 * 已完成 / 已駁回 / 已作廢。
 */
export const SubmissionStatusTag = ({
  status,
  blocked = false,
}: SubmissionStatusTagProps) => {
  const t = useTranslations("admin.approval.submissionStatus");
  const isPending = status === FormSubmissionStatus.Reviewing && blocked;

  return (
    <Tag
      tone={isPending ? "warning" : STATUS_TONE[status]}
      label={isPending ? t("reviewingBlocked") : t(status)}
    />
  );
};
