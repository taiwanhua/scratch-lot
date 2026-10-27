import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";

import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { storeErrorKey } from "@/lib/project/lottery/store-error";
import { storeSalesErrorOf } from "@/lib/project/lottery/store-sales-error";
import { localPartsOf } from "@/lib/project/schedule-roster";

import { SALES_ERROR_KEYS } from "./sales-text";

/**
 * 銷售各視窗共用的文字:時間(租戶時區的 `HH:mm`)、錯誤訊息(銷售類的碼用 `salesErrors`,
 * 其他照店面管理的 `errors`;「已於 hh:mm 售出」帶時間)。
 */
export const useSalesText = () => {
  const t = useTranslations("admin.lotteryStore");
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const clock = (iso: string): string => localPartsOf(iso, timezone).time;
  const errorText = (error: unknown): string => {
    const parsed = storeSalesErrorOf(error);
    if (parsed.code === null) {
      return t(storeErrorKey(error));
    }
    return t(SALES_ERROR_KEYS[parsed.code], {
      time: parsed.soldAt === null ? "" : clock(parsed.soldAt),
    });
  };
  return { t, clock, errorText };
};
