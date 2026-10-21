import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { ClientSession, Types } from "mongoose";

import {
  PURCHASE_FIELD_KEYS,
  PURCHASE_FORM_KEY,
  PURCHASE_MODULE_KEY,
  PURCHASE_PERMISSIONS,
  PURCHASE_SETTLEMENT_SIDE,
  purchaseHeaderOf,
  purchaseLinesOf,
  purchasePayableOf,
} from "@repo/domain/project/lottery";
import {
  payerDefaultAmount,
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
import { LotteryPurchaseReceiptsRepository } from "../../database/lottery-purchases/lottery-purchase-receipts.repository";
import { DealerPurchaseDates } from "../dealers/purchase-dates";
import { registerGameUsageChecker } from "../games/game-usage";
import { tenantOfOperator } from "../master-data-tenant";
import { registerInTransitSource } from "../requisition/in-transit";
import { registerSettlementDocument } from "../settlement/settlement-registry";
import {
  PURCHASE_LIVE_STATUSES,
  PURCHASE_OPEN_STATUSES,
  toObjectId,
} from "./purchase-rules.service";

/** 登記名(`game-usage.ts`、`in-transit.ts` 各自全域唯一)。 */
export const PURCHASE_GAME_USAGE_CHECKER = "lottery-purchases";
export const PURCHASE_IN_TRANSIT_SOURCE = "lottery-purchases";

/** 「被進貨單引用過」算哪些狀態:草稿不算,其餘都算(含已作廢 / 已駁回)。 */
const USAGE_STATUSES = [
  ...PURCHASE_LIVE_STATUSES,
  "rejected" as const,
  "voided" as const,
];

/** 明細裡遊戲引用的存值路徑(`{ id, label }` 的 id)。 */
const GAME_ID_PATH = `values.${PURCHASE_FIELD_KEYS.lines}.${PURCHASE_FIELD_KEYS.game}.id`;
const DEALER_ID_PATH = `values.${PURCHASE_FIELD_KEYS.dealer}.id`;

function labelOf(value: unknown): string {
  return typeof value === "object" &&
    value !== null &&
    "label" in value &&
    typeof value.label === "string"
    ? value.label
    : "";
}

const latest = (dates: readonly (Date | null)[]): Date | null =>
  dates.reduce<Date | null>(
    (best, date) =>
      date !== null && (best === null || date > best) ? date : best,
    null,
  );

/**
 * 進貨單向其他功能登記的事(專案規格 5.1、5.2、8.1、8.2、第 9 章、3.1):
 *
 * - **遊戲引用檢查**(`game-usage.ts`):草稿以外的進貨單引用過的遊戲 = 有庫存(鎖定、不能刪)
 * - **在途來源**(`in-transit.ts`):這家店已建立還沒點收完成的進貨單本數(草稿不算)
 * - **收付**(`registerSettlementDocument`):一邊「總部」,應付 = 扣款金額,只能銀行,按鈕要 `settle`
 * - **甲類批購日**(`DealerPurchaseDates.registerSource`):有效進貨單上最新的批購日期(本人批購另算)
 * - **側欄計數**(`registerBadge`):待點收 = 點收關卡在我手上的審核任務數
 *
 * 前三者沒有操作者,讀取用租戶邊界上下文的系統身分(呼叫端登記在 `project/database/tenant-boundary-callers.ts`)。
 */
@Injectable()
export class PurchaseRegistrations implements OnModuleInit, OnModuleDestroy {
  private readonly unregister: (() => void)[] = [];

  constructor(
    private readonly submissions: FormSubmissionsRepository,
    private readonly orgs: OrgsRepository,
    private readonly receipts: LotteryPurchaseReceiptsRepository,
    private readonly tasks: WorkflowTasksRepository,
    private readonly purchaseDates: DealerPurchaseDates,
    private readonly badges: SidebarBadgeRegistry,
  ) {}

  onModuleInit(): void {
    this.unregister.push(
      registerGameUsageChecker(
        PURCHASE_GAME_USAGE_CHECKER,
        async (tenantId, gameId) => {
          if (tenantId === null) {
            return false;
          }
          const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
          const found = await this.submissions.findOne(
            reader,
            {
              moduleKey: PURCHASE_MODULE_KEY,
              formKey: PURCHASE_FORM_KEY,
              status: { $in: USAGE_STATUSES },
              [GAME_ID_PATH]: String(gameId),
            },
            { select: "_id" },
          );
          return found !== null;
        },
      ),
      registerInTransitSource(PURCHASE_IN_TRANSIT_SOURCE, (query) =>
        this.inTransitOf(query.tenantId, query.orgId),
      ),
      registerSettlementDocument({
        moduleKey: PURCHASE_MODULE_KEY,
        label: "進貨單",
        kind: "purchase",
        payable: (submission) => {
          if (
            !(PURCHASE_LIVE_STATUSES as readonly string[]).includes(
              submission.status,
            )
          ) {
            return null;
          }
          const values = submission.values as Record<string, unknown>;
          const branchId = toObjectId(purchaseHeaderOf(values).branchId);
          return {
            amount: purchasePayableOf(values),
            branchOrgId: branchId ?? submission.orgId,
            docNo: submission.serialNo ?? "",
            counterparty: labelOf(values[PURCHASE_FIELD_KEYS.dealer]),
          };
        },
        sides: [
          {
            side: PURCHASE_SETTLEMENT_SIDE,
            label: "總部",
            role: "payer",
            permission: PURCHASE_PERMISSIONS.settle,
            methods: ["bank"],
            defaultAmount: (button, state) =>
              payerDefaultAmount(
                button,
                state.payable,
                totalsOf(state, PURCHASE_SETTLEMENT_SIDE),
              ),
          },
        ],
      }),
    );
    this.purchaseDates.registerSource((session, tenantId, dealerId) =>
      this.purchaseDatesOf(session, tenantId, dealerId),
    );
    this.badges.registerBadge({
      moduleKey: PURCHASE_MODULE_KEY,
      // 通知設定頁「側欄數字」的說明(專案字典)
      descriptionKey: "admin.lotteryPurchasing.purchase.badgeDescription",
      count: (operator) => this.pendingReceiveCount(operator),
    });
  }

  onModuleDestroy(): void {
    for (const unregister of this.unregister.splice(0)) {
      unregister();
    }
  }

  /** 待點收:點收關卡(進貨單唯一一關)在我手上、還沒決定的任務數。 */
  async pendingReceiveCount(operator: OperatorContext): Promise<number> {
    const tenantId = tenantOfOperator(operator)?.tenantId ?? null;
    if (tenantId === null || operator.actorId === null) {
      return 0;
    }
    return this.tasks.count(tenantId, {
      moduleKey: PURCHASE_MODULE_KEY,
      assigneeId: operator.actorId,
      status: "pending",
    });
  }

  /** 這家店已建立還沒點收完成的進貨單:每個遊戲還沒點收的本數。 */
  private async inTransitOf(
    tenantId: Types.ObjectId,
    orgId: Types.ObjectId,
  ): Promise<ReadonlyMap<string, number>> {
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const open = await this.submissions.findMany(
      reader,
      {
        moduleKey: PURCHASE_MODULE_KEY,
        formKey: PURCHASE_FORM_KEY,
        status: { $in: [...PURCHASE_OPEN_STATUSES] },
        [`values.${PURCHASE_FIELD_KEYS.branch}.id`]: String(orgId),
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
      for (const line of purchaseLinesOf(submission.values)) {
        if (!done.has(`${String(submission._id)}:${line.rowId}`)) {
          books.set(line.gameId, (books.get(line.gameId) ?? 0) + 1);
        }
      }
    }
    return books;
  }

  /** 這位甲類在有效進貨單上最新的批購日期;本人批購另算一份。 */
  private async purchaseDatesOf(
    session: ClientSession | null,
    tenantId: Types.ObjectId | null,
    dealerId: Types.ObjectId,
  ) {
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const rows = await this.submissions.findMany(
      reader,
      {
        moduleKey: PURCHASE_MODULE_KEY,
        formKey: PURCHASE_FORM_KEY,
        status: { $in: [...PURCHASE_LIVE_STATUSES] },
        [DEALER_ID_PATH]: String(dealerId),
      },
      { select: "values", ...(session === null ? {} : { session }) },
    );
    const headers = rows.map((row) =>
      purchaseHeaderOf(row.values as Record<string, unknown>),
    );
    return {
      lastPurchaseDate: latest(headers.map((header) => header.purchaseDate)),
      lastSelfPurchaseDate: latest(
        headers
          .filter((header) => header.selfPurchase)
          .map((header) => header.purchaseDate),
      ),
    };
  }
}
