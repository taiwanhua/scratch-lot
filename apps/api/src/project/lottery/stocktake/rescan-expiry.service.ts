import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Types } from "mongoose";

import { RESCAN_IDLE_MS, STOCKTAKE_STATUS } from "@repo/domain/project/lottery";

import { OrgsRepository } from "../../../database/database.module";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import {
  type ScheduledJobContext,
  ScheduledJobRegistry,
} from "../../../scheduled-jobs/scheduled-job-registry";
import { LotteryStocktakesRepository } from "../../database/lottery-stocktakes/lottery-stocktakes.repository";
import { RescanService } from "./rescan.service";

/** 排程工作 key(全域唯一)。 */
export const RESCAN_EXPIRY_JOB_KEY = "lottery.rescan-expiry";

/**
 * 全店重刷的自動取消(張數店規格 8.4 第 6 點:整次重刷 1 小時沒有任何位置刷到或按刷完 → 自動取消,同 [取消重刷]):
 * 每 15 分鐘逐租戶找 1 小時沒動作的重刷,逐店取消並解除移櫃暫停(`RescanService.expire`)。
 * 重刷頁、看板與移櫃前也會當場取消,排程只是沒人操作時的保底。
 */
@Injectable()
export class RescanExpiryService implements OnModuleInit {
  private readonly logger = new Logger(RescanExpiryService.name);

  constructor(
    private readonly scheduledJobs: ScheduledJobRegistry,
    private readonly stocktakes: LotteryStocktakesRepository,
    private readonly orgs: OrgsRepository,
    private readonly rescans: RescanService,
  ) {}

  onModuleInit(): void {
    this.scheduledJobs.registerScheduledJob({
      key: RESCAN_EXPIRY_JOB_KEY,
      every: "15m",
      handler: (context) => this.run(context),
    });
  }

  async run(context: ScheduledJobContext): Promise<void> {
    for (const tenant of context.tenants) {
      if (tenant.tenantId === null) {
        continue;
      }
      try {
        await this.runTenant(tenant.tenantId, context.scheduledFor);
      } catch (error) {
        this.logger.error(
          `租戶 ${String(tenant.tenantId)} 的全店重刷自動取消失敗:${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async runTenant(
    tenantId: Types.ObjectId,
    scheduledFor: Date,
  ): Promise<void> {
    // 排程的租戶系統身分:可見範圍 = 這個租戶的整棵組織樹(ADR-0005「例外出口」)
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const stale = await this.stocktakes.findMany(
      reader,
      {
        purpose: "rescan",
        status: STOCKTAKE_STATUS.pending,
        "rescan.lastActiveAt": {
          $lte: new Date(scheduledFor.getTime() - RESCAN_IDLE_MS),
        },
      },
      { select: "orgId" },
    );
    const stores = new Map(stale.map((row) => [String(row.orgId), row.orgId]));
    for (const orgId of stores.values()) {
      await this.rescans.expire(reader, { orgId, tenantId });
    }
  }
}
