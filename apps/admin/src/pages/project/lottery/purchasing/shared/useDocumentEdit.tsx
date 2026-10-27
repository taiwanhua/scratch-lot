import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import type { StoredValues } from "@repo/domain/form";
import {
  type FormSubmissionFieldsFragment,
  FormSubmissionStatus,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { isDraftLike, useFormSubmission } from "@/hooks/base/useFormSubmission";
import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import type { FormError } from "@/lib/base/form-engine/form-errors";

/** 編輯頁現在能畫什麼。 */
export type DocumentEditState =
  | { kind: "loading" }
  /** 讀不到 / 沒有編輯權(`abilities.canEdit`)→ 顯示原因 */
  | { kind: "unavailable"; code: string }
  /** 不是草稿 / 退回 / 撤回(例 沒走流程的已完成):交回表單引擎的預設編輯頁 */
  | { kind: "engine" }
  | { kind: "ready"; submission: FormSubmissionFieldsFragment };

export interface DocumentEdit {
  state: DocumentEditState;
  /** 被退回 / 撤回的說明(表單引擎編輯頁同一句);草稿 = null */
  notice: ReactNode;
  canSaveDraft: boolean;
  isPending: boolean;
  error: FormError | null;
  saveDraft: (values: StoredValues) => void;
  submit: (values: StoredValues) => void;
  leave: () => void;
}

/**
 * 叫貨單 / 進貨單 / 調貨單的替換編輯頁共用(草稿、被退回、撤回;補打卡 `MakeupPunchFormPage` 同一套做法):
 * 讀那一筆、能不能編輯沿用表單引擎的判斷(`abilities.canEdit` / `canSaveDraft`),存草稿 / 送出交給
 * `useFormSubmission`(帶 `expectedEditVersion`;送出成功進檢視頁)。不是草稿類的狀態交回表單引擎的預設編輯頁。
 */
export const useDocumentEdit = (
  moduleKey: string,
  id: string,
  texts: { draftSaved: string; submitted: string },
): DocumentEdit => {
  const tFill = useTranslations("admin.formEngine.fill");
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const showSnackbar = useSnackbar();
  const access = useFormModuleAccess(moduleKey);
  const existing = useFormSubmission(id);
  const { submission } = existing;

  const leave = () => {
    if (access.listRoute !== null) {
      void navigate(tabHref(access.listRoute));
    }
  };

  let state: DocumentEditState;
  if (existing.isLoading) {
    state = { kind: "loading" };
  } else if (submission === null) {
    state = {
      kind: "unavailable",
      code: existing.loadError?.code ?? "NOT_FOUND",
    };
  } else if (!isDraftLike(submission.status)) {
    state = { kind: "engine" };
  } else if (submission.abilities.canEdit) {
    state = { kind: "ready", submission };
  } else {
    state = { kind: "unavailable", code: "FORBIDDEN" };
  }

  let notice: ReactNode = null;
  if (submission?.status === FormSubmissionStatus.Returned) {
    notice = <Alert severity="info">{tFill("returnedHint")}</Alert>;
  } else if (submission?.status === FormSubmissionStatus.Withdrawn) {
    notice = <Alert severity="info">{tFill("withdrawnHint")}</Alert>;
  }

  return {
    state,
    notice,
    canSaveDraft: submission?.abilities.canSaveDraft ?? false,
    isPending: existing.isPending,
    error: existing.error,
    saveDraft: (values) => {
      void existing.save(values).then((saved) => {
        if (saved !== null) {
          showSnackbar("success", texts.draftSaved);
        }
      });
    },
    submit: (values) => {
      void existing.submit(values).then((submitted) => {
        if (submitted === null) {
          return;
        }
        showSnackbar("success", texts.submitted);
        if (access.viewRoute === null) {
          leave();
        } else {
          void navigate(`${access.viewRoute}/${submitted.id}`);
        }
      });
    },
    leave,
  };
};
