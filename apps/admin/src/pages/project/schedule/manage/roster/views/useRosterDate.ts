import { z } from "zod";

import { localMonthText, parseLocalDate } from "@repo/domain/form";

import { useTenantToday } from "@/hooks/base/useTenantToday";
import { useUrlState } from "@/hooks/base/useUrlState";
import { rosterDateOf } from "@/lib/project/schedule-roster-views";

/** `?date=YYYY-MM-DD`:週 / 日檢視顯示的那一天(週檢視 = 那一天所在的週);空字串 = 今天或這個月 1 日。 */
export const ROSTER_DATE_SCHEMA = z.string().default("");
/** 同頁殼的 `?month=` / `?view=`(只寫入,讀取由頁殼負責)。 */
const MONTH_SCHEMA = z.string().default("");
const VIEW_SCHEMA = z.string().default("");

/** 日檢視在網址 `?view=` 的值(`roster-views.ts` 登記的同一個)。 */
export const DAY_VIEW = "day";

/**
 * 週 / 日檢視的日期(網址 `?date=`,規格 14.5「檢視與月份 / 日期放網址參數」):`date` 是目前顯示的那一天,
 * `goTo` 換一天(換到別的月份時同時換 `?month=`,排班表跟著讀那個月)。
 */
export const useRosterDate = (
  month: string,
): { date: string; today: string; goTo: (date: string) => void } => {
  const [param, setParam] = useUrlState("date", ROSTER_DATE_SCHEMA);
  const [, setMonth] = useUrlState("month", MONTH_SCHEMA);
  const today = useTenantToday();
  return {
    date: rosterDateOf(param, month, today),
    today,
    goTo: (date) => {
      setParam(date);
      const day = parseLocalDate(date);
      const nextMonth = day === null ? month : localMonthText(day);
      if (nextMonth !== month) {
        setMonth(nextMonth);
      }
    },
  };
};

/** 切到某一天的日檢視(月檢視點日期數字、週檢視「+N」清單 [看整天]、手機週清單點一天)。 */
export const useShowDay = (): ((date: string) => void) => {
  const [, setParam] = useUrlState("date", ROSTER_DATE_SCHEMA);
  const [, setView] = useUrlState("view", VIEW_SCHEMA);
  return (date) => {
    setParam(date);
    setView(DAY_VIEW);
  };
};
