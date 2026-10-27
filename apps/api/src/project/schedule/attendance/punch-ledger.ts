import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import type { Persisted } from "../../../database/base.repository";
import type { OperatorContext } from "../../../database/operator-context";
import {
  type ScheduleAttendancePunchDocument,
  ScheduleAttendancePunchesRepository,
} from "../../database/schedule/roster.repositories";
import { type PunchLike, duplicatePunchIdsOf } from "../my/punch-rules";

export type PunchRecord = Persisted<ScheduleAttendancePunchDocument>;

export const punchLikeOf = (record: PunchRecord): PunchLike => ({
  id: String(record._id),
  entryId: record.entryId === null ? null : String(record.entryId),
  type: record.type,
  at: record.at,
});

/**
 * 打卡表的寫入(規格 14.1 `schedule_attendance_punches`:只新增;時間與類型不能改,對應排班可以改)。
 * 打卡、補打卡核准、改對應排班、排班對話框對應未對應排班的打卡都經這裡,重複打卡的標記只有一個算法。
 * 都在呼叫端的交易內呼叫。
 */
@Injectable()
export class SchedulePunchLedger {
  constructor(private readonly punches: ScheduleAttendancePunchesRepository) {}

  /**
   * 重算一班的「重複打卡」標記(只改有變的那幾張),回傳這班所有的卡(id → 重算後)。
   * 上班取最早、下班取最晚,其餘標重複(`punch-rules.ts` 的 `duplicatePunchIdsOf`)。
   */
  async markDuplicates(
    writer: OperatorContext,
    tenantId: Types.ObjectId,
    entryId: Types.ObjectId,
  ): Promise<Map<string, PunchRecord>> {
    const all = await this.punches.findMany(
      writer,
      { tenantId, entryId },
      { sort: { at: 1, _id: 1 } },
    );
    const duplicates = duplicatePunchIdsOf(
      all.map((record) => punchLikeOf(record)),
    );
    const result = new Map<string, PunchRecord>();
    for (const record of all) {
      const duplicate = duplicates.has(String(record._id));
      if (record.duplicate === duplicate) {
        result.set(String(record._id), record);
        continue;
      }
      const updated = await this.punches.updateById(writer, record._id, {
        $set: { duplicate },
      });
      result.set(String(record._id), updated ?? record);
    }
    return result;
  }

  /**
   * 把幾張卡改對應到某一筆排班(`entryId = null` = 改成未對應排班):卡的分店跟著排班
   * (打卡的分店 = 對應排班的分店,別家店的班用搬家 `reassignOrg`,要有操作者、在交易內;
   * 未對應排班時留原分店)。原本那一班與新的那一班都重算重複打卡;
   * 未對應排班的卡一律不標重複。
   */
  async reassign(
    writer: OperatorContext,
    tenantId: Types.ObjectId,
    records: readonly PunchRecord[],
    target: { entryId: Types.ObjectId; orgId: Types.ObjectId } | null,
  ): Promise<void> {
    const touched = new Map<string, Types.ObjectId>();
    for (const record of records) {
      if (record.entryId !== null) {
        touched.set(String(record.entryId), record.entryId);
      }
      await this.punches.updateById(writer, record._id, {
        $set:
          target === null
            ? { entryId: null, duplicate: false }
            : { entryId: target.entryId },
      });
      if (target !== null && !record.orgId.equals(target.orgId)) {
        // 打卡的分店 = 對應排班的分店:對應到別家店的班,卡跟著搬家(寫 data.reassign-org 稽核)
        await this.punches.reassignOrg(
          writer,
          { _id: record._id },
          target.orgId,
        );
      }
    }
    if (target !== null) {
      touched.set(String(target.entryId), target.entryId);
    }
    for (const entryId of touched.values()) {
      await this.markDuplicates(writer, tenantId, entryId);
    }
  }
}
