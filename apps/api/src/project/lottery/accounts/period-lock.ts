import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { OrgsRepository } from "../../../database/database.module";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { LotteryPeriodClosesRepository } from "../../database/lottery-accounts/lottery-accounts.repositories";
import { ACCOUNTS_REASONS, validationError } from "./accounts-error";

/** 最後一個已關帳月份(依序關帳:它和更早的月份全都關了)。 */
export interface LastClosedPeriod {
  month: string;
  /** 下月 1 日 00:00(租戶時區;不含):時點 < 它 = 已關帳 */
  periodEnd: Date;
}

/**
 * **「不能選已關帳月份」的唯一檢查**(專案規格 10.4「更正」;正本 `docs/modules/project/accounts.md`「關帳」)。
 * 關帳依序、整個租戶、永遠關到該月最後一刻,所以「時點落在已關帳月份」= 時點 < 最後一個已關帳月份的 `periodEnd`。
 *
 * 只有使用者自己選時間的欄位要檢查:撤銷售出申請的退款班次、現金更正單的位置(某一班)、開班 / 改對應排班選的排班。
 * 其他紀錄(沖正原交易、歸屬班次、撤銷的原售出)可以指向已關帳月份,報表自動歸「前期更正」(報表讀 `lastClosed`)。
 *
 * 讀關帳紀錄以租戶邊界的系統身分(分店的人看不到歸屬是租戶頂層的關帳紀錄,但要被同一條規則擋下)。
 */
@Injectable()
export class PeriodLock {
  constructor(
    private readonly closes: LotteryPeriodClosesRepository,
    private readonly orgs: OrgsRepository,
  ) {}

  /** 最後一個已關帳月份;沒關過 / 沒有租戶 = null。 */
  async lastClosed(
    tenantId: Types.ObjectId | null,
  ): Promise<LastClosedPeriod | null> {
    if (tenantId === null) {
      return null;
    }
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    // `findOne` 不收排序:取最後一筆用 `findMany` + `limit`
    const [last] = await this.closes.findMany(
      reader,
      {},
      { sort: { periodEnd: -1 }, limit: 1, select: "month periodEnd" },
    );
    return last === undefined
      ? null
      : { month: last.month, periodEnd: last.periodEnd };
  }

  /** 這個時點落在已關帳的月份 → 回最後一個已關帳月份;沒有 → null。 */
  async closedPeriodOf(
    tenantId: Types.ObjectId | null,
    at: Date,
  ): Promise<LastClosedPeriod | null> {
    const last = await this.lastClosed(tenantId);
    return last !== null && at < last.periodEnd ? last : null;
  }

  /**
   * 時點落在已關帳的月份 → `VALIDATION_FAILED` + `reason = PERIOD_CLOSED`(`fields` = 選時間的那一欄)。
   * 表單的送出守門不拋錯,改用 `closedPeriodOf` 回擋下(同一個判斷)。
   */
  async assertPeriodOpen(
    tenantId: Types.ObjectId | null,
    at: Date,
    field = "at",
  ): Promise<void> {
    const closed = await this.closedPeriodOf(tenantId, at);
    if (closed !== null) {
      throw validationError(
        `${at.toISOString()} is in a closed period (closed through ${closed.month})`,
        [field],
        ACCOUNTS_REASONS.periodClosed,
      );
    }
  }
}
