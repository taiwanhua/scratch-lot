import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  type BankTransactionType,
  type OutstandingKind,
  type SettlementButton,
  type SettlementSideTotals,
  type SettlementState,
  outstandingKindOf,
  paidNetOf,
  receivedNetOf,
} from "@repo/domain/project/lottery-accounts";

import {
  FormSubmissionsRepository,
  OrgsRepository,
} from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import {
  LotteryBankTransactionsRepository,
  LotteryCashMovementsRepository,
} from "../../database/lottery-accounts/lottery-accounts.repositories";
import {
  ACCOUNTS_REASONS,
  notFoundError,
  validationError,
} from "../accounts/accounts-error";
import {
  type SettlementDocumentRegistration,
  type SettlementPayable,
  type SettlementSideRegistration,
  type SettlementSubmission,
  settlementDocumentOf,
  settlementDocuments,
} from "./settlement-registry";

/** 參與收付的提交狀態:送出之後、還沒作廢 / 駁回(草稿沒有應付)。 */
export const SETTLEMENT_LIVE_STATUSES = [
  "reviewing",
  "returned",
  "withdrawn",
  "completed",
] as const;

/** 一張單據的收付現況(登記 + 提交 + 應付 + 各邊合計)。 */
export interface SettlementSnapshot {
  registration: SettlementDocumentRegistration;
  submission: SettlementSubmission;
  payable: SettlementPayable;
  state: SettlementState;
}

/** 一邊的一列待結清。 */
export interface OutstandingRow {
  snapshot: SettlementSnapshot;
  side: SettlementSideRegistration;
  branchOrgId: Types.ObjectId;
  /** 這一邊的淨額:付款方 = 已付淨額、收款方 = 已收淨額。 */
  net: number;
  kind: OutstandingKind;
  button: SettlementButton;
  amount: number;
}

/** 銀行 [登記交易] 選了單據:記在哪一邊。 */
export interface InboundEntry {
  side: string;
  revision: number;
  branchOrgId: Types.ObjectId;
}

function parseId(value: string): Types.ObjectId | null {
  return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;
}

/** 收付寫交易 / 流水的類型(依單據種類與方向)。 */
export function bankTypeOf(
  kind: SettlementDocumentRegistration["kind"],
  button: SettlementButton,
): BankTransactionType {
  if (kind === "purchase") {
    return button === "out" ? "purchase_expense" : "purchase_income";
  }
  return button === "out" ? "transfer_expense" : "transfer_income";
}

/**
 * 收付機制的讀取:單據的應付與各邊合計、待結清、銀行 [登記交易] 的單據候選。
 *
 * - 單據照操作者的範圍讀(看不到 → `NOT_FOUND`)
 * - 收付的交易 / 流水以租戶邊界讀:看得到單據就看得到它的收付(另一邊可能是別家分店記的;
 *   登記在 `TENANT_BOUNDARY_CONTEXT_CALLERS`,用途「反查」)
 * - 沖正的那一筆以反方向計入(不另外排除),「兌獎入帳」不算(只看 `settlementSide` 有值的)
 */
@Injectable()
export class SettlementLedger {
  constructor(
    private readonly submissions: FormSubmissionsRepository,
    private readonly bank: LotteryBankTransactionsRepository,
    private readonly cash: LotteryCashMovementsRepository,
    private readonly orgs: OrgsRepository,
  ) {}

  /** 一張單據的收付現況;沒登記 / 看不到 / 不參與收付 → 錯誤。 */
  async snapshotOf(
    operator: OperatorContext,
    moduleKey: string,
    refIdText: string | Types.ObjectId,
  ): Promise<SettlementSnapshot> {
    const registration = settlementDocumentOf(moduleKey);
    if (registration === undefined) {
      throw validationError(
        `settlement is not registered: ${moduleKey}`,
        ["moduleKey"],
        ACCOUNTS_REASONS.settlementUnknown,
      );
    }
    const refId =
      typeof refIdText === "string" ? parseId(refIdText) : refIdText;
    const submission =
      refId === null
        ? null
        : await this.submissions.findOne(operator, { _id: refId, moduleKey });
    if (!submission) {
      throw notFoundError(
        `settlement document not found: ${String(refIdText)}`,
      );
    }
    const [snapshot] = await this.snapshotsOf(operator, registration, [
      submission,
    ]);
    if (snapshot === undefined) {
      throw validationError(
        `document does not take part in settlement: ${String(refIdText)}`,
        ["refId"],
        ACCOUNTS_REASONS.settlementUnknown,
      );
    }
    return snapshot;
  }

  /** 一張單據目前的修訂號(兌獎入帳選填單據時記 `refRevision`);看不到 → `NOT_FOUND`。 */
  async revisionOf(
    operator: OperatorContext,
    moduleKey: string,
    refId: Types.ObjectId,
  ): Promise<number> {
    const submission = await this.submissions.findOne(operator, {
      _id: refId,
      moduleKey,
    });
    if (!submission) {
      throw notFoundError(`document not found: ${String(refId)}`);
    }
    return submission.revision;
  }

  /**
   * 作廢 / 駁回前的檢查:沒有登記收付的單據一律通過;有登記的每一邊淨額都要是 0。
   * 守門用(`settlementClearedGuard`);讀取以單據的租戶為邊界(按按鈕的人不一定看得到另一邊)。
   */
  async isCleared(
    operator: OperatorContext,
    submission: SettlementSubmission,
  ): Promise<boolean> {
    const registration = settlementDocumentOf(submission.moduleKey);
    if (registration === undefined) {
      return true;
    }
    const totals = await this.totalsOf(operator, submission.tenantId, [
      submission._id,
    ]);
    const bySide = totals.get(String(submission._id)) ?? {};
    return Object.values(bySide).every((side) => paidNetOf(side) === 0);
  }

