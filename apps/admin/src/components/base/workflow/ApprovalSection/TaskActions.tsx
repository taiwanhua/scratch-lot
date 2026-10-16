import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type DecideTaskMutation,
  type DecideTaskMutationVariables,
  WorkflowDecideResult,
  WorkflowDecision,
  type WorkflowTaskFieldsFragment,
  WorkflowTaskStatus,
  useDecideTaskMutation,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { workflowErrorOf } from "@/lib/base/workflow/workflow-errors";

import { DecisionDialog } from "./DecisionDialog";

export interface TaskActionsProps {
  task: WorkflowTaskFieldsFragment;
  /** 這一關可否退回修改(實例關卡的 `allowReturn`);不行就不出現「退回修改」 */
  allowReturn: boolean;
  /** 決定被接受(false)或此關已結束(true):重載實例、任務與提交 */
  onDecided: (isStepClosed: boolean) => void;
}

const DECISIONS = [
  WorkflowDecision.Approve,
  WorkflowDecision.Reject,
  WorkflowDecision.Return,
] as const;

/**
 * 我的任務動作鈕(Spec 6b §8 零件 `<TaskActions task>`):核准 / 駁回 / 退回修改,理由在跳窗裡填
 * (駁回 / 退回必填)。送出帶任務的 `editVersion`;api 回 `STEP_CLOSED`(此關已結束或任務已變更)
 * 不是錯誤 —— 提示「此關已結束」並重載。
 */
export const TaskActions = ({
  task,
  allowReturn,
  onDecided,
}: TaskActionsProps) => {
  const t = useTranslations("admin.approval.decide");
  const tErrors = useTranslations("admin.workflows.errors");
  const { session } = useSession();
  const [decision, setDecision] = useState<WorkflowDecision | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const decide = useDecideTaskMutation(
    session.client,
    useMutationFeedback<DecideTaskMutation, DecideTaskMutationVariables>({
      success: (payload, variables) =>
        payload.decideTask.result === WorkflowDecideResult.StepClosed
          ? t("stepClosed")
          : t(`feedback.${variables.input.decision}`),
      error: (failure) => tErrors(workflowErrorOf(failure).code),
      onSuccess: (payload) => {
        setDecision(null);
        onDecided(
          payload.decideTask.result === WorkflowDecideResult.StepClosed,
        );
      },
      onError: (failure) => {
        setErrorMessage(tErrors(workflowErrorOf(failure).code));
      },
    }),
  );

  if (task.status !== WorkflowTaskStatus.Pending) {
    return null;
  }

  return (
    <Stack
      spacing={1}
      role="group"
      aria-label={t("region", { step: task.stepName })}
    >
      <Typography variant="body2">
        {t("prompt", { step: task.stepName })}
      </Typography>
      <Stack direction="row" spacing={1}>
        {DECISIONS.filter(
          (item) => allowReturn || item !== WorkflowDecision.Return,
        ).map((item) => (
          <Button
            key={item}
            variant={
              item === WorkflowDecision.Approve ? "contained" : "outlined"
            }
            color={item === WorkflowDecision.Reject ? "error" : "primary"}
            disabled={decide.isPending}
            onClick={() => {
              setErrorMessage(null);
              setDecision(item);
            }}
          >
            {t(`buttons.${item}`)}
          </Button>
        ))}
      </Stack>
      {decision !== null && (
        <DecisionDialog
          decision={decision}
          stepName={task.stepName}
          isSubmitting={decide.isPending}
          errorMessage={errorMessage}
          onCancel={() => {
            setDecision(null);
          }}
          onConfirm={(comment) => {
            decide.mutate({
              input: {
                taskId: task.id,
                expectedEditVersion: task.editVersion,
                decision,
                ...(comment !== "" && { comment }),
              },
            });
          }}
        />
      )}
    </Stack>
  );
};
