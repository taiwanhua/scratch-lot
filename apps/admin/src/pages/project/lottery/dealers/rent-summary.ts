import type { LotteryRentCycle } from "@repo/graphql";

import { RENT_CYCLE_LABELS } from "./dealer-labels";

type Translate = (key: string, values?: Record<string, string>) => string;

/** 牌租區塊收合時的摘要(Figma DE-03「3,000 元 / 月」、DE-05「3,000 元 / 月 · 每月 5 日」)。 */
export const rentSummaryOf = (
  t: Translate,
  rent: {
    fee: number | null;
    cycle: LotteryRentCycle | null;
    dueDay: number | null;
  },
): string => {
  if (rent.fee === null || Number.isNaN(rent.fee) || rent.cycle === null) {
    return t("summary.rentNone");
  }
  const fee = rent.fee.toLocaleString("en-US");
  const cycle = t(RENT_CYCLE_LABELS[rent.cycle]);
  return rent.dueDay === null || Number.isNaN(rent.dueDay)
    ? t("summary.rent", { fee, cycle })
    : t("summary.rentDue", { fee, cycle, day: String(rent.dueDay) });
};
