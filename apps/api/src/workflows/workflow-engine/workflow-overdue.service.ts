import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  type OverdueReminderDef,
  isLiveInstanceStatus,
  stepOf,
} from "@repo/domain/workflow";

import {
  WorkflowInstancesRepository,
  WorkflowVersionsRepository,
} from "../../database/database.module";
import { TransactionService } from "../../database/transaction";
import {
  type WorkflowTaskRecord,
  WorkflowTasksRepository,
} from "../../database/workflow-tasks.repository";
import {
  WORKFLOW_INSTANCE_REF,
  WORKFLOW_OVERDUE,
} from "../../notifications/base-notification-types";
import { NotificationService } from "../../notifications/notification.service";
import { ScheduledJobRegistry } from "../../scheduled-jobs/scheduled-job-registry";
import { systemContext } from "../tenant-directory.service";
import { definitionOfVersion } from "../workflow-definition-input";
import {
  AudienceSourceService,
  emptySourceReason,
} from "./audience-source.service";
import { type InstanceRecord, delegatorIdsOf } from "./instance-writes";
import { nextOverdueDueAt, overdueOf } from "./overdue-timer";
import { StepEntryService } from "./step-entry.service";
import { WorkflowNotifier } from "./workflow-notifier.service";

/** 排程工作 key(`scheduled_job_runs` 的執行紀錄也用它)。 */
export const WORKFLOW_OVERDUE_JOB_KEY = "workflow.overdue-reminders";

/** 每個租戶一次最多處理幾張到期任務(依到期時點由早到晚);沒處理到的下一輪(15 分鐘後)接著處理。 */
const SWEEP_BATCH = 500;

/** 一張任務提醒失敗後,到期時點往後延多久(一個排程週期)。 */
export const OVERDUE_RETRY_DELAY_MS = 15 * 60_000;
const RETRY_DELAY_MS = OVERDUE_RETRY_DELAY_MS;

/**
 * 逾時提醒:B14 排程每 15 分鐘檢查一次,經 B7 `notify()` 發 `workflow.overdue`。
 * **只提醒,不改任務、關卡、實例的狀態**(不自動核准或駁回)。
 *
 * | 情況                   | 結果                                                                 |
 * | ---------------------- | -------------------------------------------------------------------- |
 * | 超過 N 小時未處理      | 通知目前的審核者一次(第 1 級);代理承接時連被代理者(`delegatorIds`)一起 |
 * | 超過 M 小時未處理      | 通知「通知對象」一次(第 2 級);審核者不在名單裡(不重複收到)          |
 * | 任務改派               | 新的承辦人重新計時、從第 1 級開始(推進同步投影時重設,`overdue-timer.ts`) |
 * | 任務在排程跑之前已處理 | 不通知(只撈 `pending`,交易內再讀一次)                              |
 * | 夜間、假日             | 照算(日曆小時)                                                       |
 * | 這一關沒有開啟         | 任務沒有到期時點,不檢查                                              |
 * | 第 2 級算不到通知對象  | 不通知、記 warn(原因見 `emptySourceReason`)                          |
 *
 * 冪等:任務記「這一次指派已通知到第幾級」(`overdueLevel`)與下一級的到期時點(`overdueDueAt`),
 * 每張任務一個交易:再讀一次 → 通知 → 條件更新級數(條件含讀到的級數與指派時點);通知的 `dedupeKey`
 * = 類型 + 任務 + 指派時點 + 級數,即 `(taskId, level)` 以「這一次指派」為單位。一張失敗只回復那一張、記 log,
 * 到期時點往後延一個排程週期(不擋住同租戶其他到期任務);一個租戶整批出錯只記 log,其他租戶照跑。
 */
