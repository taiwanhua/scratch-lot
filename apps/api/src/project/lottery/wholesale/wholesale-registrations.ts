import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { Types } from "mongoose";

import {
  TICKET_EVENT_TYPE,
  WHOLESALE_FIELD_KEYS,
  WHOLESALE_FORM_KEY,
  WHOLESALE_MODULE_KEY,
  WHOLESALE_PAYMENT_MODE,
  WHOLESALE_PERMISSIONS,
  WHOLESALE_REF_TYPE,
  WHOLESALE_SETTLEMENT_SIDE,
  wholesaleHeaderOf,
  wholesaleLinesOf,
  wholesaleTotalOf,
} from "@repo/domain/project/lottery";
import {
  solePayeeDefaultAmount,
  totalsOf,
} from "@repo/domain/project/lottery-accounts";

import {
  FormSubmissionsRepository,
  OrgsRepository,
} from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { WorkflowTasksRepository } from "../../../database/workflow-tasks.repository";
import { SidebarBadgeRegistry } from "../../../sidebar-badges/sidebar-badge-registry";
import { LotteryTicketEventsRepository } from "../../database/lottery-inventory/lottery-inventory.repository";
import { WholesaleCustomerDocuments } from "../dealers/wholesale-customer-documents";
import { tenantOfOperator } from "../master-data-tenant";
import { SETTLEMENT_LIVE_STATUSES } from "../settlement/settlement-ledger";
import {
  type SettlementPayable,
  type SettlementSubmission,
  registerSettlementDocument,
} from "../settlement/settlement-registry";
import { toObjectId } from "./wholesale-books.service";
import { WholesaleCustomerNames } from "./wholesale-customer-names";

const CUSTOMER_PATH = `values.${WHOLESALE_FIELD_KEYS.customer}.id`;

/**
 * 有效的收款方式:退回 / 撤回的單可以先存草稿改收款方式,**重新送出才算數**(送出前檢查已收淨額 0)。還沒重送之前照
 * 上一次送出的那一版 —— 已經收過錢的「收到錢再核准」被存成「從帳戶入帳」時,結算區還在、收款還能退款或沖正。
 */
export function effectivePaymentModeOf(submission: SettlementSubmission) {
  const isEditable =
    submission.status === "returned" || submission.status === "withdrawn";
  const { revisions } = submission as SettlementSubmission & {
    revisions?: readonly { values: Record<string, unknown> }[];
  };
  const last = isEditable ? revisions?.at(-1) : undefined;
  return wholesaleHeaderOf(last?.values ?? submission.values).paymentMode;
}

/**
 * 批售單向其他功能登記的事(專案規格 21.2、21.6、21.8):
 *
 * - **收付**(`registerSettlementDocument`):只有出貨店一邊(收款方,`receive`,銀行或現金),應收 = 批售金額;
 *   參與收付的狀態依收款方式(從帳戶入帳只有已完成)
 * - **批售客戶**(`WholesaleCustomerDocuments`):最近一次批售日、有沒有被任何批售單(含草稿)引用
 * - **側欄計數**(`registerBadge`):出貨確認在我手上、還沒決定的任務數
 *
 * 沒有操作者的讀取用租戶邊界上下文的系統身分(登記在 `project/database/tenant-boundary-callers.ts`)。
 */
@Injectable()
export class WholesaleRegistrations implements OnModuleInit, OnModuleDestroy {
  private readonly unregister: (() => void)[] = [];

  constructor(
    private readonly submissions: FormSubmissionsRepository,
    private readonly orgs: OrgsRepository,
    private readonly events: LotteryTicketEventsRepository,
    private readonly tasks: WorkflowTasksRepository,
    private readonly names: WholesaleCustomerNames,
    private readonly customerDocuments: WholesaleCustomerDocuments,
    private readonly badges: SidebarBadgeRegistry,
  ) {}

  onModuleInit(): void {
    this.unregister.push(
      registerSettlementDocument({
        moduleKey: WHOLESALE_MODULE_KEY,
        label: "批售單",
        kind: "wholesale",
        payable: async (submission) => {
          const [payable] = await this.payablesOf([{ submission }]);
          return payable ?? null;
        },
        payables: (items) => this.payablesOf(items),
        participatingStatuses: (submission) =>
          effectivePaymentModeOf(submission) === WHOLESALE_PAYMENT_MODE.autoBank
            ? ["completed"]
            : SETTLEMENT_LIVE_STATUSES,
        sideBranchPaths: [`values.${WHOLESALE_FIELD_KEYS.fromBranch}.id`],
        sides: [
          {
            side: WHOLESALE_SETTLEMENT_SIDE,
            label: "出貨店",
            role: "payee",
            permission: WHOLESALE_PERMISSIONS.receive,
            methods: ["bank", "cash"],
            defaultAmount: (button, state) =>
              solePayeeDefaultAmount(
                button,
                state.payable,
                totalsOf(state, WHOLESALE_SETTLEMENT_SIDE),
              ),
          },
        ],
      }),
    );
    this.customerDocuments.registerSource({
      lastShippedAt: (_operator, tenantId, customerIds) =>
        this.lastShippedAt(tenantId, customerIds),
      isReferenced: (_operator, tenantId, customerId) =>
        this.isReferenced(tenantId, customerId),
    });
    this.badges.registerBadge({
      moduleKey: WHOLESALE_MODULE_KEY,
      // 通知設定頁「側欄數字」的說明(專案字典)
      descriptionKey: "admin.lotteryPurchasing.wholesale.badgeDescription",
      count: (operator) => this.pendingShipCount(operator),
    });
  }

