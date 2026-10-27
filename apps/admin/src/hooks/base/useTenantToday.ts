import { useState } from "react";

import {
  DEFAULT_TENANT_TIMEZONE,
  localDateOf,
  localDateText,
} from "@repo/domain/form";

import { useTenantTimezone } from "./useTenantTimezone";

/**
 * 租戶時區的今天(`YYYY-MM-DD`):給月曆的 `today`、預設日期、「本月」這類以「今天」為準的地方。
 * 時區取 `useTenantTimezone`(`me.currentOrg.timezone`),還沒載到時用 `DEFAULT_TENANT_TIMEZONE`;
 * 不用瀏覽器時區(瀏覽器可能和租戶不在同一個時區)。
 * 「此刻」在掛載時取一次:同一個畫面停留跨過午夜,今天不會自己換。
 */
export const useTenantToday = (): string => {
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const [now] = useState(() => Date.now());
  return localDateText(localDateOf(now, timezone));
};
