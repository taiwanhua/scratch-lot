import { Injectable, Logger } from "@nestjs/common";

import { AuditService } from "../audit/audit.service";
import type { OperatorContext } from "../database/operator-context";
import { TenantPurgeStore } from "../database/tenant-purge.store";
import { TransactionService, afterCommit } from "../database/transaction";
import { StorageService } from "../storage/storage.service";
import type { PurgeDemoTenantPayload } from "./models/tenant-ops.model";
import { orgError, orgValidationError } from "./org-error";
import { OwnerProtectionService } from "./owner-protection.service";

/** 審計動作名(docs/modules/org-manager.md「審計」的命名規則;`targetType` = org)。 */
const AUDIT_ACTION = "org.purge-demo";

const NOTHING_PURGED: PurgeDemoTenantPayload = {
  purged: false,
  orgId: null,
  deletedDocuments: 0,
  deletedUsers: 0,
  detachedUsers: 0,
  deletedFiles: 0,
  collections: [],
};

/**
 * 清空示範機構(demo 指令 `--mode=purge` / `rebuild` 呼叫;`docs/deployment.md`「示範機構清空 / 重建」)。
 *
 * - **只在根組織、只對標「示範」的租戶頂層**:以租戶短碼(slug)找根組織底下的租戶頂層;
 *   找不到 → 什麼都不做(`purged: false`);找到卻沒有「示範」標記 → `FORBIDDEN`,一筆都不刪
 * - **刪除範圍照登記**(`database/tenant-purge.ts`,由 `TenantPurgeStore` 執行):帶 `tenantId` 的表依
 *   `tenantId`、其餘依組織 / 使用者歸屬,包括只能新增的帳本;只屬於這個租戶的人硬刪,
 *   也屬於其他組織的人只移除在這個租戶的所屬與角色。登記不完整時在任何讀寫之前拋錯
 * - 刪除與審計 `org.purge-demo` 是一個交易(TX-01);檔案在交易提交後刪(TX-03),個別失敗只記 log
 */
@Injectable()
export class DemoTenantPurgeService {
  private readonly logger = new Logger(DemoTenantPurgeService.name);

  constructor(
    private readonly store: TenantPurgeStore,
    private readonly transactions: TransactionService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly ownerProtection: OwnerProtectionService,
  ) {}

  async purge(
    operator: OperatorContext,
    slugInput: string,
  ): Promise<PurgeDemoTenantPayload> {
    if (!(await this.ownerProtection.canActAsRoot(operator))) {
      throw orgError(
        "FORBIDDEN",
        "purgeDemoTenant is only available from the root org",
      );
    }
    const slug = slugInput.trim();
    if (slug === "") {
      throw orgValidationError("slug must not be empty", ["slug"]);
    }
    const plan = this.store.plan();

    const tenant = await this.store.findTenantTopBySlug(slug);
    if (tenant === null) {
      return NOTHING_PURGED;
    }
    if (tenant.isDemo !== true) {
      throw orgError(
        "FORBIDDEN",
        `Org with slug ${slug} is not marked as demo; nothing was deleted`,
      );
    }

    return this.transactions.withTransaction(async (session) => {
      const result = await this.store.purgeTenant(plan, tenant._id, session);
      await this.audit.record(operator, {
        action: AUDIT_ACTION,
        targetType: "org",
        targetId: tenant._id,
        before: {
          name: tenant.name ?? null,
          slug,
          deletedDocuments: result.deletedDocuments,
          deletedUsers: result.purgedUserIds.length,
          detachedUsers: result.detachedUserIds.length,
        },
      });
      afterCommit(() => this.deleteFiles(result.filePaths));
      return {
        purged: true,
        orgId: String(tenant._id),
        deletedDocuments: result.deletedDocuments,
        deletedUsers: result.purgedUserIds.length,
        detachedUsers: result.detachedUserIds.length,
        deletedFiles: result.filePaths.length,
        collections: result.collections,
      };
    });
  }

  /** 交易提交後刪檔(路徑歸屬由 `deleteObject` 再驗一次);清不掉只是留下孤兒物件,記 warn 不擋。 */
  private async deleteFiles(paths: readonly string[]): Promise<void> {
    for (const path of paths) {
      try {
        await this.storage.deleteObject(path);
      } catch (error) {
        this.logger.warn(
          `清空示範機構:檔案 ${path} 刪除失敗(${error instanceof Error ? error.message : String(error)})`,
        );
      }
    }
  }
}