  onModuleDestroy(): void {
    for (const unregister of this.unregister.splice(0)) {
      unregister();
    }
  }

  /** 出貨確認:批售單在我手上、還沒決定的審核任務數(同進貨單)。 */
  async pendingShipCount(operator: OperatorContext): Promise<number> {
    const tenantId = tenantOfOperator(operator)?.tenantId ?? null;
    if (tenantId === null || operator.actorId === null) {
      return 0;
    }
    return this.tasks.count(tenantId, {
      moduleKey: WHOLESALE_MODULE_KEY,
      assigneeId: operator.actorId,
      status: "pending",
    });
  }

  /** 應收 = 批售金額;草稿、駁回、作廢 → 不參與(null)。客戶店名每個租戶一次讀完(TX-07),順序同 `items`。 */
  private async payablesOf(
    items: readonly { submission: SettlementSubmission }[],
  ): Promise<(SettlementPayable | null)[]> {
    const live = items.filter(({ submission }) =>
      (SETTLEMENT_LIVE_STATUSES as readonly string[]).includes(
        submission.status,
      ),
    );
    const byTenant = new Map<string, (typeof live)[number][]>();
    for (const item of live) {
      const key = String(item.submission.tenantId);
      byTenant.set(key, [...(byTenant.get(key) ?? []), item]);
    }
    const payableOf = new Map<(typeof live)[number], SettlementPayable>();
    for (const group of byTenant.values()) {
      const names = await this.names.storeNamesOf(
        group[0]?.submission.tenantId ?? null,
        group.map((item) => item.submission.values),
      );
      for (const [index, item] of group.entries()) {
        const { submission } = item;
        payableOf.set(item, {
          amount: wholesaleTotalOf(wholesaleLinesOf(submission.values)),
          branchOrgId:
            toObjectId(wholesaleHeaderOf(submission.values).fromBranchId) ??
            submission.orgId,
          docNo: submission.serialNo ?? "",
          counterparty: names[index] ?? "",
        });
      }
    }
    return items.map((item) => payableOf.get(item) ?? null);
  }

  /** 這些客戶「已完成批售單」的最新出貨時間(= 批售事件的時間;作廢的不算),整個租戶。 */
  private async lastShippedAt(
    tenantId: Types.ObjectId | null,
    customerIds: readonly Types.ObjectId[],
  ): Promise<ReadonlyMap<string, Date>> {
    if (tenantId === null) {
      return new Map();
    }
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const completed = await this.submissions.findMany(
      reader,
      {
        moduleKey: WHOLESALE_MODULE_KEY,
        formKey: WHOLESALE_FORM_KEY,
        status: "completed",
        [CUSTOMER_PATH]: { $in: customerIds.map(String) },
      },
      { select: CUSTOMER_PATH },
    );
    if (completed.length === 0) {
      return new Map();
    }
    const rows = await this.events.aggregate(reader, [
      {
        $match: {
          refType: WHOLESALE_REF_TYPE,
          refId: { $in: completed.map((submission) => submission._id) },
          type: TICKET_EVENT_TYPE.wholesale,
        },
      },
      { $group: { _id: "$refId", at: { $max: "$at" } } },
    ]);
    const shippedAt = new Map(
      rows.map((row) => [String(row._id), row.at as Date]),
    );
    const latest = new Map<string, Date>();
    for (const submission of completed) {
      const customerId = wholesaleHeaderOf(submission.values).customerId;
      const at = shippedAt.get(String(submission._id));
      const current = customerId === null ? undefined : latest.get(customerId);
      if (
        customerId !== null &&
        at !== undefined &&
        (current === undefined || at > current)
      ) {
        latest.set(customerId, at);
      }
    }
    return latest;
  }

  /** 有沒有任何批售單(含草稿、駁回、作廢)引用這位客戶;整個租戶。 */
  private async isReferenced(
    tenantId: Types.ObjectId | null,
    customerId: Types.ObjectId,
  ): Promise<boolean> {
    if (tenantId === null) {
      return false;
    }
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const found = await this.submissions.findOne(
      reader,
      {
        moduleKey: WHOLESALE_MODULE_KEY,
        formKey: WHOLESALE_FORM_KEY,
        [CUSTOMER_PATH]: String(customerId),
      },
      { select: "_id" },
    );
    return found !== null;
  }
}
