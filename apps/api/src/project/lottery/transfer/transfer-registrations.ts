import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { Types } from "mongoose";

import {
  TRANSFER_FIELD_KEYS,
  TRANSFER_FORM_KEY,
  TRANSFER_MODULE_KEY,
  TRANSFER_PERMISSIONS,
  TRANSFER_SETTLEMENT_SIDE,
  receivedTransferAmountOf,
  transferHeaderOf,
  transferLinesOf,
  transferReceiverDefault,
  transferShipperDefault,
  transferTotalOf,
} from "@repo/domain/project/lottery";
import { totalsOf } from "@repo/domain/project/lottery-accounts";

import {
  FormSubmissionsRepository,
  OrgsRepository,
  WorkflowInstancesRepository,
} from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { WorkflowTasksRepository } from "../../../database/workflow-tasks.repository";
import { SidebarBadgeRegistry } from "../../../sidebar-badges/sidebar-badge-registry";
import { LotteryTransferReceiptsRepository } from "../../database/lottery-transfers/lottery-transfer-receipts.repository";
import { tenantOfOperator } from "../master-data-tenant";
import { registerInTransitSource } from "../requisition/in-transit";
import {
  type SettlementSubmission,
  registerSettlementDocument,
} from "../settlement/settlement-registry";
import {
  TRANSFER_LIVE_STATUSES,
  TRANSFER_OPEN_STATUSES,
  labelOf,
  toObjectId,
} from "./transfer-rules.service";

/** 登記名(`in-transit.ts` 全域唯一)。 */
export const TRANSFER_IN_TRANSIT_SOURCE = "lottery-transfers";

const FROM_PATH = `values.${TRANSFER_FIELD_KEYS.fromBranch}.id`;
const TO_PATH = `values.${TRANSFER_FIELD_KEYS.toBranch}.id`;

/**
 * 調貨單向其他功能登記的事(專案規格 8.1、8.4、第 9 章、3.1):
 *
 * - **在途來源**(`in-transit.ts`):送到這家店(收貨分店)、已建立還沒點收的列數(本;草稿不算)
 * - **收付**(`registerSettlementDocument`):收貨店(付款方,`pay`,銀行或現金)、出貨店(收款方,`receive`,一律銀行);
 *   調貨金額 = 批購金額合計,收貨店的先填值照已點收的批購金額;兩邊店各操作自己那一邊的收付(`sideBranchPaths`;兩邊店看得到這張單靠依欄位共用 `from_branch` / `to_branch`)
 * - **側欄計數**(`registerBadge`):待點收 = 點收關卡(第二關)在我手上的審核任務數
 *
 * 沒有操作者的讀取用租戶邊界上下文的系統身分(呼叫端登記在 `project/database/tenant-boundary-callers.ts`)。
 */
@Injectable()
export class TransferRegistrations implements OnModuleInit, OnModuleDestroy {
  private readonly unregister: (() => void)[] = [];

  constructor(
    private readonly submissions: FormSubmissionsRepository,
    private readonly orgs: OrgsRepository,
    private readonly instances: WorkflowInstancesRepository,
    private readonly receipts: LotteryTransferReceiptsRepository,
    private readonly tasks: WorkflowTasksRepository,
    private readonly badges: SidebarBadgeRegistry,
  ) {}

  onModuleInit(): void {
    this.unregister.push(
      registerInTransitSource(TRANSFER_IN_TRANSIT_SOURCE, (query) =>
        this.inTransitOf(query.tenantId, query.orgId),
      ),
      registerSettlementDocument({
        moduleKey: TRANSFER_MODULE_KEY,
        label: "調貨單",
        kind: "transfer",
        payable: (submission, asOf) => this.payableOf(submission, asOf),
        sideBranchPaths: [FROM_PATH, TO_PATH],
        sides: [
          {
            side: TRANSFER_SETTLEMENT_SIDE.receiver,
            label: "收貨店",
            role: "payer",
            permission: TRANSFER_PERMISSIONS.pay,
            methods: ["bank", "cash"],
            defaultAmount: (button, state) =>
              transferReceiverDefault(
                button,
                state.received ?? state.payable,
                totalsOf(state, TRANSFER_SETTLEMENT_SIDE.receiver),
              ),
            branchOf: (submission, payable) =>
              toObjectId(transferHeaderOf(submission.values).toBranchId) ??
              payable.branchOrgId,
          },
          {
            side: TRANSFER_SETTLEMENT_SIDE.shipper,
            label: "出貨店",
            role: "payee",
            permission: TRANSFER_PERMISSIONS.receive,
            methods: ["bank"],
            defaultAmount: (button, state) =>
              transferShipperDefault(
                button,
                state.payable,
                totalsOf(state, TRANSFER_SETTLEMENT_SIDE.receiver),
                totalsOf(state, TRANSFER_SETTLEMENT_SIDE.shipper),
              ),
            branchOf: (submission, payable) =>
              toObjectId(transferHeaderOf(submission.values).fromBranchId) ??
              payable.branchOrgId,
          },
        ],
      }),
    );
    this.badges.registerBadge({
      moduleKey: TRANSFER_MODULE_KEY,
      // 通知設定頁「側欄數字」的說明(專案字典)
      descriptionKey: "admin.lotteryPurchasing.transfer.badgeDescription",
      count: (operator) => this.pendingReceiveCount(operator),
    });
  }

