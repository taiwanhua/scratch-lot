import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type FormSubmissionFieldsFragment,
  WorkflowInstanceStatus,
  useWorkflowInstanceQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Tag, type TagTone } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";
import { useWorkflowExtensions } from "@/hooks/base/useWorkflowExtensions";
import { workflowErrorOf } from "@/lib/base/workflow/workflow-errors";

import { useWorkflowCache } from "../useWorkflowCache";
import { ApplicantActions } from "./ApplicantActions";
import { ApprovalTimeline } from "./ApprovalTimeline";
import { MyTask } from "./MyTask";
import { RetryAdvanceButton } from "./RetryAdvanceButton";
import { StepProgress } from "./StepProgress";

const INSTANCE_TONE: Record<WorkflowInstanceStatus, TagTone> = {
  [WorkflowInstanceStatus.Running]: "primary",
  [WorkflowInstanceStatus.Blocked]: "warning",
  [WorkflowInstanceStatus.Approved]: "success",
  [WorkflowInstanceStatus.Rejected]: "error",
  [WorkflowInstanceStatus.Returned]: "warning",
  [WorkflowInstanceStatus.Withdrawn]: "grey",
  [WorkflowInstanceStatus.Superseded]: "grey",
};

export interface ApprovalSectionProps {
  /** 要看的實例(提交的 `currentInstanceId`,或申請中心詳情網址上的那一個) */
  instanceId: string;
  /**
   * 申請人 / 有權讀的人看到的提交(撤回 / 作廢 / 複製為新單要它的 `editVersion` 與 `abilities`);
   * 只審過某個修訂的審核者讀不到提交現況,給 null(這三顆鈕不出現)
   */
  submission: FormSubmissionFieldsFragment | null;
  /** 複製為新單成功:呼叫端決定去哪(該模組的編輯頁) */
  onCopied?: (submissionId: string) => void;
  /**
   * 停用「核准」(駁回 / 退回照常):業務頁知道這張單現在不能核准時用(例:補打卡申請選的排班已被刪除);
   * 只是畫面提示,api 的掛接點守門照樣擋。預設 false。模組登記的審核畫面擴充(`Review`)也能停用
   */
  approveDisabled?: boolean;
}

/**
 * 審核區塊:掛在表單詳情(`FormSubmissionDetail`)下方,申請中心詳情頁也用它。
 *
 * - 實例狀態與阻擋標示;流程管理者可「重試推進」
 * - 關卡進度 / 分支進度(每個節點一列)
 * - 我的任務:核准 / 駁回 / 退回(理由跳窗;`STEP_CLOSED` 提示「此關已結束」並重載);
 *   決定被接受後通知該模組登記的審核後動作;模組登記的審核畫面擴充畫在任務上方、可停用 [核准]
 *   (`useWorkflowExtensions`;不論這個區塊掛在申請中心或模組自己的頁面)
 * - 申請人:撤回 / 作廢 / 複製為新單
 * - 時間軸(`history`)
 */
export const ApprovalSection = ({
  instanceId,
  submission,
  onCopied,
  approveDisabled = false,
}: ApprovalSectionProps) => {
  const t = useTranslations("admin.approval.section");
  const tErrors = useTranslations("admin.workflows.errors");
  const { session } = useSession();
  const refresh = useWorkflowCache();
  const { notify } = useWorkflowExtensions();
  const [isStepClosed, setIsStepClosed] = useState(false);
  const query = useWorkflowInstanceQuery(
    session.client,
    { id: instanceId },
    { retry: false },
  );
  const instance = query.data?.workflowInstance.instance ?? null;

  if (query.isLoading) {
    return <CircularProgress aria-label={t("loading")} />;
  }
  if (instance === null) {
    const code =
      query.error === null ? "NOT_FOUND" : workflowErrorOf(query.error).code;
    return <Alert severity="error">{tErrors(code)}</Alert>;
  }

  const activeNames = instance.steps
    .filter((step) => instance.activeStepKeys.includes(step.stepKey))
    .map((step) => step.name);

  return (
    <Stack
      spacing={2.5}
      component="section"
      aria-label={t("region")}
      sx={{ borderTop: 1, borderColor: "divider", pt: 2.5 }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", flexWrap: "wrap" }}
      >
        <Typography variant="subtitle1" component="h2">
          {t("title")}
        </Typography>
        <Tag
          tone={INSTANCE_TONE[instance.status]}
          label={t(`statuses.${instance.status}`)}
        />
        <Typography variant="body2" color="text.secondary">
          {t("workflowLine", {
            workflow: instance.workflowName ?? instance.workflowKey,
            version: instance.workflowVersion,
            revision: instance.revision,
          })}
        </Typography>
      </Stack>
      {activeNames.length > 0 && (
        <Typography variant="body2">
          {t("activeSteps", { steps: activeNames.join("、") })}
        </Typography>
      )}
      {instance.status === WorkflowInstanceStatus.Blocked && (
        <Alert
          severity="warning"
          action={
            instance.abilities.canManage ? (
              <RetryAdvanceButton
                instanceId={instance.id}
                onDone={(next) => {
                  refresh(instance.id, next);
                }}
              />
            ) : undefined
          }
        >
          {t("blocked")}
        </Alert>
      )}
      {isStepClosed && <Alert severity="info">{t("stepClosed")}</Alert>}
      {instance.myTasks.map((task) => (
        <MyTask
          key={task.id}
          instance={instance}
          task={task}
          approveDisabled={approveDisabled}
          onDecided={(closed, decision) => {
            setIsStepClosed(closed);
            refresh(instance.id);
            void query.refetch();
            if (!closed) {
              notify({
                kind: "decided",
                moduleKey: instance.moduleKey,
                submissionId: instance.submissionId,
                instanceId: instance.id,
                stepKey: task.stepKey,
                decision,
              });
            }
          }}
        />
      ))}
      {submission !== null && (
        <ApplicantActions
          submission={submission}
          canWithdraw={instance.abilities.canWithdraw}
          {...(onCopied !== undefined && { onCopied })}
        />
      )}
      <StepProgress instance={instance} />
      {instance.status !== WorkflowInstanceStatus.Blocked &&
        instance.abilities.canManage && (
          <Stack direction="row">
            <RetryAdvanceButton
              instanceId={instance.id}
              onDone={(next) => {
                refresh(instance.id, next);
              }}
            />
          </Stack>
        )}
      <ApprovalTimeline instance={instance} />
    </Stack>
  );
};
