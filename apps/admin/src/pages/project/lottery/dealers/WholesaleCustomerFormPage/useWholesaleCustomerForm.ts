import { useState } from "react";
import { useTranslations } from "use-intl";

import { WHOLESALE_CUSTOMER_TEXT_LIMITS } from "@repo/domain/project/lottery";
import {
  type LotteryWholesaleCustomerFieldsFragment,
  LotteryWholesaleCustomerStatus,
  useCreateLotteryWholesaleCustomerMutation,
  useUpdateLotteryWholesaleCustomerMutation,
} from "@repo/graphql";

import type { ShareOrgValue } from "@/components/base/ShareOrgsField/ShareOrgsField";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import {
  type FieldErrorTexts,
  fieldErrorTextsOf,
  formErrorSummary,
  withoutFieldError,
} from "@/lib/base/field-errors";

import {
  type DealersError,
  dealersErrorKey,
  dealersErrorOf,
} from "../dealers-error";
import { DEALERS_PERMISSIONS } from "../dealers-keys";
import type { DealersAccess } from "../useDealersAccess";
import { useInvalidateDealers } from "../useInvalidateDealers";

export interface WholesaleCustomerFormValues {
  storeName: string;
  licenseNo: string;
  contactName: string;
  phone: string;
  address: string;
  status: LotteryWholesaleCustomerStatus;
  note: string;
  shareOrgs: ShareOrgValue[];
}

export type WholesaleCustomerFormKey = keyof WholesaleCustomerFormValues;

const KEYS: readonly WholesaleCustomerFormKey[] = [
  "storeName",
  "licenseNo",
  "contactName",
  "phone",
  "address",
  "status",
  "note",
  "shareOrgs",
];

const max = (value: number) => ({ max: String(value) });

/** 每一欄的格式要求(REACT-18;key 寫成字面值,死鍵掃描看得到)。 */
const FORMAT_TEXTS: Record<
  WholesaleCustomerFormKey,
  [string, Record<string, string>?]
> = {
  storeName: [
    "form.fieldErrors.requiredText",
    max(WHOLESALE_CUSTOMER_TEXT_LIMITS.storeName),
  ],
  licenseNo: ["form.fieldErrors.licenseNo"],
  contactName: [
    "form.fieldErrors.maxLength",
    max(WHOLESALE_CUSTOMER_TEXT_LIMITS.contactName),
  ],
  phone: ["form.fieldErrors.digits", max(WHOLESALE_CUSTOMER_TEXT_LIMITS.phone)],
  address: [
    "form.fieldErrors.maxLength",
    max(WHOLESALE_CUSTOMER_TEXT_LIMITS.address),
  ],
  status: ["form.fieldErrors.choose"],
  note: [
    "form.fieldErrors.maxLength",
    max(WHOLESALE_CUSTOMER_TEXT_LIMITS.note),
  ],
  shareOrgs: ["form.fieldErrors.choose"],
};

const initialValues = (
  customer: LotteryWholesaleCustomerFieldsFragment | null,
): WholesaleCustomerFormValues => ({
  storeName: customer?.storeName ?? "",
  licenseNo: customer?.licenseNo ?? "",
  contactName: customer?.contactName ?? "",
  phone: customer?.phone ?? "",
  address: customer?.address ?? "",
  status: customer?.status ?? LotteryWholesaleCustomerStatus.Active,
  note: customer?.note ?? "",
  shareOrgs: (customer?.shareOrgs ?? []).map((entry) => ({
    orgId: entry.orgId,
    includeDescendants: entry.includeDescendants,
  })),
});

/** 選填文字清空 = `null`;店名清空送空字串,由 api 回「必填」。 */
const valueForInput = (
  key: WholesaleCustomerFormKey,
  values: WholesaleCustomerFormValues,
): unknown => {
  const value = values[key];
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === "" && key !== "storeName" ? null : trimmed;
};

/** 新增 / 編輯批售客戶的表單狀態與送出。編輯只送動過的欄位。 */
export const useWholesaleCustomerForm = (
  customer: LotteryWholesaleCustomerFieldsFragment | null,
  access: DealersAccess,
  onSaved: (id: string) => void,
) => {
  const t = useTranslations("admin.lotteryDealers");
  const tErrors = useTranslations("admin.lotteryDealers.errors");
  const { session } = useSession();
  const invalidate = useInvalidateDealers();
  const [values, setValues] = useState(() => initialValues(customer));
  const [touched, setTouched] = useState<ReadonlySet<WholesaleCustomerFormKey>>(
    () => new Set(),
  );
  const [fieldErrors, setFieldErrors] = useState<
    FieldErrorTexts<WholesaleCustomerFormKey>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const create = useCreateLotteryWholesaleCustomerMutation(session.client);
  const update = useUpdateLotteryWholesaleCustomerMutation(session.client);
  // 共用給:新增問權限集、編輯讀 api 算好的 abilities(同經銷商)
  const canShare =
    customer === null
      ? access.has(DEALERS_PERMISSIONS.wholesaleCustomersEdit)
      : customer.abilities.canEdit;

  const errorTextsOf = (parsed: DealersError) => {
    const texts = fieldErrorTextsOf(parsed.fields ?? [], KEYS, (field) =>
      parsed.reason === undefined
        ? t(...FORMAT_TEXTS[field])
        : tErrors(dealersErrorKey(parsed)),
    );
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
      customer === null
        ? t("wholesale.feedback.createSuccess")
        : t("feedback.updateSuccess"),
    error: (failure) => errorTextsOf(dealersErrorOf(failure)).summary,
  });

  const change = <Key extends WholesaleCustomerFormKey>(
    key: Key,
    value: WholesaleCustomerFormValues[Key],
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
    setTouched((current) => new Set([...current, key]));
    setFieldErrors((current) => withoutFieldError(current, key));
  };

  const inputOf = (keys: readonly WholesaleCustomerFormKey[]) =>
    Object.fromEntries(
      keys
        .filter((key) => key !== "shareOrgs" || canShare)
        .map((key) => [key, valueForInput(key, values)]),
    );

  const submit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      let id: string;
      if (customer === null) {
        const data = await create.mutateAsync({ input: inputOf(KEYS) });
        id = data.createLotteryWholesaleCustomer.item.id;
      } else {
        const data = await update.mutateAsync({
          input: {
            ...inputOf(KEYS.filter((key) => touched.has(key))),
            id: customer.id,
          },
        });
        id = data.updateLotteryWholesaleCustomer.item.id;
      }
      feedback.onSuccess();
      await invalidate();
      onSaved(id);
    } catch (error_) {
      const { texts, summary } = errorTextsOf(dealersErrorOf(error_));
      setFieldErrors(texts);
      setError(summary);
      feedback.onError(error_);
    } finally {
      setIsSubmitting(false);
    }
  };

  return { values, change, canShare, fieldErrors, error, isSubmitting, submit };
};