@Injectable()
export class WorkflowOverdueService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowOverdueService.name);

  constructor(
    private readonly tasks: WorkflowTasksRepository,
    private readonly instances: WorkflowInstancesRepository,
    private readonly versions: WorkflowVersionsRepository,
    private readonly entries: StepEntryService,
    private readonly sources: AudienceSourceService,
    private readonly notifications: NotificationService,
    private readonly notifier: WorkflowNotifier,
    private readonly transactions: TransactionService,
    private readonly scheduledJobs: ScheduledJobRegistry,
  ) {}

  onModuleInit(): void {
    this.scheduledJobs.registerScheduledJob({
      key: WORKFLOW_OVERDUE_JOB_KEY,
      every: "15m",
      handler: (context) =>
        this.sweep(
          new Date(),
          context.tenants.map((tenant) => tenant.tenantId),
        ),
    });
  }

  /**
   * 檢查這些租戶(根組織 `null` 沒有任務,略過)到期的待處理任務。每個租戶各自 try/catch(同列印的
   * `runScheduledSweep`):一個租戶出錯只記 log,其他租戶照跑。
   */
  async sweep(
    now: Date,
    tenantIds: readonly (Types.ObjectId | null)[],
  ): Promise<void> {
    for (const tenantId of tenantIds) {
      if (tenantId === null) {
        continue;
      }
      try {
        await this.sweepTenant(tenantId, now);
      } catch (error) {
        this.logger.error(
          `租戶 ${String(tenantId)} 的逾時提醒檢查失敗(下一輪重試):${messageOf(error)}`,
        );
      }
    }
  }

  private async sweepTenant(
    tenantId: Types.ObjectId,
    now: Date,
  ): Promise<void> {
    const due = await this.tasks.findMany(
      tenantId,
      { status: "pending", overdueDueAt: { $ne: null, $lte: now } },
      { sort: { overdueDueAt: 1 }, limit: SWEEP_BATCH },
    );
    for (const task of due) {
      try {
        await this.transactions.withTransaction(() =>
          this.remindOnce(tenantId, task._id, now),
        );
      } catch (error) {
        this.logger.error(
          `任務 ${String(task._id)} 的逾時提醒失敗(延後一個排程週期再試):${messageOf(error)}`,
        );
        await this.deferAfterFailure(tenantId, task._id, now);
      }
    }
  }

  /**
   * 失敗的任務把到期時點往後延一個排程週期:否則同一批失敗的任務一直排在最前面,超過一批的上限後
   * 其他到期任務輪不到。交易已回復,這裡在交易外單獨寫一次;再失敗也只記 log(下一輪照舊會撈到它)。
   */
  private async deferAfterFailure(
    tenantId: Types.ObjectId,
    taskId: Types.ObjectId,
    now: Date,
  ): Promise<void> {
    try {
      await this.tasks.updateOne(
        systemContext(),
        tenantId,
        { _id: taskId, status: "pending", overdueDueAt: { $ne: null } },
        { $set: { overdueDueAt: new Date(now.getTime() + RETRY_DELAY_MS) } },
      );
    } catch (error) {
      this.logger.error(
        `任務 ${String(taskId)} 的逾時提醒延後失敗:${messageOf(error)}`,
      );
    }
  }

  /** 一張任務(一個交易):再讀一次、算到第幾級、通知、記級數。 */
  private async remindOnce(
    tenantId: Types.ObjectId,
    taskId: Types.ObjectId,
    now: Date,
  ): Promise<void> {
    const task = await this.tasks.findOne(tenantId, {
      _id: taskId,
      status: "pending",
      overdueDueAt: { $ne: null, $lte: now },
    });
    if (task === null) {
      return;
    }
    const instance = await this.instances.findOne(systemContext(), {
      _id: task.instanceId,
    });
    const step =
      instance === null ? null : await this.overdueStepOf(instance, task);
    if (instance === null || step === null) {
      // 實例已結束 / 關卡不在進行中 / 這一關沒開:不再排
      await this.saveLevel(tenantId, task, task.overdueLevel, null);
      return;
    }
    const { overdue } = step;
    const assignedAt = task.assignedAt ?? task.createdAt;
    const reached = (level: number): boolean => {
      const at = nextOverdueDueAt(overdue, assignedAt, level);
      return at !== null && now >= at;
    };
    let level = task.overdueLevel;
    if (level < 1 && reached(0)) {
      await this.notify(instance, task, reviewersOf(instance, task), {
        level: 1,
        hours: overdue.reviewerAfterHours,
        stepName: step.name,
        assignedAt,
      });
      level = 1;
    }
    if (level < 2 && reached(1)) {
      await this.notify(
        instance,
        task,
        await this.audienceOf(instance, task, overdue),
        {
          level: 2,
          hours: overdue.audienceAfterHours,
          stepName: step.name,
          assignedAt,
        },
      );
      level = 2;
    }
    await this.saveLevel(
      tenantId,
      task,
      level,
      nextOverdueDueAt(overdue, assignedAt, level),
    );
  }

  /** 任務所在的關卡仍在進行中、實例仍在跑,且這一關開了逾時提醒 → 設定與關卡名;否則 null。 */
  private async overdueStepOf(
    instance: InstanceRecord,
    task: WorkflowTaskRecord,
  ): Promise<{ overdue: OverdueReminderDef; name: string } | null> {
    if (
      !isLiveInstanceStatus(instance.status) ||
      !instance.activeStepKeys.includes(task.stepKey)
    ) {
      return null;
    }
    const version = await this.versions.findOne(systemContext(), {
      workflowKey: instance.workflowKey,
      version: instance.workflowVersion,
    });
    if (version === null) {
      return null;
    }
    const step = stepOf(definitionOfVersion(version), task.stepKey);
    const overdue = overdueOf(step);
    return step === undefined || overdue === null
      ? null
      : { overdue, name: step.name };
  }

  /**
   * 第 2 級的收件人:通知對象(依這張單據算的人員條件);承辦人本人不重複收到,被代理者在名單內照收。
   * 送出 / 綁定時不檢查通知對象,算不到人就不通知、記 warn 寫明原因。
   */
  private async audienceOf(
    instance: InstanceRecord,
    task: WorkflowTaskRecord,
    overdue: OverdueReminderDef,
  ): Promise<Types.ObjectId[]> {
    const where = `任務 ${String(task._id)} 的逾時提醒(第 2 級)`;
    const context = await this.entries.submissionContextOf(instance);
    if (context === null) {
      this.logger.warn(`${where}:實例沒有最上層組織,不通知`);
      return [];
    }
    const source = { kind: "audience", audience: overdue.audience } as const;
    const audience = await this.sources.resolveAudienceSource(source, context);
    const recipients = audience.filter((id) => !id.equals(task.assigneeId));
    if (recipients.length === 0) {
      // 送出 / 綁定時不檢查通知對象:算不到人就不通知,但要記下原因
      this.logger.warn(
        `${where}:算不到通知對象(${
          audience.length === 0
            ? emptySourceReason(source, context)
            : "符合的只有承辦人本人"
        }),不通知`,
      );
    }
    return recipients;
  }

  private async notify(
    instance: InstanceRecord,
    task: WorkflowTaskRecord,
    recipients: readonly Types.ObjectId[],
    reminder: {
      level: 1 | 2;
      hours: number;
      stepName: string;
      assignedAt: Date;
    },
  ): Promise<void> {
    if (recipients.length === 0) {
      return;
    }
    await this.notifications.notify({
      type: WORKFLOW_OVERDUE,
      tenantId: instance.tenantId,
      orgId: instance.orgId,
      recipients: { kind: "users", userIds: recipients },
      params: {
        subject: await this.notifier.subjectOf(instance),
        stepName: reminder.stepName,
        hours: String(reminder.hours),
      },
      ref: { type: WORKFLOW_INSTANCE_REF, id: String(instance._id) },
      dedupeKey: `${WORKFLOW_OVERDUE}:${String(task._id)}:${String(reminder.assignedAt.getTime())}:${String(reminder.level)}`,
    });
  }

  /**
   * 記級數與下一級的到期時點;條件含讀到的級數與指派時點(同一個交易內剛讀過,不成立代表資料被改過 →
   * 拋錯回復這一張的通知)。只動這三個計時欄位,不碰任務狀態。
   */
  private async saveLevel(
    tenantId: Types.ObjectId,
    task: WorkflowTaskRecord,
    level: number,
    next: Date | null,
  ): Promise<void> {
    const updated = await this.tasks.updateOne(
      systemContext(),
      tenantId,
      {
        _id: task._id,
        status: "pending",
        overdueLevel: task.overdueLevel,
        assignedAt: task.assignedAt,
      },
      { $set: { overdueLevel: level, overdueDueAt: next } },
    );
    if (updated === null) {
      throw new Error(
        `任務 ${String(task._id)} 在逾時提醒的交易內被改動,這一張先不記`,
      );
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}

/**
 * 第 1 級的收件人:目前承辦人,加上這張任務代理承接的被代理者(派任計畫該項的 `delegatorIds`,
 * B15)。流程管理者改派後計畫清空 `delegatorIds`,就只剩新承辦人。去重:同一人只收一則。
 */
function reviewersOf(
  instance: InstanceRecord,
  task: WorkflowTaskRecord,
): Types.ObjectId[] {
  const seen = new Set<string>();
  return [
    task.assigneeId,
    ...delegatorIdsOf(instance, task.stepKey, task.taskKey),
  ].filter((id) => {
    const key = String(id);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
