import { useState } from "react";
import { useTranslations } from "use-intl";

import { PRINTER_DEFAULT_PORT } from "@repo/domain/printing";
import {
  type PrinterFieldsFragment,
  useCreatePrinterMutation,
  useSetPrinterEnabledMutation,
  useUpdatePrinterMutation,
} from "@repo/graphql";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import { printersErrorOf } from "../printers-error";
import { useInvalidatePrinters } from "../usePrintersLookups";

/** 表單上的欄位(錯誤標示的 key 與 api `VALIDATION_FAILED` 的 `fields` 同名)。 */
export type PrinterFormField = "orgId" | "agentId" | "name" | "host" | "port";

export interface PrinterFormValues {
  orgId: string;
  agentId: string;
  name: string;
  host: string;
  /** 輸入中的字串;送出時轉整數 */
  port: string;
  paperWidth: number;
  isDefault: boolean;
  enabled: boolean;
}

/** 底座只支援 58mm(`@repo/domain/printing` 的 `PRINTER_PAPER_WIDTHS`)。 */
const DEFAULT_PAPER_WIDTH = 58;
const MAX_PORT = 65_535;

const initialValues = (
  printer: PrinterFieldsFragment | null,
): PrinterFormValues =>
  printer === null
    ? {
        orgId: "",
        agentId: "",
        name: "",
        host: "",
        port: String(PRINTER_DEFAULT_PORT),
        paperWidth: DEFAULT_PAPER_WIDTH,
        isDefault: false,
        enabled: true,
      }
    : {
        orgId: printer.orgId,
        agentId: printer.agentId,
        name: printer.name,
        host: printer.host,
        port: String(printer.port),
        paperWidth: printer.paperWidth,
        isDefault: printer.isDefault,
        enabled: printer.enabled,
      };

/** 連接埠:1–65535 的整數;不合法回 null。 */
const portOf = (raw: string): number | null => {
  const value = Number(raw.trim());
  return Number.isInteger(value) && value >= 1 && value <= MAX_PORT
    ? value
    : null;
};

/** 送出前的檢查:必填與連接埠範圍(其餘由 api 判,錯誤標回欄位)。 */
const invalidFieldsOf = (values: PrinterFormValues): PrinterFormField[] => {
  const invalid: PrinterFormField[] = [];
  if (values.orgId === "") invalid.push("orgId");
  if (values.agentId === "") invalid.push("agentId");
  if (values.name.trim() === "") invalid.push("name");
  if (values.host.trim() === "") invalid.push("host");
  if (portOf(values.port) === null) invalid.push("port");
  return invalid;
};

const FORM_FIELDS = new Set<string>([
  "orgId",
  "agentId",
  "name",
  "host",
  "port",
]);

/**
 * 新增 / 編輯印表機的表單狀態與送出(REACT-08:彈窗關閉即卸載,初始值只取一次)。
 *
 * - 新增 = `createPrinter`(分店 = 代理程式的分店,所以「所屬組織」只用來篩代理程式);
 * - 編輯 = `updatePrinter`,啟用開關有變再接 `setPrinterEnabled`。兩步算一次「儲存」,
 *   提示只在整段結束後跳一則(DATA-06)。
 */
export const usePrinterForm = (
  printer: PrinterFieldsFragment | null,
  onSaved: () => void,
) => {
  const t = useTranslations("admin.printers");
  const tErrors = useTranslations("admin.printers.errors");
  const { session } = useSession();
  const invalidate = useInvalidatePrinters();
  const [values, setValues] = useState(() => initialValues(printer));
  const [invalidFields, setInvalidFields] = useState<PrinterFormField[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const create = useCreatePrinterMutation(session.client);
  const update = useUpdatePrinterMutation(session.client);
  const setEnabled = useSetPrinterEnabledMutation(session.client);
  const feedback = useMutationFeedback({
    success:
      printer === null
        ? t("feedback.createSuccess")
        : t("feedback.updateSuccess"),
    error: (error) => tErrors(printersErrorOf(error).code),
  });

  const change = <Key extends keyof PrinterFormValues>(
    key: Key,
    value: PrinterFormValues[Key],
  ) => {
    setValues((current) => ({
      ...current,
      [key]: value,
      // 換組織 → 原本選的代理程式不屬於新組織,清掉重選
      ...(key === "orgId" && value !== current.orgId && { agentId: "" }),
    }));
    setInvalidFields((current) => current.filter((field) => field !== key));
  };

  const submit = async () => {
    const invalid = invalidFieldsOf(values);
    setInvalidFields(invalid);
    const port = portOf(values.port);
    if (invalid.length > 0 || port === null) {
      return;
    }
    setIsSubmitting(true);
    try {
      if (printer === null) {
        await create.mutateAsync({
          input: {
            agentId: values.agentId,
            name: values.name.trim(),
            host: values.host.trim(),
            port,
            paperWidth: values.paperWidth,
            isDefault: values.isDefault,
          },
        });
      } else {
        await update.mutateAsync({
          input: {
            id: printer.id,
            agentId: values.agentId,
            name: values.name.trim(),
            host: values.host.trim(),
            port,
            isDefault: values.isDefault,
          },
        });
        if (values.enabled !== printer.enabled) {
          await setEnabled.mutateAsync({
            input: { id: printer.id, enabled: values.enabled },
          });
        }
      }
      feedback.onSuccess();
      await invalidate();
      onSaved();
    } catch (error) {
      setInvalidFields(
        (printersErrorOf(error).fields ?? []).filter(
          (field): field is PrinterFormField => FORM_FIELDS.has(field),
        ),
      );
      feedback.onError(error);
      // 兩步儲存可能第一步(updatePrinter)已經寫進去、第二步(setPrinterEnabled)才失敗:清單照樣重取
      await invalidate();
    } finally {
      setIsSubmitting(false);
    }
  };

  return { values, change, invalidFields, isSubmitting, submit };
};