  onModuleDestroy(): void {
    for (const unregister of this.unregister.splice(0)) {
      unregister();
    }
  }

  /**
   * 待點收:點收關卡(流程實例的最後一關,第二關「收貨分店」)在我手上、還沒決定的任務數。
   * 還在第一關(出貨確認)的不算。
   */
  async pendingReceiveCount(operator: OperatorContext): Promise<number> {
    const tenantId = tenantOfOperator(operator)?.tenantId ?? null;
    if (tenantId === null || operator.actorId === null) {
      return 0;
    }
    const pending = await this.tasks.findMany(tenantId, {
      moduleKey: TRANSFER_MODULE_KEY,
      assigneeId: operator.actorId,
      status: "pending",
    });
    if (pending.length === 0) {
      return 0;
    }
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const instances = await this.instances.findMany(
      reader,
      { _id: { $in: pending.map((task) => task.instanceId) } },
      { select: "steps.stepKey" },
    );
    const lastStepOf = new Map(
      instances.map((instance) => [
        String(instance._id),
        instance.steps.at(-1)?.stepKey ?? null,
      ]),
    );
    return pending.filter(
      (task) => lastStepOf.get(String(task.instanceId)) === task.stepKey,
    ).length;
  }

  /** 收付:調貨金額 = 批購金額合計;收貨店的先填值照已點收的批購金額。草稿、駁回、作廢 → 不參與。 */
  /** 調貨金額與已點收金額;給了 `asOf` = 已點收只算那個時點以前的點收(輸出報表的期末未結清)。 */
  private async payableOf(submission: SettlementSubmission, asOf?: Date) {
    if (
      !(TRANSFER_LIVE_STATUSES as readonly string[]).includes(submission.status)
    ) {
      return null;
    }
    const values = submission.values as Record<string, unknown>;
    const header = transferHeaderOf(values);
    const lines = transferLinesOf(values);
    const reader = await tenantBoundaryContext(
      this.orgs,
      null,
      submission.tenantId,
    );
    const receipts = await this.receipts.findMany(
      reader,
      {
        submissionId: submission._id,
        ...(asOf === undefined ? {} : { receivedAt: { $lt: asOf } }),
      },
      { select: "rowId" },
    );
    const received = new Set(receipts.map((receipt) => receipt.rowId));
    return {
      amount: transferTotalOf(lines),
      received: receivedTransferAmountOf(lines, received),
      branchOrgId: toObjectId(header.toBranchId) ?? submission.orgId,
      docNo: submission.serialNo ?? "",
      counterparty: `${labelOf(values[TRANSFER_FIELD_KEYS.fromBranch])} → ${labelOf(values[TRANSFER_FIELD_KEYS.toBranch])}`,
    };
  }

  /** 送到這家店、已建立還沒點收的列:每個遊戲幾本(一列一本)。 */
  private async inTransitOf(
    tenantId: Types.ObjectId,
    orgId: Types.ObjectId,
  ): Promise<ReadonlyMap<string, number>> {
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const open = await this.submissions.findMany(
      reader,
      {
        moduleKey: TRANSFER_MODULE_KEY,
        formKey: TRANSFER_FORM_KEY,
        status: { $in: [...TRANSFER_OPEN_STATUSES] },
        [TO_PATH]: String(orgId),
      },
      { select: "values" },
    );
    if (open.length === 0) {
      return new Map();
    }
    const received = await this.receipts.findMany(
      reader,
      { submissionId: { $in: open.map((submission) => submission._id) } },
      { select: "submissionId rowId" },
    );
    const done = new Set(
      received.map((row) => `${String(row.submissionId)}:${row.rowId}`),
    );
    const books = new Map<string, number>();
    for (const submission of open) {
      for (const line of transferLinesOf(submission.values)) {
        if (
          line.gameId !== null &&
          !done.has(`${String(submission._id)}:${line.rowId}`)
        ) {
          books.set(line.gameId, (books.get(line.gameId) ?? 0) + 1);
        }
      }
    }
    return books;
  }
}
