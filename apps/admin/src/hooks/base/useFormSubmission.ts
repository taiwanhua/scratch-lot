import { useState } from "react";

import type { StoredValues } from "@repo/domain/form";
import {
  type FormSubmissionFieldsFragment,
  FormSubmissionStatus,
  useDeleteFormSubmissionMutation,
  useFormSubmissionQuery,
  useSaveFormDraftMutation,
  useSubmitFormSubmissionMutation,
  useUpdateFormSubmissionMutation,
} from "@repo/graphql";

import {
  type FormError,
  formErrorOf,
} from "@/lib/base/form-engine/form-errors";

import { useCapacityErrorSnackbar } from "./useCapacityErrorSnackbar";
import { useFormSubmissionCache } from "./useFormSubmissionCache";
import { useSession } from "./useSession";

/**
 * 以草稿方式存(`saveFormDraft`)的三種狀態:草稿,以及被退回 / 撤回後申請人改內容再送
 * (狀態不變,再送出 = 修訂 +1)。其餘(沒走過流程的已完成)走「儲存修改」。
 */
const DRAFT_LIKE = new Set<FormSubmissionStatus>([
  FormSubmissionStatus.Draft,
  FormSubmissionStatus.Returned,
  FormSubmissionStatus.Withdrawn,
]);

export const isDraftLike = (status: FormSubmissionStatus): boolean =>
  DRAFT_LIKE.has(status);

export interface FormSubmissionState {
  submission: FormSubmissionFieldsFragment | null;
  isLoading: boolean;
  loadError: FormError | null;
  /**
   * 草稿 / 退回 / 撤回:存草稿(`touched` = 使用者碰過的欄位,一併存);
   * 已完成:儲存修改(修訂 +1,帶 `expectedRevision`;`touched` 不送)
   */
  save: (
    values: StoredValues,
    touched?: readonly string[],
  ) => Promise<FormSubmissionFieldsFragment | null>;
  /** 草稿 / 退回 / 撤回:帶畫面上的值送出(一個請求、一個交易;綁流程的會進審核) */
  submit: (
    values: StoredValues,
    touched?: readonly string[],
  ) => Promise<FormSubmissionFieldsFragment | null>;
  remove: () => Promise<boolean>;
  isPending: boolean;
  error: FormError | null;
}

/**
 * 讀 / 寫一筆既有的提交(`docs/modules/forms.md`「api 介面」)。
 * `revision` 省略 = 目前;給了就是讀那個修訂的快照(唯讀,修訂差異用)。
 *
 * 每次寫入帶 `expectedEditVersion`(= 讀到的 `editVersion`),已完成修改另帶 `expectedRevision`;
 * 不符 → `CONFLICT`,由頁面提示「這筆資料已被別人更新,請重新載入」。
 */
export const useFormSubmission = (
  id: string,
  revision: number | null = null,
): FormSubmissionState => {
  const { session } = useSession();
  const updateCache = useFormSubmissionCache();
  const [error, setError] = useState<FormError | null>(null);
  const [isPending, setIsPending] = useState(false);
  const announceCapacity = useCapacityErrorSnackbar();

  const query = useFormSubmissionQuery(
    session.client,
    { id, ...(revision !== null && { revision }) },
    { enabled: id !== "", retry: false },
  );
  const submission = query.data?.formSubmission.submission ?? null;

  const saveDraft = useSaveFormDraftMutation(session.client);
  const submitDraft = useSubmitFormSubmissionMutation(session.client);
  const update = useUpdateFormSubmissionMutation(session.client);
  const deleteMutation = useDeleteFormSubmissionMutation(session.client);

  const wrap = async <T>(action: () => Promise<T>): Promise<T | null> => {
    setIsPending(true);
    setError(null);
    try {
      return await action();
    } catch (error_) {
      const failure = formErrorOf(error_);
      setError(failure);
      announceCapacity(failure);
      return null;
    } finally {
      setIsPending(false);
    }
  };

  const saveAsDraft = async (
    current: FormSubmissionFieldsFragment,
    values: StoredValues,
    touched: readonly string[] | undefined,
  ): Promise<FormSubmissionFieldsFragment> => {
    const payload = await saveDraft.mutateAsync({
      input: {
        id: current.id,
        expectedEditVersion: current.editVersion,
        values,
        ...(touched !== undefined && { touched: [...touched] }),
      },
    });
    return payload.saveFormDraft.submission;
  };

  const saveCompleted = async (
    current: FormSubmissionFieldsFragment,
    values: StoredValues,
  ): Promise<FormSubmissionFieldsFragment> => {
    const payload = await update.mutateAsync({
      input: {
        id: current.id,
        expectedEditVersion: current.editVersion,
        expectedRevision: current.revision,
        values,
      },
    });
    return payload.updateFormSubmission.submission;
  };

  const save = (values: StoredValues, touched?: readonly string[]) =>
    wrap(async () => {
      if (submission === null) {
        return null;
      }
      const next = isDraftLike(submission.status)
        ? await saveAsDraft(submission, values, touched)
        : await saveCompleted(submission, values);
      updateCache(next);
      return next;
    });

  // 送出後不再是「還沒送出過的草稿」,`touched` 用不到,不送
  const submit = (values: StoredValues) =>
    wrap(async () => {
      if (submission === null) {
        return null;
      }
      // 不先存草稿:表單關了「允許存草稿」時草稿也送得出去,送出失敗也不留半套的存檔
      const payload = await submitDraft.mutateAsync({
        input: {
          id: submission.id,
          expectedEditVersion: submission.editVersion,
          values,
        },
      });
      const submitted = payload.submitFormSubmission.submission;
      updateCache(submitted);
      return submitted;
    });

  const remove = async (): Promise<boolean> =>
    (await wrap(async () => {
      await deleteMutation.mutateAsync({ input: { id } });
      updateCache(null);
      return true;
    })) ?? false;

  return {
    submission,
    isLoading: query.isLoading,
    loadError: query.error === null ? null : formErrorOf(query.error),
    save,
    submit,
    remove,
    isPending,
    error,
  };
};
