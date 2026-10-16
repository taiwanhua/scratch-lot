import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type FormSubmissionFieldsFragment,
  useCopySubmissionToDraftMutation,
  useVoidSubmissionMutation,
  useWithdrawSubmissionMutation,
} from "@repo/graphql";

import { useAdminErrorText } from "@/hooks/base/useAdminErrorText";
import { useFormSubmissionCache } from "@/hooks/base/useFormSubmissionCache";
import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { workflowErrorOf } from "@/lib/base/workflow/workflow-errors";

import { useWorkflowCache } from "./useWorkflowCache";

export interface SubmissionActions {
  /** 撤回(申請人、還沒有任何被接受的審核意見);成功回 true */
  withdraw: (submission: FormSubmissionFieldsFragment) => Promise<boolean>;
  /** 作廢(綁流程且已核准;理由必填、不需審核) */
  voidIt: (
    submission: FormSubmissionFieldsFragment,
    reason: string,
  ) => Promise<boolean>;
  /** 複製為新單(只收已作廢的);成功回新草稿 */
  copy: (
    submission: FormSubmissionFieldsFragment,
  ) => Promise<
    (FormSubmissionFieldsFragment & { clearedFields?: string[] | null }) | null
  >;
  isPending: boolean;
  /** 上一次失敗的文案(跳窗裡就地顯示) */
  errorMessage: string | null;
  clearError: () => void;
}

/**
 * 申請人對提交的三個審核動作(Spec 6b §6「撤回、作廢、複製為新單」):審核區塊與表單模組列表共用。
 * 寫入後先寫回單筆提交、再失效清單與實例(DATA-04);成功 / 失敗各跳一則提示(DATA-06:一次操作一則)。
 */
export const useSubmissionActions = (): SubmissionActions => {
  const t = useTranslations("admin.approval.feedback");
  const errorText = useAdminErrorText("admin.workflows.errors");
  const { session } = useSession();
  const showSnackbar = useSnackbar();
  const updateSubmission = useFormSubmissionCache();
  const updateWorkflow = useWorkflowCache();
  // 「複製為新單」重試(連點、網路斷)命中同一個 clientRequestId → 回同一筆,不會建兩張
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const withdrawMutation = useWithdrawSubmissionMutation(session.client);
  const voidMutation = useVoidSubmissionMutation(session.client);
  const copyMutation = useCopySubmissionToDraftMutation(session.client);

  const run = async <T>(
    action: () => Promise<T>,
    success: string,
  ): Promise<T | null> => {
    setIsPending(true);
    setErrorMessage(null);
    try {
      const result = await action();
      showSnackbar("success", success);
      return result;
    } catch (error) {
      const message = errorText(workflowErrorOf(error));
      setErrorMessage(message);
      showSnackbar("error", message);
      return null;
    } finally {
      setIsPending(false);
    }
  };

  const afterWrite = (
    before: FormSubmissionFieldsFragment,
    after: FormSubmissionFieldsFragment,
  ) => {
    updateSubmission(after);
    const instanceId = after.currentInstanceId ?? before.currentInstanceId;
    if (instanceId !== null && instanceId !== undefined) {
      updateWorkflow(instanceId);
    }
  };

  return {
    withdraw: async (submission) =>
      (await run(async () => {
        const payload = await withdrawMutation.mutateAsync({
          input: {
            id: submission.id,
            expectedEditVersion: submission.editVersion,
          },
        });
        afterWrite(submission, payload.withdrawSubmission.submission);
        return true;
      }, t("withdrawSuccess"))) ?? false,
    voidIt: async (submission, reason) =>
      (await run(async () => {
        const payload = await voidMutation.mutateAsync({
          input: {
            id: submission.id,
            expectedEditVersion: submission.editVersion,
            reason,
          },
        });
        afterWrite(submission, payload.voidSubmission.submission);
        return true;
      }, t("voidSuccess"))) ?? false,
    copy: (submission) =>
      run(async () => {
        const payload = await copyMutation.mutateAsync({
          input: { id: submission.id, clientRequestId },
        });
        const copied = payload.copySubmissionToDraft.submission;
        updateSubmission(copied);
        // 來源只能複製一次:先把快取改成「已複製」,再由失效重查對帳
        updateSubmission({
          ...submission,
          replacedById: copied.id,
          abilities: { ...submission.abilities, canCopy: false },
        });
        return copied;
      }, t("copySuccess")),
    isPending,
    errorMessage,
    clearError: () => {
      setErrorMessage(null);
    },
  };
};
