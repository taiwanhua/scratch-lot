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
  WorkflowInstancesRepository,
} from "../../../database/base/repositories";
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
import { SettlementMarks } from "./settlement-marks";
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

/**
 * 還沒完成的有效狀態:待結清照狀態全部算(筆數有限);已完成的會一直累積,改由結清標記挑出還要算的
 * (`SettlementMarks`)。
 */
const SETTLEMENT_OPEN_STATUSES = SETTLEMENT_LIVE_STATUSES.filter(
  (status) => status !== "completed",
);

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

/** 算過的一張單據(寫結清標記用)。 */
interface EvaluatedDocument {
  submission: SettlementSubmission;
  /** 有沒有待結清 */
  open: boolean;
  /** 最後一筆收付的發生時間;沒有收付 = 1970 */
  latestAt: Date;
}

/** 要算的一項:哪一組(時點)、單據當時的樣子、收付只算哪個時點以前(沒給 = 全部)。 */
interface EvaluationItem {
  key: number;
  submission: SettlementSubmission;
  before?: Date;
}

/** 一項的各邊合計與最後一筆收付的發生時間。 */
interface ItemTotals {
  sides: Record<string, SettlementSideTotals>;
  latestAt: Date;
}

/** 讀出來的一筆收付(銀行交易或現金流水)。 */
interface LedgerRow {
  refId: Types.ObjectId;
  side: string;
  direction: "in" | "out";
  amount: number;
  occurredAt: Date;
}

/** 一批的應付(順序同 `items`):登記有 `payables` 就一批算,沒有就逐張(不讀資料庫的登記)。 */
async function payablesOf(
  registration: SettlementDocumentRegistration,
  items: readonly EvaluationItem[],
): Promise<readonly (SettlementPayable | null)[]> {
  if (items.length === 0) {
    return [];
  }
  if (registration.payables !== undefined) {
    return registration.payables(
      items.map((item) => ({ submission: item.submission, asOf: item.before })),
    );
  }
  const payables: (SettlementPayable | null)[] = [];
  for (const item of items) {
    payables.push(await registration.payable(item.submission, item.before));
  }
  return payables;
}

/** 收付讀成一筆一列(`direction` = 這一邊支出 / 收入的算法)。 */
function ledgerProjection(direction: unknown): Record<string, unknown>[] {
  return [
    {
      $project: {
        _id: 0,
        refId: 1,
        side: "$settlementSide",
        direction,
        amount: 1,
        occurredAt: 1,
      },
    },
  ];
}

/** 收付依單據 / 邊 / 方向加總成一列(`occurredAt` = 最後一筆的發生時間),欄位同 `ledgerProjection`。 */
function ledgerGrouping(direction: unknown): Record<string, unknown>[] {
  return [
    {
      $group: {
        _id: { refId: "$refId", side: "$settlementSide", direction },
        amount: { $sum: "$amount" },
        occurredAt: { $max: "$occurredAt" },
      },
    },
    {
      $project: {
        _id: 0,
        refId: "$_id.refId",
        side: "$_id.side",
        direction: "$_id.direction",
        amount: 1,
        occurredAt: 1,
      },
    },
  ];
}

