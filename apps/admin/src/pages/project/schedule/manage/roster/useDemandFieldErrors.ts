import { useState } from "react";
import { useTranslations } from "use-intl";

import { withoutFieldError } from "@/lib/base/field-errors";

import { scheduleFormatErrorsOf } from "../../schedule-field-errors";
import {
  type DemandField,
  type DemandFieldErrors,
  demandErrorTextsOf,
} from "./demand-dialog-state";

/**
 * 人力需求對話框的欄位錯誤(REACT-18):送出前沒過的欄位寫格式要求、api 錯誤寫原因;
 * `summaryOf` 是提示的那一句(有欄位錯誤時只放通用句);使用者改了欄位就清掉那一欄。
 */
export const useDemandFieldErrors = () => {
  const t = useTranslations("admin.schedule");
  const [fieldErrors, setFieldErrors] = useState<DemandFieldErrors>({});
  return {
    fieldErrors,
    invalid: Object.keys(fieldErrors) as DemandField[],
    summaryOf: (error: unknown) => demandErrorTextsOf(error, t).summary,
    markFromError: (error: unknown) => {
      setFieldErrors(demandErrorTextsOf(error, t).texts);
    },
    markMissing: (missing: readonly DemandField[]) => {
      setFieldErrors(scheduleFormatErrorsOf(missing, t));
    },
    clear: (field: DemandField) => {
      setFieldErrors((current) => withoutFieldError(current, field));
    },
  };
};
