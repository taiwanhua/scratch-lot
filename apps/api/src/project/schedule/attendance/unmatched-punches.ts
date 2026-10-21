import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  addLocalCalendar,
  localDateOf,
  localDateText,
  parseLocalDate,
  startOfLocalDay,
} from "@repo/domain/form";

import type { OperatorContext } from "../../../database/operator-context";
import { ScheduleAttendancePunchesRepository } from "../../database/schedule/roster.repositories";

/** 一張未對應排班的打卡(排班作業用的形狀)。 */
export interface UnmatchedPunch {
  id: string;
  userId: string;
  /** 打卡時點的租戶當地日期 `YYYY-MM-DD` */
  date: string;
  type: string;
  at: Date;
}

/**
 * 某家店某段日期打的、未對應排班的卡(規格 14.5「未對應排班的打卡」):班表格子的時鐘圖示、
 * 週 / 日 / 月檢視的圖示、排班對話框的區塊、檢核面板「未對應排班的打卡」共用。
 * 照操作者的可見範圍讀(這家店要看得到;呼叫端已確認)。
 */
@Injectable()
export class UnmatchedPunchesReader {
  constructor(private readonly punches: ScheduleAttendancePunchesRepository) {}

  async of(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    timezone: string,
    range: { from: string; to: string },
  ): Promise<UnmatchedPunch[]> {
    const start = parseLocalDate(range.from);
    const end = parseLocalDate(range.to);
    if (start === null || end === null) {
      return [];
    }
    const records = await this.punches.findMany(
      operator,
      {
        orgId,
        entryId: null,
        at: {
          $gte: new Date(startOfLocalDay(start, timezone)),
          $lt: new Date(
            addLocalCalendar(
              startOfLocalDay(end, timezone),
              1,
              "days",
              timezone,
            ),
          ),
        },
      },
      { sort: { at: 1, _id: 1 } },
    );
    return records.map((record) => ({
      id: String(record._id),
      userId: String(record.userId),
      date: localDateText(localDateOf(record.at.getTime(), timezone)),
      type: record.type,
      at: record.at,
    }));
  }
}
