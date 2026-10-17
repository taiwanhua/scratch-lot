import { useTranslations } from "use-intl";

import {
  type BatchApproveTasksMutation,
  WorkflowBatchApproveFailure,
  type WorkflowTaskFieldsFragment,
} from "@repo/graphql";
import { Table } from "@repo/ui/table";
import { Typography } from "@repo/ui/typography";

import { adminErrorText } from "@/lib/base/errors";

export type BatchApproveResult =
  BatchApproveTasksMutation["batchApproveTasks"]["results"][number];

export interface BatchApproveResultsProps {
  tasks: readonly WorkflowTaskFieldsFragment[];
  results: readonly BatchApproveResult[];
}

/**
 * 批次核准的逐筆結果表(Figma BS-07b 257:6335):標題 + 結果。被守門擋下的顯示專案的錯誤訊息
 * (`admin.lifecycle.<碼>`;專案沒有文案時用中性的「這張單目前不能核准」,不用單筆核准的「沒有權限」)。
 */
export const BatchApproveResults = ({
  tasks,
  results,
}: BatchApproveResultsProps) => {
  const t = useTranslations("admin.applyCenter.batchApprove");
  const tRoot = useTranslations();
  const titleOf = (taskId: string) => {
    const task = tasks.find((item) => item.id === taskId);
    return task === undefined
      ? taskId
      : (task.summary?.title ?? task.formName ?? task.formKey);
  };
  const resultText = (result: BatchApproveResult) => {
    if (result.ok) {
      return t("results.approved");
    }
    switch (result.reason) {
      case WorkflowBatchApproveFailure.Blocked: {
        return t("results.BLOCKED", {
          message: adminErrorText(
            {
              code: "BLOCKED_GENERIC",
              ...(result.projectReason != null && {
                projectReason: result.projectReason,
              }),
            },
            () => t("results.BLOCKED_GENERIC"),
            tRoot,
          ),
        });
      }
      case WorkflowBatchApproveFailure.NotYours: {
        return t("results.NOT_YOURS");
      }
      default: {
        return t("results.FAILED");
      }
    }
  };

  return (
    <Table<BatchApproveResult>
      aria-label={t("resultTableAria")}
      size="small"
      rows={results}
      getRowKey={(result) => result.taskId}
      containerSx={{ height: "auto", maxHeight: 360 }}
      columns={[
        {
          key: "title",
          header: t("columnTitle"),
          render: (result) => titleOf(result.taskId),
        },
        {
          key: "result",
          header: t("columnResult"),
          render: (result) => (
            <Typography
              variant="body2"
              sx={{ color: result.ok ? "success.main" : "error.main" }}
            >
              {resultText(result)}
            </Typography>
          ),
        },
      ]}
    />
  );
};
