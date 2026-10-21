import { Injectable } from "@nestjs/common";
import { GraphQLError } from "graphql";

import { isIsoMonth } from "@repo/domain/project/schedule-settings";

import { AuditService } from "../../../audit/audit.service";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { TransactionService } from "../../../database/transaction";
import { NotificationService } from "../../../notifications/notification.service";
import {
  ScheduleEntriesRepository,
  SchedulePeriodsRepository,
} from "../../database/schedule/roster.repositories";
import { SCHEDULE_PUBLISHED } from "../../notifications";
import { isAutoRunLocked, lockExpiredBefore } from "../auto-run/period-lock";
import { RosterPeopleReader } from "../roster/roster-people";
import { monthRange } from "../roster/schedule-roster.service";
import { ScheduleClock } from "../shared/schedule-clock";
import { isDuplicateKeyError, validationError } from "../shared/schedule-error";
import { type ScheduleOrg, resolveScheduleOrg } from "../shared/schedule-org";
import type { PublishSchedulePayload } from "./models/schedule-check.model";
import { ScheduleCheckService } from "./schedule-check.service";

const PERIOD_TARGET = "schedule_period";
/** 檢查完到寫入之間有人改了排班(版本不同)→ 重新檢查,最多這麼多次。 */
const MAX_ATTEMPTS = 3;

/**
 * 發布被擋(規格 14.5「有違反限制 → 不能發布」):`VALIDATION_FAILED`(欄位 `month`),
 * `extensions.reason`:`HAS_LIMIT_VIOLATIONS`(附 `limitCount`)/ `ALREADY_PUBLISHED` / `CHANGED_DURING_PUBLISH` /
 * `AUTO_RUN_IN_PROGRESS`(自動排班執行中鎖定這個月,`auto-run/period-lock.ts`)。
 */
export function publishBlockedError(
  reason:
    | "HAS_LIMIT_VIOLATIONS"
    | "ALREADY_PUBLISHED"
    | "CHANGED_DURING_PUBLISH"
    | "AUTO_RUN_IN_PROGRESS",
  extra: Record<string, unknown> = {},
): GraphQLError {
  return new GraphQLError(`cannot publish: ${reason}`, {
    extensions: {
      code: "VALIDATION_FAILED",
      fields: ["month"],
      reason,
      ...extra,
    },
  });
}

/** 還沒發布、也沒有自動排班鎖定中(否則 `ALREADY_PUBLISHED` / `AUTO_RUN_IN_PROGRESS`)。 */
function assertPublishable(
  period: { status: string; lockedAt?: Date | null } | null,
  now: Date,
): asserts period is { status: string; lockedAt?: Date | null } {
  if (period === null || period.status === "published") {
    throw publishBlockedError("ALREADY_PUBLISHED");
  }
  if (isAutoRunLocked(period, now)) {
    throw publishBlockedError("AUTO_RUN_IN_PROGRESS");
  }
}

/**
 * 發布(規格 14.5「發布」;正本 `docs/modules/project/schedule.md`「檢核與發布」):
 *
 * - 用發布當下最新的生效設定重新檢查整個月(`ScheduleCheckService.evaluateOrg`,含人力不足);
 *   有違反限制 → 不能發布;只有提醒照樣發布
 * - 未發布 → 已發布只有這一個方向:以「狀態仍是未發布、版本沒變」為條件更新(沒有取消發布的端點);
 *   同時也 `$inc` 版本,和同一個月的人力需求 / 排班寫入互相衝突
 * - 通知這個月在這家店被排到的人(`schedule.published`)
 */
@Injectable()
export class SchedulePublishService {
  constructor(
    private readonly periods: SchedulePeriodsRepository,
    private readonly entries: ScheduleEntriesRepository,
    private readonly orgs: OrgsRepository,
    private readonly checks: ScheduleCheckService,
    private readonly audit: AuditService,
    private readonly transactions: TransactionService,
    private readonly notifications: NotificationService,
    private readonly people: RosterPeopleReader,
    private readonly clock: ScheduleClock,
  ) {}

