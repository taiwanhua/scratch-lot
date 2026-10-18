import { useState } from "react";

import type { StoredValues } from "@repo/domain/form";
import {
  type FormSubmissionFieldsFragment,
  useCreateAndSubmitFormSubmissionMutation,
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
  /**
   * 送出:一個請求完成。還沒存過草稿 → `createAndSubmitFormSubmission`(一個交易建立 + 送出,失敗不留資料);
   * 已存過草稿 → `submitFormSubmission` 帶畫面上的值送出那一筆
   */
  submit: (
    values: StoredValues,
    touched: readonly string[],
  ) => Promise<FormSubmissionFieldsFragment | null>;
  isPending: boolean;
  error: FormError | null;
}

/**
 * 新增一筆提交(`docs/modules/forms.md`):
 *
 * - **頁面開啟時**產生一次性的 `clientRequestId`:`createFormDraft` / `createAndSubmitFormSubmission` 重試
 *   (網路斷、連點)命中同一個 `(createdBy, clientRequestId)` 就回同一筆,不會建出兩筆;
 * - [送出] 不先建草稿:失敗時資料庫不留任何資料,畫面保留輸入內容並顯示錯誤;只有 [存草稿] 才建草稿;
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
  const createAndSubmit = useCreateAndSubmitFormSubmissionMutation(
    session.client,
  );

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

  /** 送出(一個請求):沒有草稿 → 建立並送出;有草稿 → 帶這次的值送出那一筆。 */
  const send = async (
    values: StoredValues,
    touched: readonly string[],
  ): Promise<FormSubmissionFieldsFragment> => {
    if (draft === null) {
      const created = await createAndSubmit.mutateAsync({
        input: { formKey, clientRequestId, values, touched: [...touched] },
      });
      return created.createAndSubmitFormSubmission.submission;
    }
    const submitted = await submitMutation.mutateAsync({
      input: { id: draft.id, expectedEditVersion: draft.editVersion, values },
    });
    return submitted.submitFormSubmission.submission;
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
      current = andSubmit
        ? await send(values, touched)
        : await persist(values, touched);
      setDraft(current);
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
