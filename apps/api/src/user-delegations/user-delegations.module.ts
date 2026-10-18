import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { FormsCoreModule } from "../forms/forms-core.module";
import { WorkflowsCoreModule } from "../workflows/workflows-core.module";
import { UserDelegationsResolver } from "./user-delegations.resolver";
import { UserDelegationsService } from "./user-delegations.service";

/**
 * 代理人(`user_delegations`)的設定端:個人設定「代理人」分頁的讀寫。
 * 派任時換成代理人在審核引擎(`workflows/workflow-engine/assignee-delegation.service.ts`)。
 */
@Module({
  imports: [DatabaseModule, FormsCoreModule, WorkflowsCoreModule],
  providers: [UserDelegationsService, UserDelegationsResolver],
})
export class UserDelegationsModule {}
