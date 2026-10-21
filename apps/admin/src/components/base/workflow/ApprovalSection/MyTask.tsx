import { useState } from "react";

import type {
  WorkflowDecision,
  WorkflowInstanceFieldsFragment,
  WorkflowTaskFieldsFragment,
} from "@repo/graphql";
import { Stack } from "@repo/ui/stack";

import {
  type ApprovalReviewState,
  useWorkflowExtensions,
} from "@/hooks/base/useWorkflowExtensions";

import { TaskActions } from "./TaskActions";

export interface MyTaskProps {
  instance: WorkflowInstanceFieldsFragment;
  task: WorkflowTaskFieldsFragment;
  /** 呼叫端(業務頁)要停用 [核准](`ApprovalSection` 的 `approveDisabled`) */
  approveDisabled?: boolean;
  onDecided: (isStepClosed: boolean, decision: WorkflowDecision) => void;
}

/**
 * 我的一筆任務:模組登記的審核畫面擴充(`Review`,警告畫在動作鈕上方)+ 動作鈕。
 * 呼叫端給了 `approveDisabled`,或任何一個 `Review` 回報 `approveDisabled` → [核准] 停用(駁回 / 退回照常)。
 */
export const MyTask = ({
  instance,
  task,
  approveDisabled: disabledByPage = false,
  onDecided,
}: MyTaskProps) => {
  const { reviewsOf } = useWorkflowExtensions();
  const reviews = reviewsOf(instance.moduleKey);
  const [states, setStates] = useState<
    Readonly<Partial<Record<number, ApprovalReviewState>>>
  >({});
  const approveDisabled =
    disabledByPage ||
    Object.values(states).some((state) => state?.approveDisabled === true);

  return (
    <Stack spacing={1}>
      {reviews.map((Review, index) => (
        <Review
          // 登記是固定清單,位置即身分
          key={index}
          instance={instance}
          task={task}
          onStateChange={(state) => {
            setStates((current) =>
              current[index]?.approveDisabled === state.approveDisabled
                ? current
                : { ...current, [index]: state },
            );
          }}
        />
      ))}
      <TaskActions
        task={task}
        allowReturn={
          instance.steps.find((step) => step.stepKey === task.stepKey)
            ?.allowReturn ?? false
        }
        approveDisabled={approveDisabled}
        onDecided={onDecided}
      />
    </Stack>
  );
};
