import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import type { OperatorContext } from "../../../database/operator-context";
import {
  ScheduleDemandsRepository,
  SchedulePeriodsRepository,
  ScheduleTaskAssignmentsRepository,
} from "../../database/schedule/roster.repositories";
import { ScheduleDemandTemplatesRepository } from "../../database/schedule/schedule.repositories";
import type { FilledTask } from "../integration/entry-matching";
import type { EntryRecord } from "../roster/roster-people";

/** 一筆排班填進的執行任務與畫面上的簡稱。 */
export interface EntryDetail {
  /** 負責那一筆優先,再依人力需求開始時點 */
  tasks: FilledTask[];
  /** 第一筆執行任務所在人力需求的範本簡稱;未套用範本 / 範本看不到 = null(畫面顯示「臨」) */
  shortName: string | null;
}

const monthOf = (date: string) => date.slice(0, 7);

/**
 * 員工看得到的排班(規格 14.6「只顯示已發布的班」、P10 發布):讀取用的上下文由呼叫端決定
 * (我的班表以租戶為邊界、給刮刮樂的查詢照操作者的可見範圍),這裡只做兩件事 ——
 * 濾掉未發布月份的班、補上填進的執行任務。
 */
@Injectable()
export class PublishedEntries {
  constructor(
    private readonly periods: SchedulePeriodsRepository,
    private readonly assignments: ScheduleTaskAssignmentsRepository,
    private readonly demands: ScheduleDemandsRepository,
    private readonly templates: ScheduleDemandTemplatesRepository,
  ) {}

  /** 只留下所在分店、所在月份已發布的排班(順序不變)。 */
  async publishedOnly(
    reader: OperatorContext,
    tenantId: Types.ObjectId,
    entries: readonly EntryRecord[],
  ): Promise<EntryRecord[]> {
    if (entries.length === 0) {
      return [];
    }
    const periods = await this.periods.findMany(reader, {
      tenantId,
      orgId: { $in: [...new Set(entries.map((entry) => entry.orgId))] },
      month: { $in: [...new Set(entries.map((entry) => monthOf(entry.date)))] },
      status: "published",
    });
    const published = new Set(
      periods.map((period) => `${String(period.orgId)}|${period.month}`),
    );
    return entries.filter((entry) =>
      published.has(`${String(entry.orgId)}|${monthOf(entry.date)}`),
    );
  }

  /** 各排班填進的執行任務(人力需求已不在 / 任務已拿掉的略過)與範本簡稱。 */
  async detailsOf(
    reader: OperatorContext,
    tenantId: Types.ObjectId,
    entries: readonly EntryRecord[],
  ): Promise<Map<string, EntryDetail>> {
    const details = new Map<string, EntryDetail>(
      entries.map((entry) => [
        String(entry._id),
        { tasks: [], shortName: null },
      ]),
    );
    if (entries.length === 0) {
      return details;
    }
    const assignments = await this.assignments.findMany(reader, {
      tenantId,
      entryId: { $in: entries.map((entry) => entry._id) },
    });
    const demands =
      assignments.length === 0
        ? []
        : await this.demands.findMany(reader, {
            tenantId,
            _id: { $in: assignments.map((item) => item.demandId) },
          });
    const demandById = new Map(
      demands.map((demand) => [String(demand._id), demand]),
    );
    const templateIds = demands.flatMap((demand) =>
      demand.templateId === null ? [] : [demand.templateId],
    );
    const templates =
      templateIds.length === 0
        ? []
        : await this.templates.findMany(reader, {
            _id: { $in: templateIds },
          });
    const shortNameOf = new Map(
      templates.map((template) => [String(template._id), template.shortName]),
    );

    const templateOfDemand = new Map<string, string | null>();
    for (const assignment of assignments) {
      const demand = demandById.get(String(assignment.demandId));
      const task = demand?.tasks.find(
        (item) => item.taskId === assignment.taskId,
      );
      const detail = details.get(String(assignment.entryId));
      if (demand === undefined || task === undefined || !detail) {
        continue;
      }
      detail.tasks.push({
        demandId: String(demand._id),
        taskId: task.taskId,
        role: task.role,
        taskKey: task.taskKey,
        positionKey: demand.positionKey,
        demandStartAt: demand.startAt,
      });
      templateOfDemand.set(
        String(demand._id),
        demand.templateId === null ? null : String(demand.templateId),
      );
    }
    for (const detail of details.values()) {
      detail.tasks.sort(
        (left, right) =>
          (left.role === "leader" ? 0 : 1) -
            (right.role === "leader" ? 0 : 1) ||
          left.demandStartAt.getTime() - right.demandStartAt.getTime(),
      );
      const first = detail.tasks.at(0);
      const templateId =
        first === undefined
          ? null
          : (templateOfDemand.get(first.demandId) ?? null);
      detail.shortName =
        templateId === null ? null : (shortNameOf.get(templateId) ?? null);
    }
    return details;
  }
}
