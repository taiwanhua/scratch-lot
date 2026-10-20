import { useState } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import {
  type LotteryDealerFieldsFragment,
  LotteryDealerType,
  useCreateLotteryDealerMutation,
  useUpdateLotteryDealerMutation,
} from "@repo/graphql";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";

import {
  type ConflictRelationship,
  conflictRelationshipsOf,
  dealersErrorKey,
  dealersErrorOf,
} from "../dealers-error";
import { DEALERS_PERMISSIONS } from "../dealers-keys";
import type { DealersAccess } from "../useDealersAccess";
import { useInvalidateDealers } from "../useInvalidateDealers";
import {
  type DealerFormKey,
  type DealerFormValues,
  emptyValues,
  formKeyOf,
  inputOf,
  valuesOf,
} from "./dealer-form-values";

/** 欄位級權限欄在這個表單的狀態:看不看得到、改不改得動。 */
export interface ProtectedFieldState {
  isVisible: boolean;
  isWritable: boolean;
}

/**
 * 新增 / 編輯經銷商的表單狀態與送出。
 *
 * - 新增送全部欄位;編輯只送動過的欄位(GQL-06:缺席 = 不動)
 * - 兩個批購基準日是欄位級權限欄:沒有 `show-` 不顯示、沒有 `edit-` 唯讀且不送
 * - 移除共同銷售處所但還有代理人 → api 回 `CONFLICT`,開確認框列出代理人;確認後帶 `releaseAgents` 重送
 */
export const useDealerForm = (
  dealer: LotteryDealerFieldsFragment | null,
  access: DealersAccess,
  onSaved: (id: string) => void,
) => {
  const t = useTranslations("admin.lotteryDealers");
  const tErrors = useTranslations("admin.lotteryDealers.errors");
  const { session } = useSession();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const invalidate = useInvalidateDealers();
  const [values, setValues] = useState<DealerFormValues>(() =>
    dealer === null
      ? emptyValues(LotteryDealerType.A)
      : valuesOf(dealer, timezone),
  );
  const [touched, setTouched] = useState<ReadonlySet<DealerFormKey>>(
    () => new Set(),
  );
  const [invalidFields, setInvalidFields] = useState<DealerFormKey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictRelationship[] | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const create = useCreateLotteryDealerMutation(session.client);
  const update = useUpdateLotteryDealerMutation(session.client);
  const feedback = useMutationFeedback({
    success:
      dealer === null
        ? t("feedback.createSuccess")
        : t("feedback.updateSuccess"),
    error: (failure) => tErrors(dealersErrorKey(dealersErrorOf(failure))),
  });

  const isCreate = dealer === null;
  const protectedField = (
    show: string,
    edit: string,
    ability: boolean | undefined,
  ): ProtectedFieldState => {
    const isVisible = access.has(show);
    return {
      isVisible,
      isWritable: isVisible && (isCreate ? access.has(edit) : ability === true),
    };
  };
  const protectedFields: Partial<Record<DealerFormKey, ProtectedFieldState>> = {
    lastPurchaseBaseDate: protectedField(
      DEALERS_PERMISSIONS.showLastPurchaseBaseDate,
      DEALERS_PERMISSIONS.editLastPurchaseBaseDate,
      dealer?.abilities.canEditLastPurchaseBaseDate,
    ),
    lastSelfPurchaseBaseDate: protectedField(
      DEALERS_PERMISSIONS.showLastSelfPurchaseBaseDate,
      DEALERS_PERMISSIONS.editLastSelfPurchaseBaseDate,
      dealer?.abilities.canEditLastSelfPurchaseBaseDate,
    ),
  };
  const writable = (key: DealerFormKey): boolean =>
    protectedFields[key]?.isWritable ?? true;

  const change = <Key extends DealerFormKey>(
    key: Key,
    value: DealerFormValues[Key],
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
    setTouched((current) => new Set([...current, key]));
    setInvalidFields((current) => current.filter((field) => field !== key));
  };

  const submit = async (releaseAgents = false) => {
    setIsSubmitting(true);
    setError(null);
    try {
      let savedId: string;
      if (dealer === null) {
        const data = await create.mutateAsync({
          input: {
            ...inputOf(values, { timezone, touched: null, writable }),
            type: values.type,
          },
        });
        savedId = data.createLotteryDealer.item.id;
      } else {
        const data = await update.mutateAsync({
          input: {
            ...inputOf(values, { timezone, touched, writable }),
            id: dealer.id,
            ...(releaseAgents && { releaseAgents: true }),
          },
        });
        savedId = data.updateLotteryDealer.item.id;
      }
      setConflict(null);
      feedback.onSuccess();
      await invalidate();
      onSaved(savedId);
    } catch (error_) {
      const parsed = dealersErrorOf(error_);
      if (parsed.reason === "AGENTS_REQUIRE_CO_SALES") {
        setConflict(conflictRelationshipsOf(error_));
        return;
      }
      setInvalidFields(
        (parsed.fields ?? [])
          .map((field) => formKeyOf(field))
          .filter((key): key is DealerFormKey => key !== null),
      );
      setError(tErrors(dealersErrorKey(parsed)));
      feedback.onError(error_);
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    values,
    change,
    touched,
    invalidFields,
    error,
    conflict,
    closeConflict: () => {
      setConflict(null);
    },
    isSubmitting,
    submit,
    protectedFields,
    isDirty: touched.size > 0,
  };
};

export type DealerForm = ReturnType<typeof useDealerForm>;