/** 收付登記過的單據模組 key。 */
function settlementModuleKeys(): string[] {
  return settlementDocuments().map((row) => row.moduleKey);
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
    private readonly instances: WorkflowInstancesRepository,
    private readonly marks: SettlementMarks,
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
        : // 讀得到 = 可見範圍內,或依欄位共用指到讀者可見範圍內的組織(調貨單的出貨店、收貨店;ADR-0014)
          await this.submissions.findOne(operator, {
            _id: refId,
            moduleKey: registration.moduleKey,
          });
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
    const [totals] = await this.totalsOf(operator, submission.tenantId, [
      { refId: submission._id },
    ]);
    const bySide = totals?.sides ?? {};
    return Object.values(bySide).every((side) => paidNetOf(side) === 0);
  }

  /**
   * 看得到的單據裡有待付 / 待退 / 待收的每一邊(依可見範圍 + 依欄位共用,同一般讀取)。
   * 只掃還沒結清的:還沒完成的單據照狀態全部算;已完成的只算結清標記還在待確認的,算完沒有待結清的
   * (或已不是有效單據的)寫上 `closedAsOf`,之後不再掃,直到它又有一筆收付。
   */
  async outstanding(operator: OperatorContext): Promise<OutstandingRow[]> {
    const now = new Date();
    const reader = await this.marks.readerOf(operator);
    const pending =
      reader === null
        ? []
        : await this.marks.pending(reader, settlementModuleKeys());
    const markOf = new Map(pending.map((mark) => [String(mark.refId), mark]));
    const filter = {
      $or: [
        { status: { $in: SETTLEMENT_OPEN_STATUSES } },
        ...(pending.length === 0
          ? []
          : [{ _id: { $in: pending.map((mark) => mark.refId) } }]),
      ],
    };
    const [result] = await this.outstandingWhere(operator, filter, 1, (row) => [
      { key: 0, submission: row },
    ]);
    const closable = (result?.evaluated ?? []).flatMap(
      ({ submission, open, latestAt }) => {
        const mark = markOf.get(String(submission._id));
        // 還有待結清的不寫;未來日期的收付還沒到也先不寫(某個時點的待結清只略過 `closedAsOf` 早於它的)
        return mark === undefined ||
          (submission.status === "completed" && (open || latestAt > now))
          ? []
          : [mark];
      },
    );
    if (reader !== null) {
      await this.marks.close(reader, closable, now);
    }
    return result?.rows ?? [];
  }

  /**
   * **某個時點的**待結清(輸出報表營運報表區塊 7「期末時」;報表正本 `docs/modules/project/reports.md`):
   *
   * - 單據:那個時點以前送出(`submittedAt` 是第一次送出的時間,退回後重送不改寫)、當時還有效 —— 現在有效的,
   *   或之後才作廢(`voidedAt`)/ 駁回(流程實例結束的時間 `finishedAt`)的(作廢的當時是已完成、駁回的當時是審核中)
   * - 已完成的:那個時點以前就已結清(結清標記的 `closedAsOf` 早於它)的不用算
   * - 收付:只算那個時點以前發生的銀行交易與現金流水(`occurredAt`;沖正照它自己的時間)
   * - 應付照那個時點的內容:取 `ctx.at` 早於那個時點的最後一筆修訂(完整值快照)來算;沒有更早的修訂 = 當時還沒送出,不算
   * - 調貨單的已點收金額只算那個時點以前的點收(`payables` 的 `asOf`)
   */
  async outstandingAt(
    operator: OperatorContext,
    asOf: Date,
  ): Promise<OutstandingRow[]> {
    const [rows] = await this.outstandingAtMany(operator, [asOf]);
    return rows ?? [];
  }

  /**
   * 好幾個時點的待結清(順序同 `asOfs`;報表各店期末不同時一次算):單據、標記、駁回時間、應付、收付各讀一次,
   * 在記憶體依各時點挑(TX-07;指令數與時點數、張數無關)。規則同 `outstandingAt`。
   */
  async outstandingAtMany(
    operator: OperatorContext,
    asOfs: readonly Date[],
  ): Promise<OutstandingRow[][]> {
    if (asOfs.length === 0) {
      return [];
    }
    const times = asOfs.map((asOf) => asOf.getTime());
    const earliest = new Date(Math.min(...times));
    const latest = new Date(Math.max(...times));
    const reader = await this.marks.readerOf(operator);
    const [rejectedAt, pending] = await Promise.all([
      this.rejectedAfter(operator, earliest, latest),
      reader === null
        ? []
        : this.marks.pending(reader, settlementModuleKeys(), earliest),
    ]);
    const closedAsOfOf = new Map(
      pending.map((mark) => [String(mark.refId), mark.closedAsOf]),
    );
    const filter = {
      submittedAt: { $lt: latest },
      $or: [
        { status: { $in: SETTLEMENT_OPEN_STATUSES } },
        {
          status: "completed",
          _id: { $in: pending.map((mark) => mark.refId) },
        },
        { status: "voided", voidedAt: { $gte: earliest } },
        {
          status: "rejected",
          _id: {
            $in: [...rejectedAt.keys()].map((id) => new Types.ObjectId(id)),
          },
        },
      ],
    };
    /** 這張單在這個時點要不要算(DB 條件取各時點的聯集,這裡逐個時點挑)。 */
    const countsAt = (row: SettlementSubmission, asOf: Date): boolean => {
      if (row.submittedAt === null || row.submittedAt >= asOf) {
        return false;
      }
      const key = String(row._id);
      switch (row.status) {
        case "completed": {
          const closedAsOf = closedAsOfOf.get(key);
          return (
            closedAsOf !== undefined &&
            (closedAsOf === null || closedAsOf >= asOf)
          );
        }
        case "voided": {
          const voidedAt = (row as { voidedAt?: Date | null }).voidedAt ?? null;
          return voidedAt !== null && voidedAt >= asOf;
        }
        case "rejected": {
          const finishedAt = rejectedAt.get(key);
          return finishedAt !== undefined && finishedAt >= asOf;
        }
        default: {
          return (SETTLEMENT_OPEN_STATUSES as readonly string[]).includes(
            row.status,
          );
        }
      }
    };
    const results = await this.outstandingWhere(
      operator,
      filter,
      asOfs.length,
      (row) =>
        asOfs.flatMap((asOf, key) => {
          const then = countsAt(row, asOf) ? submissionAt(row, asOf) : null;
          return then === null ? [] : [{ key, submission: then, before: asOf }];
        }),
    );
    return results.map((result) => result.rows);
  }

  /**
   * 時點區間內(`submittedAt` 早於最晚的時點)送出、在最早的時點以後才被駁回的單據 → 駁回時間
   * (= 流程實例結束的時間;單據上沒有駁回時間欄位)。實例以單據的租戶為邊界讀(審核流程不靠可見範圍)。
   */
  private async rejectedAfter(
    operator: OperatorContext,
    earliest: Date,
    latest: Date,
  ): Promise<Map<string, Date>> {
    const rejected = await this.submissions.findMany(
      operator,
      {
        moduleKey: { $in: settlementModuleKeys() },
        status: "rejected",
        submittedAt: { $lt: latest },
      },
      { select: "_id tenantId currentInstanceId" },
    );
    const withInstance = rejected.filter(
      (row) => row.currentInstanceId !== null,
    );
    const tenantId = withInstance[0]?.tenantId ?? null;
    if (withInstance.length === 0 || tenantId === null) {
      return new Map();
    }
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const instances = await this.instances.findMany(
      reader,
      {
        _id: { $in: withInstance.map((row) => row.currentInstanceId) },
        finishedAt: { $gte: earliest },
      },
      { select: "_id finishedAt" },
    );
    const finishedOf = new Map(
      instances.map((row) => [String(row._id), row.finishedAt]),
    );
    const result = new Map<string, Date>();
    for (const row of withInstance) {
      const finishedAt = finishedOf.get(String(row.currentInstanceId));
      if (finishedAt instanceof Date) {
        result.set(String(row._id), finishedAt);
      }
    }
    return result;
  }

  /**
   * 各登記的單據裡符合條件的待結清,分成 `groups` 組(`expand` 把一張單展開成要算的那幾組:組別、
   * 當時的樣子、收付只算哪個時點以前);每組的 `evaluated` = 算過的每一張(有沒有待結清、最後一筆收付的
   * 發生時間;寫結清標記用)。
   */
  private async outstandingWhere(
    operator: OperatorContext,
    filter: Record<string, unknown>,
    groups: number,
    expand: (row: SettlementSubmission) => EvaluationItem[],
  ): Promise<{ rows: OutstandingRow[]; evaluated: EvaluatedDocument[] }[]> {
    const results = Array.from({ length: groups }, () => ({
      rows: [] as OutstandingRow[],
      evaluated: [] as EvaluatedDocument[],
    }));
    for (const registration of settlementDocuments()) {
      const visible = (await this.submissions.findMany(
        operator,
        { moduleKey: registration.moduleKey, ...filter },
        { sort: { submittedAt: 1, _id: 1 } },
      )) as unknown as SettlementSubmission[];
      const items = visible.flatMap((row) => expand(row));
      const evaluations = await this.evaluate(operator, registration, items);
      for (const [index, item] of items.entries()) {
        const result = results[item.key];
        const evaluation = evaluations[index];
        if (result === undefined || evaluation === undefined) {
          continue;
        }
        const due =
          evaluation.snapshot === null
            ? []
            : outstandingOf(evaluation.snapshot);
        result.rows.push(...due);
        result.evaluated.push({
          submission: item.submission,
          open: due.length > 0,
          latestAt: evaluation.latestAt,
        });
      }
    }
    return results;
  }

  /**
   * 銀行 [登記交易] 選「進貨收入 / 調貨收入」:單據要有某一邊的 [收到退款] / [收款] 預設 > 0
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

  /** 一批提交的現況(不參與收付的略過);給了 `before` = 收付只算那個時點以前的。 */
  async snapshotsOf(
    operator: OperatorContext,
    registration: SettlementDocumentRegistration,
    submissions: readonly SettlementSubmission[],
    before?: Date,
  ): Promise<SettlementSnapshot[]> {
    const evaluations = await this.evaluate(
      operator,
      registration,
      submissions.map((submission) => ({ key: 0, submission, before })),
    );
    return evaluations.flatMap((evaluation) =>
      evaluation.snapshot === null ? [] : [evaluation.snapshot],
    );
  }

  /**
   * 一批要算的單據(同一張可以在不同時點各算一次)的現況與最後一筆收付的發生時間,順序同 `items`;
   * 不參與收付的 `snapshot` 是 null。指令數不隨張數、時點數成長(TX-07):應付一批算(`payables`)、
   * 收付每個租戶讀一次。
   */
  private async evaluate(
    operator: OperatorContext,
    registration: SettlementDocumentRegistration,
    items: readonly EvaluationItem[],
  ): Promise<{ snapshot: SettlementSnapshot | null; latestAt: Date }[]> {
    const payables = await payablesOf(registration, items);
    const byTenant = new Map<string, number[]>();
    for (const [index, item] of items.entries()) {
      if (payables[index] != null) {
        const key = String(item.submission.tenantId);
        byTenant.set(key, [...(byTenant.get(key) ?? []), index]);
      }
    }
    const totals = new Map<number, ItemTotals>();
    for (const indexes of byTenant.values()) {
      const group = indexes.flatMap((index) => {
        const item = items[index];
        return item === undefined ? [] : [item];
      });
      const result = await this.totalsOf(
        operator,
        group[0]?.submission.tenantId ?? null,
        group.map((item) => ({
          refId: item.submission._id,
          before: item.before,
        })),
      );
      for (const [position, index] of indexes.entries()) {
        const value = result[position];
        if (value !== undefined) {
          totals.set(index, value);
        }
      }
    }
    return items.map((item, index) => {
      const payable = payables[index] ?? null;
      const itemTotals = totals.get(index);
      return {
        latestAt: itemTotals?.latestAt ?? new Date(0),
        snapshot:
          payable === null
            ? null
            : {
                registration,
                submission: item.submission,
                payable,
                state: {
                  payable: payable.amount,
                  ...(payable.received === undefined
                    ? {}
                    : { received: payable.received }),
                  sides: itemTotals?.sides ?? {},
                },
              },
      };
    });
  }

  /**
   * 每一項(單據 + 只算哪個時點以前)的邊 → 支出 / 收入合計(銀行交易 + 現金流水)與最後一筆的發生時間,
   * 順序同 `items`。收付以租戶邊界讀,一次讀這批單據的收付(最晚的時點以前),在記憶體依各項的時點加總。
   */
  private async totalsOf(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    items: readonly { refId: Types.ObjectId; before?: Date }[],
  ): Promise<ItemTotals[]> {
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const unbounded = items.some((item) => item.before === undefined);
    const latestBefore = unbounded
      ? null
      : Math.max(...items.map((item) => item.before?.getTime() ?? 0));
    const match = {
      refId: {
        $in: [
          ...new Map(
            items.map((item) => [String(item.refId), item.refId]),
          ).values(),
        ],
      },
      settlementSide: { $ne: null },
      ...(latestBefore === null
        ? {}
        : { occurredAt: { $lt: new Date(latestBefore) } }),
    };
    // 各項的時點都一樣(待結清現況、單一時點)→ 在 DB 依單據 / 邊 / 方向加總;時點不同(報表各店的期末)→ 逐筆帶回,
    // 在記憶體依各項的時點加總
    const first = items[0]?.before?.getTime();
    const shape = items.every((item) => item.before?.getTime() === first)
      ? ledgerGrouping
      : ledgerProjection;
    const [bankRows, cashRows] = await Promise.all([
      this.bank.aggregate(reader, [{ $match: match }, ...shape("$direction")]),
      this.cash.aggregate(reader, [
        { $match: match },
        // 現金流出到外部 = 這一邊支出;從外部流入 = 收入
        ...shape({ $cond: [{ $eq: ["$to", "external"] }, "out", "in"] }),
      ]),
    ]);
    const rowsOf = new Map<string, LedgerRow[]>();
    for (const row of [...bankRows, ...cashRows] as unknown as LedgerRow[]) {
      const key = String(row.refId);
      rowsOf.set(key, [...(rowsOf.get(key) ?? []), row]);
    }
    return items.map((item) => {
      const sides: Record<string, SettlementSideTotals> = {};
      let latestAt = new Date(0);
      for (const row of rowsOf.get(String(item.refId)) ?? []) {
        if (item.before !== undefined && row.occurredAt >= item.before) {
          continue;
        }
        const totals = sides[row.side] ?? { out: 0, in: 0 };
        totals[row.direction] += row.amount;
        sides[row.side] = totals;
        if (row.occurredAt > latestAt) {
          latestAt = row.occurredAt;
        }
      }
      return { sides, latestAt };
    });
  }
}

