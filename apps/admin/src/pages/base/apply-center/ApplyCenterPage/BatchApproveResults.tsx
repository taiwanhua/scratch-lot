import { useTranslations } from "use-intl";

import {
  type BatchApproveTasksMutation,
  WorkflowBatchApproveFailure,
  type WorkflowTaskFieldsFragment,
} from "@repo/graphql";
import { Table } from "@repo/ui/table";
import { Typography } from "@repo/ui/typography";

import { useAdminErrorText } from "@/hooks/base/useAdminErrorText";

export type BatchApproveResult =
  BatchApproveTasksMutation["batchApproveTasks"]["results"][number];

export interface BatchApproveResultsProps {
  tasks: readonly WorkflowTaskFieldsFragment[];
  results: readonly BatchApproveResult[];
}

/**
 * 批次核准的逐筆結果表(Figma BS-07b 257:6335):標題 + 結果。被守門擋下的顯示專案的錯誤訊息
 * (`admin.lifecycle.<碼>`,沒有就退回「沒有權限」那句,同單筆核准)。
 */
export const BatchApproveResults = ({
  tasks,
  results,
}: BatchApproveResultsProps) => {
  const t = useTranslations("admin.applyCenter.batchApprove");
  const errorText = useAdminErrorText("admin.workflows.errors");
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
          message: errorText({
            code: "FORBIDDEN",
            ...(result.projectReason != null && {
              projectReason: result.projectReason,
            }),
          }),
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