  /** 看得到的單據裡有待付 / 待退 / 待收的每一邊(依可見範圍)。 */
  async outstanding(operator: OperatorContext): Promise<OutstandingRow[]> {
    const rows: OutstandingRow[] = [];
    for (const registration of settlementDocuments()) {
      const submissions = (await this.submissions.findMany(
        operator,
        {
          moduleKey: registration.moduleKey,
          status: { $in: [...SETTLEMENT_LIVE_STATUSES] },
        },
        { sort: { submittedAt: 1, _id: 1 } },
      )) as unknown as SettlementSubmission[];
      const snapshots = await this.snapshotsOf(
        operator,
        registration,
        submissions,
      );
      for (const snapshot of snapshots) {
        rows.push(...outstandingOf(snapshot));
      }
    }
    return rows;
  }

  /**
   * 銀行 [登記交易] 選「批貨收入 / 調貨收入」:單據要有某一邊的 [收到退款] / [收款] 預設 > 0
   * (只列有待退或待收的單據);沒有 → `VALIDATION_FAILED`(`refId`,`SETTLEMENT_NOTHING_DUE`)。
   */
  async inboundEntryOf(
    operator: OperatorContext,
    input: {
      moduleKey: string;
      refId: Types.ObjectId;
      type: BankTransactionType;
    },
  ): Promise<InboundEntry> {
    const snapshot = await this.snapshotOf(
      operator,
      input.moduleKey,
      input.refId,
    );
    const due = outstandingOf(snapshot).find(
      (row) =>
        row.button === "in" &&
        bankTypeOf(snapshot.registration.kind, "in") === input.type,
    );
    if (due === undefined) {
      throw validationError(
        "document has nothing to refund or receive",
        ["refId"],
        ACCOUNTS_REASONS.settlementNothingDue,
      );
    }
    return {
      side: due.side.side,
      revision: snapshot.submission.revision,
      branchOrgId: due.branchOrgId,
    };
  }

  /** 一批提交的現況(不參與收付的略過)。 */
  async snapshotsOf(
    operator: OperatorContext,
    registration: SettlementDocumentRegistration,
    submissions: readonly SettlementSubmission[],
  ): Promise<SettlementSnapshot[]> {
    const withPayable = submissions.flatMap((submission) => {
      const payable = registration.payable(submission);
      return payable === null ? [] : [{ submission, payable }];
    });
    if (withPayable.length === 0) {
      return [];
    }
    const byTenant = new Map<string, SettlementSubmission[]>();
    for (const { submission } of withPayable) {
      const key = String(submission.tenantId);
      byTenant.set(key, [...(byTenant.get(key) ?? []), submission]);
    }
    const totals = new Map<string, Record<string, SettlementSideTotals>>();
    for (const group of byTenant.values()) {
      const tenantId = group[0]?.tenantId ?? null;
      for (const [key, value] of await this.totalsOf(
        operator,
        tenantId,
        group.map((submission) => submission._id),
      )) {
        totals.set(key, value);
      }
    }
    return withPayable.map(({ submission, payable }) => ({
      registration,
      submission,
      payable,
      state: {
        payable: payable.amount,
        sides: totals.get(String(submission._id)) ?? {},
      },
    }));
  }

  /** 單據 id → 邊 → 支出 / 收入合計(銀行交易 + 現金流水)。 */
  private async totalsOf(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    refIds: readonly Types.ObjectId[],
  ): Promise<Map<string, Record<string, SettlementSideTotals>>> {
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const match = {
      refId: { $in: [...refIds] },
      settlementSide: { $ne: null },
    };
    const [bankRows, cashRows] = await Promise.all([
      this.bank.aggregate(reader, [
        { $match: match },
        {
          $group: {
            _id: {
              refId: "$refId",
              side: "$settlementSide",
              direction: "$direction",
            },
            amount: { $sum: "$amount" },
          },
        },
      ]),
      this.cash.aggregate(reader, [
        { $match: match },
        {
          $group: {
            _id: {
              refId: "$refId",
              side: "$settlementSide",
              // 現金流出到外部 = 這一邊支出;從外部流入 = 收入
              direction: {
                $cond: [{ $eq: ["$to", "external"] }, "out", "in"],
              },
            },
            amount: { $sum: "$amount" },
          },
        },
      ]),
    ]);
    const result = new Map<string, Record<string, SettlementSideTotals>>();
    for (const row of [...bankRows, ...cashRows] as {
      _id: { refId: unknown; side: string; direction: "in" | "out" };
      amount: number;
    }[]) {
      const key = String(row._id.refId);
      const sides = result.get(key) ?? {};
      const totals = sides[row._id.side] ?? { out: 0, in: 0 };
      totals[row._id.direction] += row.amount;
      sides[row._id.side] = totals;
      result.set(key, sides);
    }
    return result;
  }
}

/** 一張單據每一邊的待結清(先填的金額 > 0 的那一顆)。 */
export function outstandingOf(snapshot: SettlementSnapshot): OutstandingRow[] {
  return snapshot.registration.sides.flatMap((side) => {
    const defaults = {
      out: side.defaultAmount("out", snapshot.state),
      in: side.defaultAmount("in", snapshot.state),
    };
    const due = outstandingKindOf(side.role, defaults);
    if (due === null) {
      return [];
    }
    const totals = snapshot.state.sides[side.side] ?? { out: 0, in: 0 };
    return [
      {
        snapshot,
        side,
        branchOrgId:
          side.branchOf?.(snapshot.submission, snapshot.payable) ??
          snapshot.payable.branchOrgId,
        net: side.role === "payer" ? paidNetOf(totals) : receivedNetOf(totals),
        ...due,
      },
    ];
  });
}
