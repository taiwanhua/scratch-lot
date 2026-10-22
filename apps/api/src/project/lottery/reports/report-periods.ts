import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { CHECKOUT_TYPE } from "@repo/domain/project/lottery";
import {
  addPeriodMonths,
  periodMonthOf,
} from "@repo/domain/project/lottery-accounts";

import { LotteryPeriodClosesRepository } from "../../database/lottery-accounts/lottery-accounts.repositories";
import { LotteryCheckoutsRepository } from "../../database/lottery-checkouts/lottery-checkouts.repository";
import type { ReportScope } from "./report-scope";

/** 一家店實際用的期間。 */
export interface StorePeriod {
  orgId: Types.ObjectId;
  from: Date;
  to: Date;
  /** `period` 照選的期間 / `dailyClose` 對齊日結 / `fullDay` 要對齊但當天沒有日結,改用整天 */
  alignment: "period" | "dailyClose" | "fullDay";
}

/**
 * 報表的期間與關帳(規格 11.1、10.4):
 *
 * - **對齊日結**(只有日):每家店用「上一次日結 至 當天日結」= 當天送出的日結的涵蓋計算期間
 *   (`coveredFrom` ~ `coveredTo`;當天有多張取最後一張;第一次日結沒有起點 → 用當天 00:00);
 *   當天沒有日結的店改用整天(`fullDay`,畫面與工作表標示「本店 10/13 未日結…」)
 * - **關帳**:各月份的關帳時間(判斷前期更正)、期間涵蓋的尚未關帳月份
 */
@Injectable()
export class ReportPeriods {
  constructor(
    private readonly checkouts: LotteryCheckoutsRepository,
    private readonly closes: LotteryPeriodClosesRepository,
  ) {}

  async storePeriodsOf(
    scope: ReportScope,
    alignDailyClose: boolean,
  ): Promise<StorePeriod[]> {
    if (!alignDailyClose) {
      return scope.storeIds.map((orgId) => ({
        orgId,
        from: scope.from,
        to: scope.to,
        alignment: "period",
      }));
    }
    const dailies = await this.checkouts.findMany(
      scope.reader,
      {
        orgId: { $in: scope.storeIds },
        type: CHECKOUT_TYPE.daily,
        coveredTo: { $gte: scope.from, $lt: scope.to },
      },
      { sort: { coveredTo: -1 }, select: "orgId coveredFrom coveredTo" },
    );
    return scope.storeIds.map((orgId): StorePeriod => {
      const daily = dailies.find((row) => row.orgId.equals(orgId));
      if (daily?.coveredTo == null) {
        return { orgId, from: scope.from, to: scope.to, alignment: "fullDay" };
      }
      return {
        orgId,
        from: daily.coveredFrom ?? scope.from,
        to: daily.coveredTo,
        alignment: "dailyClose",
      };
    });
  }

  /** 各已關帳月份(`YYYY-MM`)→ 關帳時間。 */
  async closedAtByMonth(scope: ReportScope): Promise<Map<string, Date>> {
    if (scope.lastClosed === null) {
      return new Map();
    }
    const rows = await this.closes.findMany(
      scope.reader,
      {},
      { select: "month closedAt" },
    );
    return new Map(rows.map((row) => [row.month, row.closedAt]));
  }
}

/**
 * 「指向已關帳月份、關帳之後才記」的判斷(前期更正,規格 10.4「更正」):被指到的時點(原班的開班、原交易、
 * 原售出)落在已關帳的月份,而且這筆紀錄記在那個月關帳之後。
 */
export function isPriorPeriodOf(
  scope: Pick<ReportScope, "lastClosed" | "timezone">,
  closedAt: ReadonlyMap<string, Date>,
  pointerAt: Date,
  recordedAt: Date,
): boolean {
  const last = scope.lastClosed;
  if (last === null || pointerAt >= last.periodEnd) {
    return false;
  }
  const month = periodMonthOf(pointerAt.getTime(), scope.timezone);
  const at = closedAt.get(month) ?? new Date(0);
  return recordedAt >= at;
}

/** 期間涵蓋、還沒關帳的月份(`YYYY-MM`,由舊到新)。 */
export function openMonthsOf(
  scope: Pick<ReportScope, "lastClosed" | "timezone">,
  from: Date,
  to: Date,
): string[] {
  const first = periodMonthOf(from.getTime(), scope.timezone);
  const last = periodMonthOf(to.getTime() - 1, scope.timezone);
  const months: string[] = [];
  for (
    let month = first;
    month <= last && months.length < 3;
    month = addPeriodMonths(month, 1)
  ) {
    if (scope.lastClosed === null || month > scope.lastClosed.month) {
      months.push(month);
    }
  }
  return months;
}
