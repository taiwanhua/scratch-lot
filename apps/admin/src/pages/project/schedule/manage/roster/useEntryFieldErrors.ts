import { useState } from "react";
import { useTranslations } from "use-intl";

import { withoutFieldError } from "@/lib/base/field-errors";

import {
  type EntryField,
  type EntryFieldErrors,
  entryErrorTextsOf,
} from "./entry-dialog-state";

/**
 * 排班對話框的欄位錯誤(REACT-18):api 錯誤 → 欄位下的原因,`summaryOf` 是提示的那一句
 * (有欄位錯誤時只放通用句);使用者改了欄位就清掉那一欄。
 */
export const useEntryFieldErrors = () => {
  const t = useTranslations("admin.schedule");
  const [fieldErrors, setFieldErrors] = useState<EntryFieldErrors>({});
  return {
    fieldErrors,
    summaryOf: (error: unknown) => entryErrorTextsOf(error, t).summary,
    /** 標回欄位,回提示的那一句 */
    markFromError: (error: unknown) => {
      const { texts, summary } = entryErrorTextsOf(error, t);
      setFieldErrors(texts);
      return summary;
    },
    clear: (...fields: EntryField[]) => {
      setFieldErrors((current) =>
        fields.reduce(
          (texts, field) => withoutFieldError(texts, field),
          current,
        ),
      );
    },
  };
};
