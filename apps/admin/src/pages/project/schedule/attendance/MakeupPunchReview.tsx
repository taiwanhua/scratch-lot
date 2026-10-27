import { useEffect } from "react";
import { useTranslations } from "use-intl";

import { useMakeupPunchEntryExistsQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";

import { useSession } from "@/hooks/base/useSession";
import type { ApprovalReviewProps } from "@/hooks/base/useWorkflowExtensions";

/**
 * 補打卡申請的審核畫面擴充(規格 14.8 情境表「審核中,選的那筆排班被刪除」;登記在
 * `app/project/workflow-extensions.ts`,模組詳情頁與申請中心都生效):選的排班已被刪除 → 任務上方警告
 * 「對應的排班已被刪除」、[核准] 停用,只能退回讓本人重選。只是畫面提示,api 的 `beforeApprove` 照樣擋。
 */
export const MakeupPunchReview = ({
  instance,
  onStateChange,
}: ApprovalReviewProps) => {
  const t = useTranslations("admin.schedule.attendance.makeup");
  const { session } = useSession();
  const query = useMakeupPunchEntryExistsQuery(
    session.client,
    { submissionId: instance.submissionId },
    { retry: false },
  );
  const entryDeleted = query.data?.makeupPunchEntryExists === false;
  useEffect(() => {
    onStateChange({ approveDisabled: entryDeleted });
  }, [entryDeleted, onStateChange]);
  return entryDeleted ? (
    <Alert severity="warning">{t("entryDeleted")}</Alert>
  ) : null;
};
