import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type BatchApproveTasksMutation,
  type BatchApproveTasksMutationVariables,
  type WorkflowTaskFieldsFragment,
  useBatchApproveTasksMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useAdminErrorText } from "@/hooks/base/useAdminErrorText";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { workflowErrorOf } from "@/lib/base/workflow/workflow-errors";

import {
  type BatchApproveResult,
  BatchApproveResults,
} from "./BatchApproveResults";

export interface BatchApproveDialogProps {
  /** 已勾的任務(可跨頁;列在結果表上的標題取自這裡);只讀開啟當下的值 */
  tasks: readonly WorkflowTaskFieldsFragment[];
  onClose: () => void;
  /** 送出完成、拿到逐筆結果時(呼叫端更新勾選與快取);對話框留著顯示結果,直到按「關閉」 */
  onSettled: (results: readonly BatchApproveResult[]) => void;
}

/**
 * 批次核准:先填共同意見(選填)按核准,
 * 送出後同一個對話框改成結果 —— 成功數與逐筆結果(被擋下的列專案的錯誤訊息)。只支援核准。
 * 整個請求失敗(網路、筆數不合)時錯誤就地顯示在對話框裡,不另跳提示。
 */
export const BatchApproveDialog = ({
  tasks: openedWith,
  onClose,
  onSettled,
}: BatchApproveDialogProps) => {
  const t = useTranslations("admin.applyCenter.batchApprove");
  const errorText = useAdminErrorText("admin.workflows.errors");
  const { session } = useSession();
  // 開啟當下的勾選(REACT-08):送出後呼叫端會把成功的取消勾選,結果表仍要列得出它們的標題
  const [tasks] = useState(openedWith);
  const [comment, setComment] = useState("");
  const [results, setResults] = useState<readonly BatchApproveResult[] | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const countsOf = (items: readonly BatchApproveResult[]) => {
    const approved = items.filter((item) => item.ok).length;
    return { approved, failed: items.length - approved };
  };

  const batchApprove = useBatchApproveTasksMutation(
    session.client,
    useMutationFeedback<
      BatchApproveTasksMutation,
      BatchApproveTasksMutationVariables
    >({
      // 結果與錯誤都就地顯示在開著的對話框裡,不另跳提示(DATA-06 的例外)
      success: null,
      error: () => null,
      onSuccess: (payload) => {
        setResults(payload.batchApproveTasks.results);
        onSettled(payload.batchApproveTasks.results);
      },
      onError: (failure) => {
        setErrorMessage(errorText(workflowErrorOf(failure)));
      },
    }),
  );

  const counts = results === null ? null : countsOf(results);

  return (
    <Dialog
      open
      onClose={batchApprove.isPending ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      title={t("title")}
      actions={
        results === null ? (
          <>
            <Button variant="text" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button
              disabled={batchApprove.isPending}
              onClick={() => {
                setErrorMessage(null);
                const trimmed = comment.trim();
                batchApprove.mutate({
                  input: {
                    taskIds: tasks.map((task) => task.id),
                    ...(trimmed !== "" && { comment: trimmed }),
                  },
                });
              }}
            >
              {t("confirm", { count: tasks.length })}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{t("close")}</Button>
        )
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {results === null && (
          <Typography variant="body2">
            {t("body", { count: tasks.length })}
          </Typography>
        )}
        <TextField
          label={t("comment")}
          value={comment}
          onChange={(event) => {
            setComment(event.target.value);
          }}
          disabled={results !== null || batchApprove.isPending}
          size="small"
        />
        {errorMessage !== null && (
          <Alert severity="error">{errorMessage}</Alert>
        )}
        {results !== null && counts !== null && (
          <>
            <Alert severity={counts.failed === 0 ? "success" : "warning"}>
              {counts.failed === 0
                ? t("summaryAll", counts)
                : t("summaryPartial", counts)}
            </Alert>
            <BatchApproveResults tasks={tasks} results={results} />
          </>
        )}
      </Stack>
    </Dialog>
  );
};
