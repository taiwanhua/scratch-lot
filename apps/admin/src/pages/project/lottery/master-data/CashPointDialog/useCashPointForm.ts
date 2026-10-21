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
  type MasterDataErrorCode,
  masterDataErrorOf,
} from "../master-data-error";

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
  const [invalidFields, setInvalidFields] = useState<CashPointFormField[]>([]);
  const [errorCode, setErrorCode] = useState<MasterDataErrorCode | null>(null);

  const onError = (error: unknown) => {
    const parsed = masterDataErrorOf(error);
    setErrorCode(parsed.code);
    setInvalidFields(
      (parsed.fields ?? []).filter((field): field is CashPointFormField =>
        Object.hasOwn(initial, field),
      ),
    );
  };
  const onSuccess = () => {
    void queryClient.invalidateQueries({
      queryKey: useLotteryCashPointsQuery.getKey({ input: {} }).slice(0, 1),
    });
    onDone();
  };
  const feedbackError = (error: unknown) =>
    t(`errors.${masterDataErrorOf(error).code}`);
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
    setInvalidFields((current) => current.filter((field) => field !== key));
  };

  const submit = () => {
    const invalid = invalidFieldsOf(values);
    setInvalidFields(invalid);
    setErrorCode(null);
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
    invalidFields,
    errorCode,
    isSubmitting: create.isPending || update.isPending,
    submit,
  };
};
