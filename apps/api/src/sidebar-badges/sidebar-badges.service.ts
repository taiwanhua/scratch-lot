import { Injectable, Logger } from "@nestjs/common";

import type { OperatorContext } from "../database/operator-context";
import { PermissionResolver } from "../permission/permission-resolver";
import type { SidebarBadge } from "./models/sidebar-badge.model";
import { SidebarBadgeRegistry } from "./sidebar-badge-registry";

/**
 * 算操作者的側欄計數:只算**角色綁了那個模組**的(與進得去那一頁同一個判斷,ADR-0011「可進 = 有那個模組」;
 * 即 `me.modules` 裡有它,停用的模組連子樹不算),不另外要求 `<模組 key>.view` —— 沒有 view 權限的模組
 * (例:只綁模組、讀取看模組的專案主檔)綁了就算得到。數字本身的範圍由各模組的 `count` 負責(可見範圍照套)。
 * 各模組並行;某一筆拋錯只略過那一筆並記 log,不讓整個側欄沒有數字。
 */
@Injectable()
export class SidebarBadgesService {
  private readonly logger = new Logger(SidebarBadgesService.name);

  constructor(
    private readonly registry: SidebarBadgeRegistry,
    private readonly permissions: PermissionResolver,
  ) {}

  async badgesOf(operator: OperatorContext): Promise<SidebarBadge[]> {
    if (operator.actorId === null) {
      return [];
    }
    const resolution = await this.permissions.resolve(
      operator.actorId,
      operator.currentOrgId,
    );
    const boundModules = new Set(
      resolution.modules.map((module) => module.key),
    );
    const visible = this.registry
      .badges()
      .filter((badge) => boundModules.has(badge.moduleKey));
    const counted = await Promise.all(
      visible.map(async (badge): Promise<SidebarBadge | null> => {
        try {
          return {
            moduleKey: badge.moduleKey,
            count: await badge.count(operator),
          };
        } catch (error) {
          this.logger.error(
            `側欄計數「${badge.moduleKey}」計算失敗,本次不回傳`,
            error instanceof Error ? error.stack : String(error),
          );
          return null;
        }
      }),
    );
    return counted.filter((badge): badge is SidebarBadge => badge !== null);
  }
}
