import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type DataScopeCombineOp,
  type SaveDataScopeRuleMutation,
  useSaveDataScopeRuleMutation,
} from "@repo/graphql";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import {
  type RuleIssue,
  issueFromRuleInvalid,
  issuesByKey,
  validateEditorDraft,
} from "@/lib/base/data-scope-issues";
import {
  type RuleDraft,
  type RuleEditorDraft,
  newRule,
  toEditorDraft,
  toRuleEntryInputs,
} from "@/lib/base/data-scope-rule";

import { type DataScopeError, dataScopeErrorOf } from "../data-scope-error";
import type { DataScopeRuleData, DataScopeTarget } from "../data-scope-types";

export interface UseRuleEditorOptions {
  target: DataScopeTarget;
  /** 這個目標目前存著的規則(`null` = 尚無規則) */
  rule: DataScopeRuleData | null;
  /** 儲存成功後失效相關查詢 */
  onSaved: (targetId: string) => void;
  /** 有沒有未儲存的變更 — 由頁面接住,切換資料目標前先問 */
  onDirtyChange: (isDirty: boolean) => void;
}

/**
 * 規則編輯器的狀態:草稿、問題標記、儲存。
 *
 * **草稿只在事件裡換**(REACT-06 禁止 effect 內 setState):切資料目標由頁面換 `key` 讓整個
 * 編輯器重新掛載(初始值走 `useState` 的初始化器,REACT-08);儲存成功則直接把
 * mutation 回來的那份規則設回草稿。因此這裡沒有任何 effect。
 *
 * 問題有兩個來源、同一種形狀:送出前的本地驗證(一次標完)與 api 的 `RULE_INVALID`
 * (一次只回第一個)。兩者都是 `RuleIssue`,元件只認 `issues` 這張表。
 */
export const useRuleEditor = ({
  target,
  rule,
  onSaved,
  onDirtyChange,
}: UseRuleEditorOptions) => {
  const t = useTranslations("admin.dataScope");
  const tErrors = useTranslations("admin.dataScope.errors");
  const { session } = useSession();
  const [draft, setDraft] = useState<RuleEditorDraft>(() =>
    toEditorDraft(rule),
  );
  const [localIssues, setLocalIssues] = useState<readonly RuleIssue[]>([]);
  const [serverIssue, setServerIssue] = useState<RuleIssue | null>(null);
  const [error, setError] = useState<DataScopeError | null>(null);

  const clearIssues = () => {
    setLocalIssues([]);
    setServerIssue(null);
    setError(null);
  };

  /** 任何一次改動都讓頁面知道「髒了」,並清掉上一輪的錯誤(使用者已經在修了)。 */
  const change = (next: RuleEditorDraft) => {
    setDraft(next);
    clearIssues();
    onDirtyChange(true);
  };

  const save = useSaveDataScopeRuleMutation(
    session.client,
    useMutationFeedback<SaveDataScopeRuleMutation>({
      success: t("feedback.saveSuccess"),
      // 失敗的 Snackbar 講「這次沒存成功」;`RULE_INVALID` 指到的那一條仍標在編輯器上(#376)
      error: (failure) => tErrors(dataScopeErrorOf(failure).code),
      onSuccess: (payload) => {
        setDraft(toEditorDraft(payload.saveDataScopeRule.rule));
        clearIssues();
        onDirtyChange(false);
        onSaved(target.id);
      },
      onError: (failure: unknown) => {
        const parsed = dataScopeErrorOf(failure);
        setError(parsed);
        setServerIssue(
          parsed.path === undefined || parsed.reason === undefined
            ? null
            : issueFromRuleInvalid(parsed.path, parsed.reason),
        );
      },
    }),
  );

  /** 送出前先本地驗證:有問題就全部標出來、不送(api 一次只回第一個,來回修很慢)。 */
  const submit = () => {
    const issues = validateEditorDraft(draft, target.fields);
    setLocalIssues(issues);
    setServerIssue(null);
    setError(null);
    if (issues.length > 0) {
      return;
    }
    save.mutate({
      input: {
        targetId: target.id,
        combineOp: draft.combineOp,
        rules: toRuleEntryInputs(draft),
      },
    });
  };

  const discard = () => {
    setDraft(toEditorDraft(rule));
    clearIssues();
    onDirtyChange(false);
  };

  return {
    draft,
    issues: issuesByKey([
      ...localIssues,
      ...(serverIssue === null ? [] : [serverIssue]),
    ]),
    error,
    isSaving: save.isPending,
    submit,
    discard,
    setCombineOp: (combineOp: DataScopeCombineOp) => {
      change({ ...draft, combineOp });
    },
    addRule: () => {
      if (target.fields.length === 0) {
        return;
      }
      change({ ...draft, rules: [...draft.rules, newRule(target.fields[0])] });
    },
    updateRule: (index: number, next: RuleDraft) => {
      change({
        ...draft,
        rules: draft.rules.map((item, position) =>
          position === index ? next : item,
        ),
      });
    },
    removeRule: (index: number) => {
      change({
        ...draft,
        rules: draft.rules.filter((_, position) => position !== index),
      });
    },
  };
};
