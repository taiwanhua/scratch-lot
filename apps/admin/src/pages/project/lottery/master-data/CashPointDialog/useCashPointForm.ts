import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type LotteryCashPointFieldsFragment,
  useCreateLotteryCashPointMutation,
  useLotteryCashPointsQuery,
  useUpdateLotteryCashPointMutation,
} from "@repo/graphql";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import {
  type FieldErrorTexts,
  withoutFieldError,
} from "@/lib/base/field-errors";

import { masterDataErrorOf } from "../master-data-error";
import {
  masterDataErrorTextsOf,
  masterDataFormatErrorsOf,
} from "../master-data-field-errors";

/** 表單欄位(錯誤標示的 key 與 api `VALIDATION_FAILED` 的 `fields` 同名)。 */
export type CashPointFormField =
  "orgId" | "positionKey" | "name" | "order" | "printerId" | "enabled" | "note";

export interface CashPointFormValues {
  orgId: string;
  positionKey: string;
  name: string;
  /** 輸入中的字串;送出時轉整數 */
  order: string;
  /** 空字串 = 用分店預設 */
  printerId: string;
  enabled: boolean;
  note: string;
}

const FIELDS: readonly CashPointFormField[] = [
  "orgId",
  "positionKey",
  "name",
  "order",
  "printerId",
  "enabled",
  "note",
];

const initialValues = (
  cashPoint: LotteryCashPointFieldsFragment | null,
  defaultOrgId: string,
): CashPointFormValues =>
  cashPoint === null
    ? {
        orgId: defaultOrgId,
        positionKey: "",
        name: "",
        order: "0",
        printerId: "",
        enabled: true,
        note: "",
      }
    : {
        orgId: cashPoint.org.id,
        positionKey: cashPoint.positionKey,
        name: cashPoint.name,
        order: String(cashPoint.order),
        printerId: cashPoint.printer?.id ?? "",
        enabled: cashPoint.enabled,
        note: cashPoint.note ?? "",
      };

const orderOf = (raw: string): number | null => {
  const value = Number(raw.trim());
  return raw.trim() !== "" && Number.isInteger(value) && value >= 0
    ? value
    : null;
};

/** 送出前的檢查:必填與排序(其餘由 api 判,錯誤標回欄位)。 */
const invalidFieldsOf = (values: CashPointFormValues): CashPointFormField[] => {
  const invalid: CashPointFormField[] = [];
  if (values.orgId === "") invalid.push("orgId");
  if (values.positionKey === "") invalid.push("positionKey");
  if (values.name.trim() === "") invalid.push("name");
  if (orderOf(values.order) === null) invalid.push("order");
  return invalid;
};

/**
 * 新增 / 編輯收銀點的表單狀態與送出(初始值只取一次,REACT-08)。
 * 編輯只送改過的欄位(GQL-06:缺席 = 不動;印表機 / 備註清空送 null)。
 */
export const useCashPointForm = (
  cashPoint: LotteryCashPointFieldsFragment | null,
  defaultOrgId: string,
  onDone: () => void,
) => {
  const t = useTranslations("admin.lotteryMasterData");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [initial] = useState(() => initialValues(cashPoint, defaultOrgId));
  const [values, setValues] = useState(initial);
  // 欄位錯了就在欄位正下方寫原因(REACT-18);上方提示只放通用句
  const [fieldErrors, setFieldErrors] = useState<
    FieldErrorTexts<CashPointFormField>
  >({});
  const [errorText, setErrorText] = useState<string | null>(null);
  const errorTextsOf = (error: unknown) =>
    masterDataErrorTextsOf("cashPoint", masterDataErrorOf(error), FIELDS, t);

  const onError = (error: unknown) => {
    const { texts, summary } = errorTextsOf(error);
    setFieldErrors(texts);
    setErrorText(summary);
  };
  const onSuccess = () => {
    void queryClient.invalidateQueries({
      queryKey: useLotteryCashPointsQuery.getKey({ input: {} }).slice(0, 1),
    });
    onDone();
  };
  const feedbackError = (error: unknown) => errorTextsOf(error).summary;
  const create = useCreateLotteryCashPointMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.createSuccess"),
      error: feedbackError,
      onSuccess,
      onError,
    }),
  );
  const update = useUpdateLotteryCashPointMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.saveSuccess"),
      error: feedbackError,
      onSuccess,
      onError,
    }),
  );

  const change = <Key extends keyof CashPointFormValues>(
    key: Key,
    value: CashPointFormValues[Key],
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => withoutFieldError(current, key));
  };

  const submit = () => {
    const invalid = invalidFieldsOf(values);
    setFieldErrors(masterDataFormatErrorsOf("cashPoint", invalid, t));
    setErrorText(null);
    if (invalid.length > 0) {
      return;
    }
    const order = orderOf(values.order) ?? 0;
    const note = values.note.trim() === "" ? null : values.note.trim();
    const printerId = values.printerId === "" ? null : values.printerId;
    if (cashPoint === null) {
      create.mutate({
        input: {
          orgId: values.orgId,
          positionKey: values.positionKey,
          name: values.name.trim(),
          order,
          printerId,
          note,
        },
      });
      return;
    }
    update.mutate({
      input: {
        id: cashPoint.id,
        ...(values.positionKey === initial.positionKey
          ? {}
          : { positionKey: values.positionKey }),
        ...(values.name.trim() === initial.name
          ? {}
          : { name: values.name.trim() }),
        ...(values.order === initial.order ? {} : { order }),
        ...(values.enabled === initial.enabled
          ? {}
          : { enabled: values.enabled }),
        ...(values.printerId === initial.printerId ? {} : { printerId }),
        ...(values.note === initial.note ? {} : { note }),
      },
    });
  };

  return {
    values,
    change,
    fieldErrors,
    errorText,
    isSubmitting: create.isPending || update.isPending,
    submit,
  };
};
