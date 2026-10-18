import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import type { FieldDef } from "@repo/domain/form";
import { TextField } from "@repo/ui/text-field";

import { useTemporalText } from "@/hooks/base/useTemporalText";
import {
  type FormDisplayItemLike,
  displayTextOf,
  isEmptyDisplay,
} from "@/lib/base/form-engine/value-text";

import type { WidgetContext } from "./widget-types";

export interface ReadOnlyFieldProps {
  field: FieldDef;
  value: unknown;
  context: WidgetContext;
  /** 類別 / lookup 選項與引用欄的顯示名(現名或快照) */
  display?: readonly FormDisplayItemLike[];
  /** 欄位說明(help);唯讀檢視照樣顯示,不附唯讀原因 */
  helperText?: ReactNode;
  /** 不畫標題、標題改當 `aria-label`(明細列的表格格子,見 `WidgetProps.hiddenLabel`) */
  hiddenLabel?: boolean;
}

/**
 * widget 的唯讀分支共用的外框(唯讀 = 同一套填寫元件走 `readOnly`):
 * 與填寫時同樣的有框輸入框、同樣的標籤位置,但**不是停用** —— 文字照一般顏色、可選取複製、不能改。
 * 內容 = 顯示文字:數字帶單位、選項 / 引用是 label(`displayValues` 的現名或快照 +「(來源不可用)」)、
 * 日期 / 日期時間以 `context.timezone`(讀者的租戶時區)印;空值「—」。多行文字欄是多行框(同填寫時),其餘單行。
 */
export const ReadOnlyField = ({
  field,
  value,
  context,
  display,
  helperText,
  hiddenLabel = false,
}: ReadOnlyFieldProps) => {
  const t = useTranslations("admin.formEngine.renderer");
  const temporalText = useTemporalText(context.timezone);
  const text =
    (field.type === "date" || field.type === "datetime") &&
    !isEmptyDisplay(value)
      ? temporalText(value, field.type)
      : displayTextOf({
          field,
          value,
          text: {
            empty: t("empty"),
            yes: t("yes"),
            no: t("no"),
            unavailable: t("sourceUnavailable"),
          },
          ...(display !== undefined && { display }),
        });

  return (
    <TextField
      label={hiddenLabel ? undefined : field.label}
      value={text}
      fullWidth
      size="small"
      {...(helperText !== undefined && { helperText })}
      {...(field.type === "multiline" && { multiline: true })}
      slotProps={{
        htmlInput: {
          readOnly: true,
          ...(hiddenLabel && { "aria-label": field.label }),
        },
      }}
    />
  );
};
