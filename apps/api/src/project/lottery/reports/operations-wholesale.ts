import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { compareDisplayName } from "@repo/domain/collation";
import {
  TICKET_EVENT_TYPE,
  WHOLESALE_MODULE_KEY,
  WHOLESALE_REF_TYPE,
  WHOLESALE_SETTLEMENT_SIDE,
  wholesaleHeaderOf,
  wholesaleLinesOf,
  wholesaleTotalOf,
} from "@repo/domain/project/lottery";
import { receivedNetOf } from "@repo/domain/project/lottery-accounts";

import {
  FormSubmissionsRepository,
  WorkflowInstancesRepository,
} from "../../../database/base/repositories";
import type { OperatorContext } from "../../../database/operator-context";
import { LotteryTicketEventsRepository } from "../../database/lottery-inventory/lottery-inventory.repository";
import type { SettlementSnapshot } from "../settlement/settlement-ledger";
import { WholesaleCustomerNames } from "../wholesale/wholesale-customer-names";
import type {
  LotteryOperationsWholesaleCustomerModel,
  LotteryOperationsWholesaleDocumentModel,
  LotteryOperationsWholesaleDocumentsModel,
  LotteryOperationsWholesaleModel,
} from "./models/operations-wholesale.model";
import type { WholesaleFlow } from "./operations-wholesale-flows";
import type { StorePeriod } from "./report-periods";

/** 說明列最多列幾張單號(同區塊 7)。 */
const MAX_LISTED = 5;

/** 鎖定區間結束的流程歷程(退回、撤回、駁回、完成;專案規格 21.7 Q4)。 */
const LOCK_END_KINDS: ReadonlySet<string> = new Set([
  "returned",
  "withdrawn",
  "rejected",
  "completed",
]);

/** 讀出來的批售單(逐欄抄;`revisions` 只在期末批售中讀)。 */
interface WholesaleSubmissionRow {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId | null;
  serialNo?: string | null;
  values: Record<string, unknown>;
  voidedAt?: Date | null;
  revisions?: readonly {
    values: Record<string, unknown>;
    ctx: { at: Date };
  }[];
}

interface InstanceRow {
  submissionId: Types.ObjectId;
  history: readonly { at: Date; kind: string }[];
}

const emptyDocuments = (): LotteryOperationsWholesaleDocumentsModel => ({
  count: 0,
  books: 0,
  tickets: 0,
  amount: 0,
  serialNos: [],
});

/** 收付合計 → 出貨店(收款方)的已收淨額。 */
const receivedOf = (snapshot: SettlementSnapshot): number =>
  receivedNetOf(
    snapshot.state.sides[WHOLESALE_SETTLEMENT_SIDE] ?? { out: 0, in: 0 },
  );

/** 期末那一刻的一組單據 → 合計 + 單號(最多 5 張)。 */
function documentsOf(
  rows: readonly {
    serialNo: string | null;
    books: number;
    tickets: number;
    amount: number;
  }[],
): LotteryOperationsWholesaleDocumentsModel {
  const result = emptyDocuments();
  for (const row of rows) {
    result.count += 1;
    result.books += row.books;
    result.tickets += row.tickets;
    result.amount += row.amount;
    if (row.serialNo !== null && result.serialNos.length < MAX_LISTED) {
      result.serialNos.push(row.serialNo);
    }
  }
  return result;
}

/**
 * 營運報表區塊 2b 批售與區塊 4 的「期末批售中」(專案規格 21.7;正本 `docs/modules/project/reports.md`「營運報表」)。
 * 全部從紀錄回推,不新增資料;重跑舊報表數字不變:
 *
 * - 依客戶 / 逐單:區塊 4 算好的批售進出(`wholesaleFlowsOf`,依出貨 / 作廢事件的時間歸期間);期末已收 / 待收用
 *   收付機制在期末那一刻的單據現況(`SettlementLedger.settlementAtMany`),不在裡面的已完成單據 = 期末以前就已結清
 *   (已收 = 批售金額)
 * - 期末已收未出貨:期末那一刻參與收付的批售單裡,期末以前還沒有「批售」事件、已收淨額不是 0 的
 * - 期末批售中:流程實例的鎖定區間(`started` 到第一筆退回 / 撤回 / 駁回 / 完成)含期末的單,明細取 `ctx.at` 不晚於
 *   期末的最後一筆修訂
 *
 * 讀取一律以報表的租戶邊界上下文(`ReportScope.reader`),各店一次讀完(TX-07)。
 */
@Injectable()
export class OperationsWholesale {
  constructor(
    private readonly submissions: FormSubmissionsRepository,
    private readonly instances: WorkflowInstancesRepository,
    private readonly events: LotteryTicketEventsRepository,
    private readonly names: WholesaleCustomerNames,
  ) {}

