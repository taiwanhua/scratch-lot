import { useState } from "react";

import type { StoredValues } from "@repo/domain/form";
import {
  type FormSubmissionFieldsFragment,
  useCreateFormDraftMutation,
  useSaveFormDraftMutation,
  useSubmitFormSubmissionMutation,
} from "@repo/graphql";

import {
  type FormError,
  formErrorOf,
} from "@/lib/base/form-engine/form-errors";

import { useCapacityErrorSnackbar } from "./useCapacityErrorSnackbar";
import { useFormSubmissionCache } from "./useFormSubmissionCache";
import { useSession } from "./useSession";

export interface FormDraftState {
  /** 已建立的草稿(第一次存草稿或送出之後才有) */
  draft: FormSubmissionFieldsFragment | null;
  /** 存草稿:第一次建草稿(帶 `clientRequestId`),之後存同一筆(帶 `expectedEditVersion`) */
  saveDraft: (
    values: StoredValues,
    touched: readonly string[],
  ) => Promise<FormSubmissionFieldsFragment | null>;
  /** 送出:畫面上一顆鈕 = 建 / 存草稿 + 送出兩個動作(Spec 6a §6) */
  submit: (
    values: StoredValues,
    touched: readonly string[],
  ) => Promise<FormSubmissionFieldsFragment | null>;
  isPending: boolean;
  error: FormError | null;
}

/**
 * 新增一筆提交(Spec 6a §6「提交」、docs/modules/forms.md):
 *
 * - **頁面開啟時**產生一次性的 `clientRequestId`:`createFormDraft` 重試(網路斷、連點)命中同一個
 *   `(createdBy, clientRequestId)` 就回同一筆,「新增後直接送出」不會建出兩筆;
 * - 之後每次寫入都帶 `expectedEditVersion`(= 上一次拿到的 `editVersion`),不符 → `CONFLICT`,
 *   畫面提示「這筆資料已被別人更新,請重新載入」;
 * - `values` 是**整張表單的狀態**(缺席 = 清空),所以一律送整份;`touched` 是使用者碰過的欄位
 *   (建草稿時 api 不以預設值覆蓋它們,存草稿時一併存)。
 */
export const useFormDraft = (formKey: string): FormDraftState => {
  const { session } = useSession();
  const updateCache = useFormSubmissionCache();
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState<FormSubmissionFieldsFragment | null>(null);
  const [error, setError] = useState<FormError | null>(null);
  const [isPending, setIsPending] = useState(false);
  const announceCapacity = useCapacityErrorSnackbar();

  const create = useCreateFormDraftMutation(session.client);
  const save = useSaveFormDraftMutation(session.client);
  const submitMutation = useSubmitFormSubmissionMutation(session.client);

  const persist = async (
    values: StoredValues,
    touched: readonly string[],
  ): Promise<FormSubmissionFieldsFragment> => {
    if (draft === null) {
      const created = await create.mutateAsync({
        input: { formKey, clientRequestId, values, touched: [...touched] },
      });
      return created.createFormDraft.submission;
    }
    const saved = await save.mutateAsync({
      input: {
        id: draft.id,
        expectedEditVersion: draft.editVersion,
        values,
        touched: [...touched],
      },
    });
    return saved.saveFormDraft.submission;
  };

  const run = async (
    values: StoredValues,
    touched: readonly string[],
    andSubmit: boolean,
  ): Promise<FormSubmissionFieldsFragment | null> => {
    setIsPending(true);
    setError(null);
    let current: FormSubmissionFieldsFragment | null = draft;
    try {
      current = await persist(values, touched);
      setDraft(current);
      if (andSubmit) {
        const submitted = await submitMutation.mutateAsync({
          input: { id: current.id, expectedEditVersion: current.editVersion },
        });
        current = submitted.submitFormSubmission.submission;
        setDraft(current);
      }
      updateCache(current);
      return current;
    } catch (error_) {
      const failure = formErrorOf(error_);
      setError(failure);
      announceCapacity(failure);
      updateCache(current);
      return null;
    } finally {
      setIsPending(false);
    }
  };

  return {
    draft,
    saveDraft: (values, touched) => run(values, touched, false),
    submit: (values, touched) => run(values, touched, true),
    isPending,
    error,
  };
};
