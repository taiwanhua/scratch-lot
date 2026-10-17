import { Injectable, Logger } from "@nestjs/common";

import { permissionKey } from "@repo/domain/permission";

import type { OperatorContext } from "../database/operator-context";
import {
  PermissionResolver,
  holdsPermission,
} from "../permission/permission-resolver";
import type { SidebarBadge } from "./models/sidebar-badge.model";
import { SidebarBadgeRegistry } from "./sidebar-badge-registry";

/**
 * 算操作者的側欄計數:只算持有 `<模組 key>.view` 的模組(與 `@RequirePermission` 同一個判斷
 * `holdsPermission`),各模組並行;某一筆拋錯只略過那一筆並記 log,不讓整個側欄沒有數字。
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
    const visible = this.registry
      .badges()
      .filter((badge) =>
        holdsPermission(resolution, permissionKey(badge.moduleKey, "view")),
      );
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
