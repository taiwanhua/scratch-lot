import { Injectable, type OnModuleInit } from "@nestjs/common";

import { SidebarBadgeRegistry } from "../../sidebar-badges/sidebar-badge-registry";
import { WorkflowAccessService } from "../workflow-access.service";
import { APPLY_CENTER_MODULE_KEY } from "../workflow-keys";
import { ApplyCenterService } from "./apply-center.service";

/**
 * 側欄「申請中心」的數字 = 待我處理的任務數(底座規格 10.4):登記為 `apply-center` 的側欄計數。
 * 看得到與否同兩個列表(`apply-center.view`);`myApplications` 只出現在申請中心的頁籤(`applyCenterCounts`)。
 * 變動時由流程引擎對相關審核者送 `badge:apply-center`(`WorkflowEngineService`)。
 */
@Injectable()
export class ApplyCenterBadge implements OnModuleInit {
  constructor(
    private readonly registry: SidebarBadgeRegistry,
    private readonly service: ApplyCenterService,
    private readonly access: WorkflowAccessService,
  ) {}

  onModuleInit(): void {
    this.registry.registerBadge({
      moduleKey: APPLY_CENTER_MODULE_KEY,
      count: async (operator) =>
        this.service.myTaskCount(await this.access.factsOf(operator)),
    });
  }
}
