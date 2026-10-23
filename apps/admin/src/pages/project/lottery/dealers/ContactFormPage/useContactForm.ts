import { useState } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import {
  type LotteryContactRole,
  LotteryContactStatus,
  type LotteryDealerContactFieldsFragment,
  useCreateLotteryDealerContactMutation,
  useUpdateLotteryDealerContactMutation,
} from "@repo/graphql";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import {
  type FieldErrorTexts,
  formErrorSummary,
  withoutFieldError,
} from "@/lib/base/field-errors";
import {
  localDayInstantOf,
  localDayTextOf,
} from "@/lib/base/form-engine/local-day";

import { dealerFieldErrorsOf } from "../dealer-field-errors";
import {
  type ConflictRelationship,
  type DealersError,
  conflictHiddenCountOf,
  conflictRelationshipsOf,
  dealersErrorKey,
  dealersErrorOf,
} from "../dealers-error";
import { useInvalidateDealers } from "../useInvalidateDealers";

export interface ContactFormValues {
  name: string;
  roles: LotteryContactRole[];
  nationalId: string;
  birthday: string | null;
  phone: string;
  mobile: string;
  email: string;
  mailingAddress: string;
  residentialAddress: string;
  residentialSameAsMailing: boolean;
  status: LotteryContactStatus;
  note: string;
}

export type ContactFormKey = keyof ContactFormValues;

const KEYS: readonly ContactFormKey[] = [
  "name",
  "roles",
  "nationalId",
  "birthday",
  "phone",
  "mobile",
  "email",
  "mailingAddress",
  "residentialAddress",
  "residentialSameAsMailing",
  "status",
  "note",
];

const initialValues = (
  contact: LotteryDealerContactFieldsFragment | null,
  timezone: string,
): ContactFormValues => ({
  name: contact?.name ?? "",
  roles: contact?.roles ?? [],
  nationalId: contact?.nationalId ?? "",
  birthday:
    contact === null ? null : localDayTextOf(contact.birthday, timezone),
  phone: contact?.phone ?? "",
  mobile: contact?.mobile ?? "",
  email: contact?.email ?? "",
  mailingAddress: contact?.mailingAddress ?? "",
  residentialAddress: contact?.residentialAddress ?? "",
  residentialSameAsMailing: contact?.residentialSameAsMailing ?? false,
  status: contact?.status ?? LotteryContactStatus.Active,
  note: contact?.note ?? "",
});

const valueForInput = (
  key: ContactFormKey,
  values: ContactFormValues,
  timezone: string,
): unknown => {
  const value = values[key];
  if (key === "birthday") {
    return localDayInstantOf(values.birthday, timezone);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  return value;
};

/**
 * 新增 / 編輯關係人的表單狀態與送出。編輯只送動過的欄位;取消的身分還有關聯 → api 回 `CONFLICT`,
 * 開確認框列出關聯,確認後帶 `releaseRelationships` 重送(規格 5.3)。
 */
export const useContactForm = (
  contact: LotteryDealerContactFieldsFragment | null,
  onSaved: (id: string) => void,
) => {
  const t = useTranslations("admin.lotteryDealers");
  const tErrors = useTranslations("admin.lotteryDealers.errors");
  const { session } = useSession();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const invalidate = useInvalidateDealers();
  const [values, setValues] = useState(() => initialValues(contact, timezone));
  const [touched, setTouched] = useState<ReadonlySet<ContactFormKey>>(
    () => new Set(),
  );
  const [fieldErrors, setFieldErrors] = useState<
    FieldErrorTexts<ContactFormKey>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    relationships: ConflictRelationship[];
    hiddenCount: number;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const create = useCreateLotteryDealerContactMutation(session.client);
  const update = useUpdateLotteryDealerContactMutation(session.client);
  /** api 錯誤 → 欄位下的原因與頁面提示(REACT-18:有欄位錯誤時頁面只放通用句)。 */
  const errorTextsOf = (parsed: DealersError) => {
    const texts = dealerFieldErrorsOf(parsed, KEYS, t);
    return {
      texts,
      summary: formErrorSummary(
        texts,
        tErrors(parsed.code),
        tErrors(dealersErrorKey(parsed)),
      ),
    };
  };
  const feedback = useMutationFeedback({
    success:
      contact === null
        ? t("feedback.contactCreateSuccess")
        : t("feedback.updateSuccess"),
    error: (failure) => errorTextsOf(dealersErrorOf(failure)).summary,
  });

  const change = <Key extends ContactFormKey>(
    key: Key,
    value: ContactFormValues[Key],
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
    setTouched((current) => new Set([...current, key]));
    setFieldErrors((current) => withoutFieldError(current, key));
  };

  const inputOf = (keys: readonly ContactFormKey[]) =>
    Object.fromEntries(
      keys.map((key) => [key, valueForInput(key, values, timezone)]),
    );

  const submit = async (releaseRelationships = false) => {
    setIsSubmitting(true);
    setError(null);
    try {
      let id: string;
      if (contact === null) {
        const data = await create.mutateAsync({ input: inputOf(KEYS) });
        id = data.createLotteryDealerContact.item.id;
      } else {
        const data = await update.mutateAsync({
          input: {
            ...inputOf(KEYS.filter((key) => touched.has(key))),
            id: contact.id,
            ...(releaseRelationships && { releaseRelationships: true }),
          },
        });
        id = data.updateLotteryDealerContact.item.id;
      }
      setConflict(null);
      feedback.onSuccess();
      await invalidate();
      onSaved(id);
    } catch (error_) {
      const parsed = dealersErrorOf(error_);
      if (parsed.reason === "ROLE_IN_USE") {
        setConflict({
          relationships: conflictRelationshipsOf(error_),
          hiddenCount: conflictHiddenCountOf(error_),
        });
        return;
      }
      const { texts, summary } = errorTextsOf(parsed);
      setFieldErrors(texts);
      setError(summary);
      feedback.onError(error_);
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    values,
    change,
    fieldErrors,
    error,
    conflict,
    closeConflict: () => {
      setConflict(null);
    },
    isSubmitting,
    submit,
  };
};
