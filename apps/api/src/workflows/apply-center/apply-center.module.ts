import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../database/database.module";
import { FormsCoreModule } from "../../forms/forms-core.module";
import { SidebarBadgesModule } from "../../sidebar-badges/sidebar-badges.module";
import { WorkflowEngineModule } from "../workflow-engine/workflow-engine.module";
import { WorkflowsCoreModule } from "../workflows-core.module";
import { ApplyCenterBadge } from "./apply-center-badge";
import { ApplyCenterResolver } from "./apply-center.resolver";
import { ApplyCenterService } from "./apply-center.service";

/** 申請中心(`apply-center`;`docs/modules/workflows.md`「申請中心」):我的申請、待我審核、新申請、實例詳情、決定;側欄計數登記(`ApplyCenterBadge`)。 */
@Module({
  imports: [
    DatabaseModule,
    FormsCoreModule,
    WorkflowsCoreModule,
    WorkflowEngineModule,
    SidebarBadgesModule,
  ],
  providers: [ApplyCenterService, ApplyCenterResolver, ApplyCenterBadge],
})
export class ApplyCenterModule {}
