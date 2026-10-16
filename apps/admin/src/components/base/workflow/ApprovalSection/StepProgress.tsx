import { useTranslations } from "use-intl";

import {
  type WorkflowInstanceFieldsFragment,
  WorkflowStepStatus,
} from "@repo/graphql";
import { Stack } from "@repo/ui/stack";
import { Tag, type TagTone } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

type InstanceStep = WorkflowInstanceFieldsFragment["steps"][number];

const STEP_TONE: Record<WorkflowStepStatus, TagTone> = {
  [WorkflowStepStatus.Pending]: "grey",
  [WorkflowStepStatus.Active]: "primary",
  [WorkflowStepStatus.Completed]: "success",
  [WorkflowStepStatus.Skipped]: "grey",
  [WorkflowStepStatus.Terminated]: "grey",
};

export interface StepProgressProps {
  instance: WorkflowInstanceFieldsFragment;
}

/**
 * 關卡進度 / 分支進度(Spec 6b §8 畫面 9 / 10):版本的每個節點一列 —— 進行中、已通過、已跳過、
 * 阻擋、還沒到;平行分支同時進行時就是「財務已通過、法務待審、採購待處理」這樣的幾列。
 * 審核關卡列出派任計畫的每個人與他被接受的決定;匯合節點只顯示「等待所有分支」/「已匯合」。
 */
export const StepProgress = ({ instance }: StepProgressProps) => {
  const t = useTranslations("admin.approval.progress");
  const tDecision = useTranslations("admin.approval.decisions");

  const stateLabel = (step: InstanceStep): { tone: TagTone; label: string } => {
    if (step.blocked) {
      return { tone: "warning", label: t("blocked") };
    }
    if (step.kind === "join" && step.status === WorkflowStepStatus.Completed) {
      return { tone: "success", label: t("joined") };
    }
    // 匯合還沒到齊:實例還在跑才是「等待所有分支」;全案已終局(駁回 / 退回 / 撤回)就是「已結束」
    if (step.kind === "join" && step.status !== WorkflowStepStatus.Terminated) {
      return { tone: "grey", label: t("joinWaiting") };
    }
    return {
      tone: STEP_TONE[step.status],
      label: t(`statuses.${step.status}`),
    };
  };

  const assigneeLine = (step: InstanceStep): string =>
    step.plan
      .map((item) => {
        const decision = step.decisions.find(
          (entry) => entry.taskKey === item.taskKey,
        );
        const name = item.assignee.name ?? item.assignee.id;
        if (decision !== undefined) {
          return t("assigneeDecided", {
            name,
            decision: tDecision(decision.decision),
          });
        }
        return item.assigneeState === "invalid"
          ? t("assigneeInvalid", { name })
          : name;
      })
      .join("、");

  return (
    <Stack spacing={1} component="section">
      <Typography variant="subtitle2" component="h3">
        {t("title")}
      </Typography>
      <Stack
        component="ol"
        spacing={0.75}
        aria-label={t("region")}
        sx={{ listStyle: "none", m: 0, p: 0 }}
      >
        {instance.steps.map((step) => {
          const state = stateLabel(step);
          const assignees = step.kind === "join" ? "" : assigneeLine(step);
          return (
            <li
              key={step.stepKey}
              aria-label={t("row", { name: step.name, state: state.label })}
            >
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5 }}
              >
                <Typography variant="body2" sx={{ minWidth: 120 }}>
                  {step.kind === "join"
                    ? t("joinName", { name: step.name })
                    : step.name}
                </Typography>
                <Tag tone={state.tone} label={state.label} />
                {step.mode !== null && step.mode !== undefined && (
                  <Typography variant="caption" color="text.secondary">
                    {t(`modes.${step.mode}`)}
                  </Typography>
                )}
                {assignees !== "" && (
                  <Typography variant="body2" color="text.secondary">
                    {assignees}
                  </Typography>
                )}
                {step.kind !== "join" &&
                  step.plan.length === 0 &&
                  step.status === WorkflowStepStatus.Active && (
                    <Typography variant="body2" color="warning.main">
                      {t("noAssignee")}
                    </Typography>
                  )}
              </Stack>
            </li>
          );
        })}
      </Stack>
    </Stack>
  );
};
