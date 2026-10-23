import { z } from "zod";

import { useMyScheduleDayOffsQuery } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";
import {
  isMonth,
  isPastDayOffMonth,
  shiftMonth,
} from "@/lib/project/schedule-day-offs";

/**
 * `?month=YYYY-MM`:看過去的月份(唯讀);空字串 = 目標月(api 決定:下個月)。
 * 往前不限;不早於目標月的值不採用(往後只到目標月)。
 */
const MONTH_SCHEMA = z.string().default("");

/**
 * 我的畫休要顯示哪個月(同班表分頁的換月,月份放網址):目標月一律查(`input: null`,由 api 決定),
 * 網址指到更早的月份才另查那個月(api 回 `canEdit=false` → 唯讀)。
 *
 * - `query`:顯示中那個月的查詢
 * - `atTarget`:已經在目標月(▶ 停用)
 * - `isPast`:顯示中是過去的月份(早於這個月,`isPastDayOffMonth`;這個月不算)
 * - `goMonth(±1)`:換月;回到目標月就清掉網址參數
 */
export const useMyDayOffsMonth = () => {
  const { session } = useSession();
  const [monthParam, setMonth] = useUrlState("month", MONTH_SCHEMA);
  const targetQuery = useMyScheduleDayOffsQuery(session.client, {
    input: null,
  });
  const targetMonth = targetQuery.data?.myScheduleDayOffs.month ?? null;
  const pastMonth =
    targetMonth !== null && isMonth(monthParam) && monthParam < targetMonth
      ? monthParam
      : null;
  const pastQuery = useMyScheduleDayOffsQuery(
    session.client,
    { input: { month: pastMonth ?? "" } },
    { enabled: pastMonth !== null },
  );
  const query = pastMonth === null ? targetQuery : pastQuery;
  const shown = query.data?.myScheduleDayOffs.month ?? null;

  return {
    query,
    atTarget: targetMonth === null || shown === null || shown >= targetMonth,
    isPast:
      targetMonth !== null &&
      shown !== null &&
      isPastDayOffMonth(shown, targetMonth),
    goMonth: (delta: number) => {
      if (targetMonth === null || shown === null) {
        return;
      }
      const next = shiftMonth(shown, delta);
      setMonth(next >= targetMonth ? "" : next);
    },
  };
};
