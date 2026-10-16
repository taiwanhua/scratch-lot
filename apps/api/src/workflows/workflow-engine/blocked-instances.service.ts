import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  LIVE_INSTANCE_STATUSES,
  TERMINAL_INSTANCE_STATUSES,
} from "@repo/domain/workflow";

import { WorkflowInstancesRepository } from "../../database/database.module";
import { WorkflowTasksRepository } from "../../database/workflow-tasks.repository";
import type { FormOperatorFacts } from "../../forms/form-access.service";
import type { WorkflowInstancesPayload } from "../models/workflow-instance.model";
import { systemContext } from "../tenant-directory.service";
import { workflowForbiddenError } from "../workflows-error";
import {
  BlockedInstancesFilter,
  type BlockedInstancesInput,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "./dto/workflow-engine.input";
import type { InstanceRecord } from "./instance-writes";
import { WorkflowEngineService } from "./workflow-engine.service";
import { WorkflowPresenter } from "./workflow-presenter.service";

/** 「需要推進」一次最多 dry-run 這麼多筆候選(超過回 `truncated: true`,處理完再查)。 */
export const NEEDS_ADVANCE_CANDIDATE_LIMIT = 200;

/**
 * 阻擋清單(流程管理 → 阻擋,Spec 6b §6「需要推進」的識別、§8 畫面 6):以操作者的租戶為邊界。
 *
 * - `blocked`:實例 `status = blocked`
 * - `needsAdvance`:對候選實例跑一次判斷表(**不寫入**,`WorkflowEngineService.planOf`),還有動作 = 需要推進
 *   ——直接對應判斷表的列 2 / 4 / 4b / 4c / 5 / 5b / 6 / 7 / 8(含 8b 與資料矛盾的 `invalid`)。
 *   候選 = 進行中的實例 + 終局未收尾(`finishedAt` 空)+ 任務仍待處理 / 阻擋的終局實例
 */
@Injectable()
export class BlockedInstancesService {
  constructor(
    private readonly instances: WorkflowInstancesRepository,
    private readonly tasks: WorkflowTasksRepository,
    private readonly engine: WorkflowEngineService,
    private readonly presenter: WorkflowPresenter,
  ) {}

  async list(
    facts: FormOperatorFacts,
    input: BlockedInstancesInput,
  ): Promise<WorkflowInstancesPayload> {
    const tenantId = facts.tenantId;
    if (tenantId === null) {
      throw workflowForbiddenError(
        "The blocked list is read from inside a tenant",
        "TENANT_ONLY",
      );
    }
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const { matched, truncated } =
      input.filter === BlockedInstancesFilter.BLOCKED
        ? {
            matched: await this.instances.findMany(
              systemContext(),
              { tenantId, status: "blocked" },
              { sort: { updatedAt: 1, _id: 1 } },
            ),
            truncated: false,
          }
        : await this.needingAdvance(tenantId);
    const viewer = {
      actorId: facts.operator.actorId,
      canManage: true,
      titleOnly: true,
    };
    const items = [];
    for (const instance of matched.slice(
      (page - 1) * pageSize,
      page * pageSize,
    )) {
      items.push(await this.presenter.instanceModel(instance, viewer));
    }
    return { items, totalCount: matched.length, page, pageSize, truncated };
  }

  /**
   * 先以狀態預篩候選(進行中 / 終局未收尾 / 任務仍待處理或阻擋),依最久沒動的排序、
   * 取上限筆數,再逐筆 dry-run 判斷表。候選超過上限 → `truncated: true`。
   */
  private async needingAdvance(
    tenantId: Types.ObjectId,
  ): Promise<{ matched: InstanceRecord[]; truncated: boolean }> {
    const context = systemContext();
    const openTasks = await this.tasks.findMany(tenantId, {
      status: { $in: ["pending", "blocked"] },
    });
    const candidates = await this.instances.findMany(
      context,
      {
        tenantId,
        $or: [
          { status: { $in: [...LIVE_INSTANCE_STATUSES] } },
          {
            status: { $in: [...TERMINAL_INSTANCE_STATUSES] },
            finishedAt: null,
          },
          { _id: { $in: openTasks.map((task) => task.instanceId) } },
        ],
      },
      {
        sort: { updatedAt: 1, _id: 1 },
        limit: NEEDS_ADVANCE_CANDIDATE_LIMIT + 1,
      },
    );
    const truncated = candidates.length > NEEDS_ADVANCE_CANDIDATE_LIMIT;
    const result: InstanceRecord[] = [];
    for (const instance of candidates.slice(0, NEEDS_ADVANCE_CANDIDATE_LIMIT)) {
      const definition = await this.engine.definitionOf(instance);
      const plan = await this.engine.planOf(instance, definition);
      if (plan.actions.length > 0) {
        result.push(instance);
      }
    }
    return { matched: result, truncated };
  }
}
