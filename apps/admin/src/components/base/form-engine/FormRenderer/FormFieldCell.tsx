import { createElement } from "react";
import { useTranslations } from "use-intl";

import type { FieldDef } from "@repo/domain/form";

import type {
  FieldUiState,
  FormRendererMode,
} from "@/lib/base/form-engine/field-states";
import type { FilterLinkValues } from "@/lib/base/form-engine/filter-links";
import type { FormFieldErrorLike } from "@/lib/base/form-engine/form-errors";
import type { FormDisplayItemLike } from "@/lib/base/form-engine/value-text";

import { widgetOf } from "../widgets/widget-registry";
import type { WidgetContext } from "../widgets/widget-types";
import { DerivedFieldCell } from "./DerivedFieldCell";

export interface FormFieldCellProps {
  field: FieldDef;
  state: FieldUiState;
  value: unknown;
  mode: FormRendererMode;
  context: WidgetContext;
  onChange: (fieldKey: string, value: unknown) => void;
  /** api 回的值錯誤(`VALIDATION_FAILED` 的 `fieldErrors`) */
  errorMessage?: string | null;
  /** 明細列:這一欄的全部值錯誤(每格以 `rowId` + `columnKey` 定位,列數錯誤在表尾) */
  errors?: readonly FormFieldErrorLike[];
  /** 明細列唯讀:子欄的顯示名 */
  columnDisplay?: (columnKey: string) => readonly FormDisplayItemLike[];
  display?: readonly FormDisplayItemLike[];
  onDownload?: (field: FieldDef) => void;
  /** 連動篩選(B2d)被引用欄位的目前值;引用欄與明細欄才給 */
  filterLinks?: FilterLinkValues;
}

/**
 * 一欄(欄位級三態之後的「看得到」那兩態):
 * - 唯讀模式(詳情)→ **同一個 widget 走 `isReadOnly`**(Spec 6a §8 畫面 11:不是停用 —— 文字不變灰、
 *   附件可下載、選項 / 引用顯示 label);計算 / 固定值欄位也一樣
 * - 計算 / 固定值欄位(設計畫布、填寫、預覽)→ **有框的唯讀輸入框**(同其他停用欄位的外觀,Spec 6a §5 表 A 下方),
 *   內容是顯示值(計算欄位缺依賴時是「—」)
 * - 其餘 → 登錄表的 widget;唯讀(沒有欄位級 edit、`readonlyWhen`)時停用並附原因
 */
/** 唯讀原因 → 欄位下方的說明文字(計算 / 唯讀模式不另附說明)。 */
const REASON_TEXT_KEYS: Partial<
  Record<
    NonNullable<FieldUiState["readonlyReason"]>,
    "readonlyPermission" | "readonlyCondition"
  >
> = { permission: "readonlyPermission", condition: "readonlyCondition" };

/** 明細列才用的 props(有給才帶)。 */
const arrayPropsOf = (
  errors: FormFieldCellProps["errors"],
  columnDisplay: FormFieldCellProps["columnDisplay"],
) => ({
  ...(errors !== undefined && { errors }),
  ...(columnDisplay !== undefined && { columnDisplay }),
});

export const FormFieldCell = ({
  field,
  state,
  value,
  mode,
  context,
  onChange,
  errorMessage,
  errors,
  columnDisplay,
  display,
  onDownload,
  filterLinks,
}: FormFieldCellProps) => {
  const t = useTranslations("admin.formEngine.renderer");
  const help = field.help ?? "";
  const isReadOnly = mode === "readonly";

  if (!isReadOnly && field.valueSource.kind !== "input") {
    return (
      <DerivedFieldCell
        field={field}
        value={value}
        text={{
          empty: t("empty"),
          yes: t("yes"),
          no: t("no"),
          unavailable: t("sourceUnavailable"),
        }}
        errorMessage={errorMessage ?? null}
        {...(display !== undefined && { display })}
        {...(context.timezone !== undefined && { timezone: context.timezone })}
      />
    );
  }

  // 唯讀檢視保留欄位說明,但不附唯讀原因(整頁都是唯讀,不是這一欄特別改不了)
  const reason = isReadOnly ? null : state.readonlyReason;
  const reasonKey = reason === null ? undefined : REASON_TEXT_KEYS[reason];
  const reasonText = reasonKey === undefined ? null : t(reasonKey);
  // 明細列的錯誤由表格自己分到格與表尾(`errors`),不蓋掉欄位說明
  const error = field.type === "array" ? null : (errorMessage ?? null);
  const helperText = error ?? reasonText ?? (help === "" ? undefined : help);
  // 登錄表查到的是模組層常數元件(不是 render 內建立的),以 createElement 掛上
  return createElement(widgetOf(field.widget.kind), {
    field,
    value,
    onChange: (next: unknown) => {
      onChange(field.key, next);
    },
    isDisabled: !isReadOnly && state.readonly,
    isReadOnly,
    isDesign: mode === "design",
    ...(helperText !== undefined && { helperText }),
    hasError: errorMessage !== undefined && errorMessage !== null,
    context,
    ...(display !== undefined && { display }),
    ...(onDownload !== undefined && { onDownload }),
    ...(filterLinks !== undefined && { filterLinks }),
    ...arrayPropsOf(errors, columnDisplay),
  });
};
