import { useCallback } from "react";
import { useTranslations } from "use-intl";

import { type AdminError, adminErrorText } from "@/lib/base/errors";

/**
 * `<ns>.errors` 的錯誤文案,加上專案錯誤碼(專案登記的守門擋下)的文案:專案字典有
 * `admin.lifecycle.<碼>` 就用它,否則 `tErrors(code)`(規則見 `lib/base/errors.ts` 的 `adminErrorText`)。
 */
export const useAdminErrorText = (
  namespace: string,
): ((error: Pick<AdminError, "code" | "projectReason">) => string) => {
  const tErrors = useTranslations(namespace);
  const t = useTranslations();
  return useCallback(
    (error) => adminErrorText(error, (code) => tErrors(code), t),
    [tErrors, t],
  );
};