  /**
   * 各店期末那一刻被審核中批售單鎖住的本(只是註記,不進核對):各店的期末一次算(實例、單據各讀一次)。
   */
  async pendingAtEndOf(
    reader: OperatorContext,
    periods: readonly StorePeriod[],
  ): Promise<
    (period: StorePeriod) => LotteryOperationsWholesaleDocumentsModel
  > {
    if (periods.length === 0) {
      return () => emptyDocuments();
    }
    const times = periods.map((period) => period.to.getTime());
    const earliest = new Date(Math.min(...times));
    const latest = new Date(Math.max(...times));
    const instances = (await this.instances.findMany(
      reader,
      {
        moduleKey: WHOLESALE_MODULE_KEY,
        history: { $elemMatch: { kind: "started", at: { $lte: latest } } },
        $or: [{ finishedAt: null }, { finishedAt: { $gte: earliest } }],
      },
      { select: "submissionId history" },
    )) as unknown as InstanceRow[];
    const intervals = instances.flatMap((instance) => {
      const started = instance.history.find(
        (entry) => entry.kind === "started",
      );
      const ended = instance.history.find((entry) =>
        LOCK_END_KINDS.has(entry.kind),
      );
      return started === undefined
        ? []
        : [
            {
              submissionId: instance.submissionId,
              from: started.at,
              to: ended?.at ?? null,
            },
          ];
    });
    const submissions =
      intervals.length === 0
        ? []
        : ((await this.submissions.findMany(
            reader,
            {
              _id: { $in: intervals.map((entry) => entry.submissionId) },
              moduleKey: WHOLESALE_MODULE_KEY,
            },
            { select: "serialNo revisions" },
          )) as unknown as WholesaleSubmissionRow[]);
    const submissionOf = new Map(
      submissions.map((row) => [String(row._id), row]),
    );
    return (period) => {
      const at = period.to;
      const locked = new Map<string, WholesaleSubmissionRow>();
      for (const interval of intervals) {
        const row = submissionOf.get(String(interval.submissionId));
        if (
          row !== undefined &&
          interval.from <= at &&
          (interval.to === null || at < interval.to)
        ) {
          locked.set(String(row._id), row);
        }
      }
      return documentsOf(
        [...locked.values()].flatMap((row) => {
          const revision = (row.revisions ?? []).findLast(
            (entry) => entry.ctx.at <= at,
          );
          if (
            revision === undefined ||
            wholesaleHeaderOf(revision.values).fromBranchId !==
              String(period.orgId)
          ) {
            return [];
          }
          const lines = wholesaleLinesOf(revision.values);
          return [
            {
              serialNo: row.serialNo ?? null,
              books: lines.length,
              tickets: lines.reduce((sum, line) => sum + line.tickets, 0),
              amount: wholesaleTotalOf(lines),
            },
          ];
        }),
      );
    };
  }

  /**
   * 一家店的 2b(期末批售中由 `pendingAtEndOf` 另外算)。`flows` = 區塊 4 算好的批售進出;`snapshots` = 期末那一刻
   * 參與收付的單據現況(各種單據都有,這裡只挑這家店的批售單)。
   */
  async storeOf(
    reader: OperatorContext,
    period: StorePeriod,
    flows: readonly WholesaleFlow[],
    snapshots: readonly SettlementSnapshot[],
  ): Promise<Omit<LotteryOperationsWholesaleModel, "pendingAtEnd">> {
    const own = snapshots.filter(
      (snapshot) =>
        snapshot.registration.moduleKey === WHOLESALE_MODULE_KEY &&
        snapshot.payable.branchOrgId.equals(period.orgId),
    );
    const snapshotOf = new Map(
      own.map((snapshot) => [String(snapshot.submission._id), snapshot]),
    );
    const [documents, receivedUnshipped] = await Promise.all([
      this.documentsOf(reader, period, flows, snapshotOf),
      this.receivedUnshippedOf(reader, period, own),
    ]);
    return {
      customers: customersOf(documents),
      documents,
      receivedUnshipped,
    };
  }

