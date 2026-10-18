import {
  addLocalCalendar,
  parseLocalDate,
  startOfLocalDay,
  toInstant,
  toIso,
} from "@repo/domain/form";

import { localDayInstantOf } from "./form-engine/local-day";

const MS_PER_MINUTE = 60_000;

/**
 * 代理期間與日期選擇器之間的換算,照「日期只有一種做法」:
 * 選的是最上層組織時區的日期;起 = 那一天 00:00、迄 = 結束那一天的 24:00(= 隔天 00:00,不含)。
 */

/** 開始日(`YYYY-MM-DD`)→ 那一天 00:00 的 ISO;沒選 / 不是日期 → null。 */
export const delegationStartOf = (
  day: string | null,
  timezone: string,
): string | null => localDayInstantOf(day, timezone);

/** 結束日(`YYYY-MM-DD`)→ 那一天 24:00(隔天 00:00)的 ISO;沒選 / 不是日期 → null。 */
export const delegationEndOf = (
  day: string | null,
  timezone: string,
): string | null => {
  const date = parseLocalDate(day);
  return date === null
    ? null
    : toIso(
        addLocalCalendar(startOfLocalDay(date, timezone), 1, "days", timezone),
      );
};

/**
 * 迄日的顯示時點:存的是隔天 00:00(不含),清單顯示成結束那一天的 23:59;
 * 不是時點 → null。
 */
export const delegationEndShownAt = (endAt: unknown): string | null => {
  const instant = toInstant(endAt);
  return instant === null ? null : toIso(instant - MS_PER_MINUTE);
};