/**
 * 單據在某個時點的樣子:值取 `ctx.at` 早於那個時點的最後一筆修訂(修訂是完整值快照);狀態照 `THEN_STATUS`
 * 還原。沒有更早的修訂(當時還沒送出)→ null(不算)。
 */
function submissionAt(
  submission: SettlementSubmission,
  asOf: Date,
): SettlementSubmission | null {
  const revisions =
    (
      submission as SettlementSubmission & {
        revisions?: readonly {
          values: SettlementSubmission["values"];
          ctx: { at: Date };
        }[];
      }
    ).revisions ?? [];
  const last = revisions.findLast((entry) => entry.ctx.at < asOf);
  if (last === undefined) {
    return null;
  }
  // 讀出來的是 mongoose 文件(展開會掉欄位):逐欄抄成純物件
  return {
    _id: submission._id,
    orgId: submission.orgId,
    tenantId: submission.tenantId,
    moduleKey: submission.moduleKey,
    status: THEN_STATUS[submission.status] ?? submission.status,
    revision: submission.revision,
    values: last.values,
    submittedAt: submission.submittedAt,
    serialNo: submission.serialNo ?? null,
  };
}

/** 某個時點的單據狀態:之後才作廢的,當時是已完成;之後才駁回的,當時是審核中。 */
const THEN_STATUS: Readonly<Partial<Record<string, string>>> = {
  voided: "completed",
  rejected: "reviewing",
};

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
