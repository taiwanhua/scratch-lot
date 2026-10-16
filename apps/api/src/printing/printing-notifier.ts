import { Injectable, Logger } from "@nestjs/common";

import {
  PRINT_AGENT_OFFLINE_AFTER_MS,
  PRINT_TEST_PAGE_DOCUMENT_TYPE,
} from "@repo/domain/printing";

import {
  OrgsRepository,
  PrintAgentsRepository,
  PrintersRepository,
} from "../database/database.module";
import {
  PRINTING_AGENT_OFFLINE,
  PRINTING_JOB_FAILED,
} from "../notifications/base-notification-types";
import { NotificationService } from "../notifications/notification.service";
import { internalReader } from "./print-agent-credentials";
import type { AgentRecord, JobRecord } from "./printing-mapper";

/** 一次離線掃描最多處理幾個代理程式(其餘下一輪)。 */
const OFFLINE_SCAN_LIMIT = 500;

/** 工作的顯示名稱:建立時給的 `documentName`,沒給就用「單據類型 + 編號」。 */
export function documentNameOf(job: JobRecord): string {
  return job.documentName ?? `${job.documentType} ${job.refId}`;
}

/**
 * 列印的兩種通知(底座規格第 5 章「通知類型登記表」;範本參數見 `base-notification-types.ts`):
 *
 * - `printing.job-failed`(當事人通知):工作標失敗時通知要求人。來源:代理程式回報失敗、
 *   等待中逾時、代理程式停用、送出時代理程式已離線。**呼叫端在標失敗的同一個交易內呼叫**
 *   (`notify()` 併進該交易:標失敗回復就沒有通知)。`dedupeKey` = 工作 id,一張工作只通知一次。
 * - `printing.agent-offline`(負責人提醒):代理程式 `lastSeenAt` 超過 2 分鐘。收件人照通知設定
 *   (預設持有 `system.printers.edit`,組織範圍 = 代理程式的分店含上層)。`dedupeKey` 帶 `lastSeenAt`:
 *   同一次離線只通知一次;重新上線(`lastSeenAt` 前進)後再離線是新的一次。
 */
@Injectable()
export class PrintingNotifier {
  private readonly logger = new Logger(PrintingNotifier.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly agents: PrintAgentsRepository,
    private readonly orgs: OrgsRepository,
    private readonly printers: PrintersRepository,
  ) {}

  /** 工作已標失敗(在同一個交易內呼叫)。 */
  async jobFailed(job: JobRecord): Promise<void> {
    await this.notifications.notify({
      type: PRINTING_JOB_FAILED,
      tenantId: job.tenantId,
      orgId: job.orgId,
      recipients: { kind: "users", userIds: [job.requestedBy] },
      params: await this.jobParams(job),
      dedupeKey: `${PRINTING_JOB_FAILED}:${String(job._id)}`,
    });
  }

  /** 這個代理程式已離線就提醒負責人(同一次離線只一次);沒離線、沒配對、已停用不做事。 */
  async agentOfflineIfStale(agent: AgentRecord, now: Date): Promise<void> {
    const lastSeenAt = agent.lastSeenAt;
    if (
      !agent.enabled ||
      agent.keyHash === null ||
      lastSeenAt === null ||
      now.getTime() - lastSeenAt.getTime() <= PRINT_AGENT_OFFLINE_AFTER_MS
    ) {
      return;
    }
    const org = await this.orgs.findById(internalReader(), agent.orgId);
    await this.notifications.notify({
      type: PRINTING_AGENT_OFFLINE,
      tenantId: agent.tenantId,
      orgId: agent.orgId,
      params: { agentName: agent.name, orgName: org?.name ?? "" },
      dedupeKey: `${PRINTING_AGENT_OFFLINE}:${String(agent._id)}:${String(lastSeenAt.getTime())}`,
    });
  }

  /** 排程掃描:所有已配對、啟用中、超過 2 分鐘沒看到的代理程式。 */
  async sweepOfflineAgents(now: Date): Promise<void> {
    const stale = await this.agents.findMany(
      internalReader(),
      {
        enabled: true,
        keyHash: { $type: "string" },
        lastSeenAt: {
          $lt: new Date(now.getTime() - PRINT_AGENT_OFFLINE_AFTER_MS),
        },
      },
      { limit: OFFLINE_SCAN_LIMIT },
    );
    for (const agent of stale) {
      try {
        await this.agentOfflineIfStale(agent, now);
      } catch (error) {
        // 單一代理程式失敗不擋後面的(下一輪再試;dedupeKey 保證不重複)
        this.logger.error(
          `代理程式 ${String(agent._id)} 離線提醒失敗:${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * `printing.job-failed` 的範本參數。測試頁不用 `documentName`,改給 `testPagePrinter`(印表機名稱),
   * 由範本依收件人語言組「測試頁 <印表機>」,通知不會出現 ObjectId。
   */
  private async jobParams(
    job: JobRecord,
  ): Promise<Record<string, string | null>> {
    if (job.documentType === PRINT_TEST_PAGE_DOCUMENT_TYPE) {
      const printer = await this.printers.findById(
        internalReader(),
        job.printerId,
      );
      return {
        documentName: null,
        testPagePrinter: printer?.name ?? "",
        reason: job.error,
      };
    }
    return { documentName: documentNameOf(job), reason: job.error };
  }
}