  /** 逐單:出貨 / 作廢在這一期的每張單一列(作廢列是負數)。 */
  private async documentsOf(
    reader: OperatorContext,
    period: StorePeriod,
    flows: readonly WholesaleFlow[],
    snapshotOf: ReadonlyMap<string, SettlementSnapshot>,
  ): Promise<LotteryOperationsWholesaleDocumentModel[]> {
    if (flows.length === 0) {
      return [];
    }
    const rows = (await this.submissions.findMany(
      reader,
      {
        _id: { $in: flows.map((flow) => flow.refId) },
        moduleKey: WHOLESALE_MODULE_KEY,
      },
      { select: "tenantId serialNo values voidedAt" },
    )) as unknown as WholesaleSubmissionRow[];
    const rowOf = new Map(rows.map((row) => [String(row._id), row]));
    const names = await this.names.storeNamesOf(
      rows[0]?.tenantId ?? null,
      rows.map((row) => row.values),
    );
    const nameOf = new Map(
      rows.map((row, index) => [String(row._id), names[index] ?? ""]),
    );
    return flows
      .map((flow) => {
        const key = String(flow.refId);
        const row = rowOf.get(key);
        const values = row?.values ?? {};
        const sign = flow.voided ? -1 : 1;
        const { received, toReceive } = endOf(
          snapshotOf.get(key),
          row,
          period.to,
        );
        return {
          submissionId: key,
          serialNo: row?.serialNo ?? null,
          voided: flow.voided,
          at: flow.at,
          customerId: wholesaleHeaderOf(values).customerId,
          customerName: nameOf.get(key) ?? "",
          books: sign * flow.books,
          tickets: sign * flow.tickets,
          amount: sign * flow.amount,
          cost: sign * flow.cost,
          paymentMode: wholesaleHeaderOf(values).paymentMode,
          receivedAtEnd: received,
          toReceiveAtEnd: toReceive,
        };
      })
      .toSorted(
        (a, b) =>
          a.at.getTime() - b.at.getTime() ||
          (a.serialNo ?? "").localeCompare(b.serialNo ?? ""),
      );
  }

  /** 期末已收未出貨:期末那一刻參與收付、期末以前還沒出貨、已收淨額不是 0 的批售單(金額 = 已收淨額合計)。 */
  private async receivedUnshippedOf(
    reader: OperatorContext,
    period: StorePeriod,
    snapshots: readonly SettlementSnapshot[],
  ): Promise<LotteryOperationsWholesaleDocumentsModel> {
    const candidates = snapshots.filter(
      (snapshot) => receivedOf(snapshot) !== 0,
    );
    if (candidates.length === 0) {
      return emptyDocuments();
    }
    const shipped = (await this.events.aggregate(reader, [
      {
        $match: {
          refType: WHOLESALE_REF_TYPE,
          refId: { $in: candidates.map((row) => row.submission._id) },
          type: TICKET_EVENT_TYPE.wholesale,
          at: { $lt: period.to },
        },
      },
      { $group: { _id: "$refId" } },
    ])) as { _id: Types.ObjectId }[];
    const shippedIds = new Set(shipped.map((row) => String(row._id)));
    return documentsOf(
      candidates
        .filter((snapshot) => !shippedIds.has(String(snapshot.submission._id)))
        .map((snapshot) => ({
          serialNo: snapshot.submission.serialNo ?? null,
          books: 0,
          tickets: 0,
          amount: receivedOf(snapshot),
        })),
    );
  }
}

/**
 * 一張單期末的已收 / 待收:期末那一刻參與收付 → 照當時的收付算;不在裡面 → 期末以前已作廢的 0,
 * 其他是期末以前就已結清的已完成單據(已收 = 批售金額)。
 */
function endOf(
  snapshot: SettlementSnapshot | undefined,
  row: WholesaleSubmissionRow | undefined,
  at: Date,
): { received: number; toReceive: number } {
  if (snapshot !== undefined) {
    const received = receivedOf(snapshot);
    return {
      received,
      toReceive: Math.max(0, snapshot.state.payable - received),
    };
  }
  const voidedAt = row?.voidedAt ?? null;
  if (row === undefined || (voidedAt !== null && voidedAt < at)) {
    return { received: 0, toReceive: 0 };
  }
  return {
    received: wholesaleTotalOf(wholesaleLinesOf(row.values)),
    toReceive: 0,
  };
}

/** 金額加總後才四捨五入到元(專案規格 21.7)。 */
const toYuan = (value: number): number => Math.round(value);

/** 逐單 → 依客戶(單數、本數、張數、金額、原成本相加;作廢列扣回)。逐單的金額在這裡才四捨五入。 */
function customersOf(
  documents: LotteryOperationsWholesaleDocumentModel[],
): LotteryOperationsWholesaleCustomerModel[] {
  const byCustomer = new Map<string, LotteryOperationsWholesaleCustomerModel>();
  for (const document of documents) {
    const key = document.customerId ?? `name:${document.customerName}`;
    const customer = byCustomer.get(key) ?? {
      customerId: document.customerId,
      customerName: document.customerName,
      documents: 0,
      books: 0,
      tickets: 0,
      amount: 0,
      cost: 0,
    };
    customer.documents += document.voided ? -1 : 1;
    customer.books += document.books;
    customer.tickets += document.tickets;
    customer.amount += document.amount;
    customer.cost = (customer.cost ?? 0) + (document.cost ?? 0);
    byCustomer.set(key, customer);
    document.amount = toYuan(document.amount);
    document.cost = document.cost === null ? null : toYuan(document.cost);
  }
  const customers = [...byCustomer.values()];
  for (const customer of customers) {
    customer.amount = toYuan(customer.amount);
    customer.cost = customer.cost === null ? null : toYuan(customer.cost);
  }
  return customers.toSorted((a, b) =>
    compareDisplayName(a.customerName, b.customerName),
  );
}