  async publish(
    operator: OperatorContext,
    input: { orgId?: string | null; month: string },
  ): Promise<PublishSchedulePayload> {
    if (!isIsoMonth(input.month)) {
      throw validationError(`invalid month: ${String(input.month)}`, ["month"]);
    }
    const org = await resolveScheduleOrg(operator, this.orgs, input.orgId);
    await this.ensurePeriod(operator, org, input.month);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const period = await this.periods.findOne(operator, {
        orgId: org.id,
        month: input.month,
      });
      assertPublishable(period, this.clock.now());
      const result = await this.checks.evaluateOrg(operator, org, input.month);
      if (result.limitCount > 0) {
        throw publishBlockedError("HAS_LIMIT_VIOLATIONS", {
          limitCount: result.limitCount,
        });
      }
      const published = await this.transactions.withTransaction(async () => {
        const updated = await this.periods.findOneAndUpdate(
          operator,
          {
            orgId: org.id,
            month: input.month,
            status: "unpublished",
            version: period.version,
            // 查完到寫入之間有人按了自動排班(標記鎖定)→ 不發布
            $or: [
              { lockedAt: null },
              { lockedAt: { $lt: lockExpiredBefore(this.clock.now()) } },
            ],
          },
          {
            $set: {
              status: "published",
              publishedAt: this.clock.now(),
              publishedBy: operator.actorId,
            },
            $inc: { version: 1 },
          },
        );
        if (updated === null) {
          return null;
        }
        await this.audit.record(operator, {
          action: "schedule-period.publish",
          targetType: PERIOD_TARGET,
          targetId: updated._id,
          before: { month: input.month, status: "unpublished" },
          after: {
            month: input.month,
            status: "published",
            reminders: result.reminderCount,
          },
        });
        const notified = await this.notifyScheduled(operator, org, input.month);
        return { updated, notified };
      });
      if (published !== null) {
        const names = await this.people.namesOf(
          operator.actorId === null ? [] : [operator.actorId],
        );
        return {
          period: {
            status: published.updated.status,
            publishedAt: published.updated.publishedAt,
            publishedByName:
              operator.actorId === null
                ? null
                : (names.get(String(operator.actorId)) ?? null),
          },
          notifiedCount: published.notified,
        };
      }
    }
    throw publishBlockedError("CHANGED_DURING_PUBLISH");
  }

  /** 這個月在這家店被排到的人;回通知的人數。 */
  private async notifyScheduled(
    operator: OperatorContext,
    org: ScheduleOrg,
    month: string,
  ): Promise<number> {
    const { from, to } = monthRange(month);
    const records = await this.entries.findMany(operator, {
      orgId: org.id,
      date: { $gte: from, $lte: to },
    });
    const userIds = [
      ...new Set(records.map((record) => String(record.userId))),
    ];
    if (userIds.length === 0) {
      return 0;
    }
    await this.notifications.notify({
      type: SCHEDULE_PUBLISHED,
      tenantId: org.tenantId,
      orgId: org.id,
      recipients: { kind: "users", userIds },
      params: { orgName: org.name, month },
      dedupeKey: `${SCHEDULE_PUBLISHED}:${String(org.id)}:${month}`,
    });
    return userIds.length;
  }

  /** 這個月還沒有任何寫入時先建好狀態文件(未發布;同時建時唯一索引擋下的那一個略過)。 */
  private async ensurePeriod(
    operator: OperatorContext,
    org: ScheduleOrg,
    month: string,
  ): Promise<void> {
    const key = { orgId: org.id, month };
    if (await this.periods.findOne(operator, key)) {
      return;
    }
    try {
      await this.periods.create(operator, {
        ...key,
        status: "unpublished",
        publishedAt: null,
        publishedBy: null,
        lockedAt: null,
        lockedBy: null,
        version: 0,
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }
  }
}
