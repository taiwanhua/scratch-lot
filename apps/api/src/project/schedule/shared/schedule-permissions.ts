import { Injectable } from "@nestjs/common";

import type { OperatorContext } from "../../../database/operator-context";
import {
  PermissionResolver,
  holdsPermission,
} from "../../../permission/permission-resolver";

/** 排班的權限 key(seed 正本 `apps/db-migrator/seeds/project/schedule.ts`;規格 3.2)。 */
export const SCHEDULE_PERMISSIONS = {
  settingsView: "schedule.settings.view",
  editTemplates: "schedule.settings.edit-templates",
  editStaff: "schedule.settings.edit-staff",
  editDefaultRules: "schedule.settings.edit-default-rules",
  editOrgRules: "schedule.settings.edit-org-rules",
  manageView: "schedule.manage.view",
  editCalendar: "schedule.manage.edit-calendar",
  myEditDayOffs: "schedule.my.edit-day-offs",
  myView: "schedule.my.view",
  myPunch: "schedule.my.punch",
  viewDayOffs: "schedule.manage.view-day-offs",
  editDayOffs: "schedule.manage.edit-day-offs",
  publish: "schedule.manage.publish",
  autoRun: "schedule.manage.auto-run",
  manageEdit: "schedule.manage.edit",
} as const;

/**
 * service 裡要依情況判斷的權限(`@RequirePermission` 只能守一個固定 key):
 * 例如規則要看組織是不是最上層組織決定要 `edit-default-rules` 還是 `edit-org-rules`;
 * 列表每一列的 `canEdit` 也由這裡算好給前端(api 算好、前端只讀)。
 */
@Injectable()
export class SchedulePermissions {
  constructor(private readonly resolver: PermissionResolver) {}

  /** 一次取這位操作者持有的權限,回一個判斷函式(同一個請求內重複判斷不再查庫)。 */
  async holderOf(operator: OperatorContext): Promise<(key: string) => boolean> {
    if (operator.actorId === null) {
      return () => false;
    }
    const resolution = await this.resolver.resolve(
      operator.actorId,
      operator.currentOrgId,
    );
    return (key) => holdsPermission(resolution, key);
  }
}
