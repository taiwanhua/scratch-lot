import { Alert } from "@repo/ui/alert";

import {
  type FieldErrorSource,
  lineErrorMessagesOf,
} from "./purchasing-field-errors";

export interface LineErrorAlertsProps {
  /** 送出 / 存草稿失敗的錯誤(`useFormDraft().error`) */
  error: FieldErrorSource;
  /** 明細(陣列欄位)的 key */
  fieldKey: string;
}

/** 明細區的 api 欄位錯誤(整欄與逐列 / 逐格的,一則一行;沒有錯誤時不佔位)。 */
export const LineErrorAlerts = ({ error, fieldKey }: LineErrorAlertsProps) =>
  lineErrorMessagesOf(error, fieldKey).map((message) => (
    <Alert key={message} severity="error">
      {message}
    </Alert>
  ));
