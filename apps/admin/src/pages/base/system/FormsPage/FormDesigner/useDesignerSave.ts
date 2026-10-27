import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";

import type { FormDefinition } from "@repo/domain/form";
import {
  type FormVersionsQuery,
  useFormVersionsQuery,
  useSaveFormVersionDraftMutation,
} from "@repo/graphql";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { rawOf } from "@/lib/base/form-engine/definition";
import {
  type FormError,
  formErrorOf,
} from "@/lib/base/form-engine/form-errors";
import { useDesignerDraftStore } from "@/stores/base/useDesignerDraftStore";

export interface DesignerSaveInput {
  formKey: string;
  initialRevision: number;
  definition: FormDefinition;
  isDirty: boolean;
  markSaved: (saved: FormDefinition) => void;
  onSaved: () => void;
}

export interface DesignerSave {
  revision: number;
  /** 存草稿;成功回新的草稿修訂號、失敗回 null(帶 `expectedDraftRevision`,不符 → `CONFLICT`) */
  save: () => Promise<number | null>;
  isPending: boolean;
  error: FormError | null;
}

/**
 * 設計器的「存草稿」,並把「有沒有未存的變更 + 怎麼存」回報給 `useDesignerDraftStore`:
 * 換表單時的攔截、發布跳窗的「先存草稿」都走同一支 `save`(REACT-06:store action 在 effect 內呼叫)。
 *
 * 存成功當下就把新的草稿(含新的 `draftRevision`)寫進版本清單的快取(`formVersions`),不等 `onSaved` 觸發的重查:
 * 版本面板的「發布」帶的 `expectedDraftRevision` 取自那份清單,存完馬上去發布時重查還沒回來,
 * 會帶舊的修訂號被 api 以 `CONFLICT` 擋下(「已被別人更新」)。
 */
export const useDesignerSave = ({
  formKey,
  initialRevision,
  definition,
  isDirty,
  markSaved,
  onSaved,
}: DesignerSaveInput): DesignerSave => {
  const t = useTranslations("admin.forms.designer");
  const tErrors = useTranslations("admin.forms.errors");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [revision, setRevision] = useState(initialRevision);
  const [error, setError] = useState<FormError | null>(null);
  const mutation = useSaveFormVersionDraftMutation(session.client);
  const feedback = useMutationFeedback<unknown>({
    success: t("saved"),
    error: (failure) => tErrors(formErrorOf(failure).code),
  });
  const report = useDesignerDraftStore((state) => state.report);
  const clear = useDesignerDraftStore((state) => state.clear);

  const save = async (): Promise<number | null> => {
    const snapshot = definition;
    setError(null);
    try {
      const payload = await mutation.mutateAsync({
        input: {
          formKey,
          expectedDraftRevision: revision,
          ...rawOf(snapshot),
        },
      });
      const savedVersion = payload.saveFormVersionDraft.formVersion;
      const next = savedVersion.draftRevision;
      setRevision(next);
      queryClient.setQueryData<FormVersionsQuery>(
        useFormVersionsQuery.getKey({ formKey }),
        (current) =>
          current === undefined
            ? current
            : {
                ...current,
                formVersions: {
                  ...current.formVersions,
                  items: current.formVersions.items.map((item) =>
                    item.id === savedVersion.id
                      ? { ...item, ...savedVersion }
                      : item,
                  ),
                },
              },
      );
      markSaved(snapshot);
      feedback.onSuccess(payload);
      onSaved();
      return next;
    } catch (error_) {
      setError(formErrorOf(error_));
      feedback.onError(error_);
      return null;
    }
  };

  // store 裡放的是身分穩定的包裝(永遠呼叫最新一版的 save),
  // 否則每次 render 都回報新函式 → 訂閱 `save` 的元件重繪 → 設計器重繪,無限循環
  const latestSave = useRef(save);
  useEffect(() => {
    latestSave.current = save;
  });
  const stableSave = useCallback(() => latestSave.current(), []);
  useEffect(() => {
    report(formKey, isDirty, stableSave);
  }, [report, formKey, isDirty, stableSave]);
  useEffect(
    () => () => {
      clear(formKey);
    },
    [clear, formKey],
  );

  return { revision, save, isPending: mutation.isPending, error };
};
