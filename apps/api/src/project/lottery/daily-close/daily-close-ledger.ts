import { Injectable } from "@nestjs/common";
import type { ClientSession, Types } from "mongoose";

import {
  CHECKOUT_STATUS,
  CHECKOUT_TYPE,
  type ExpectedCashItemKind,
  VAULT_CASH_ITEM_KINDS,
  expectedCashTotalOf,
} from "@repo/domain/project/lottery";
import { CASH_MOVEMENT_TYPE } from "@repo/domain/project/lottery-accounts";

import type { Persisted } from "../../../database/base.repository";
import type { OperatorContext } from "../../../database/operator-context";
import { LotteryCashMovementsRepository } from "../../database/lottery-accounts/lottery-accounts.repositories";
import type {
  CheckoutCashEntry,
  CheckoutCashItem,
} from "../../database/lottery-checkouts/lottery-checkout.schema";
import {
  type LotteryCheckoutDocument,
  LotteryCheckoutsRepository,
} from "../../database/lottery-checkouts/lottery-checkouts.repository";
import { LotteryShiftsRepository } from "../../database/lottery-store/lottery-shifts.repository";
import {
  CashLedgerService,
  type VaultBaseline,
} from "../cash/cash-ledger.service";
import type { ShiftRecord } from "../store/shift-views";

export type CheckoutRecord = Persisted<LotteryCheckoutDocument>;

/** 現金流水類型 → 小金庫應有的項(流入小金庫 +、流出 −)。 */
const VAULT_KIND: Readonly<Record<string, ExpectedCashItemKind>> = {
  [CASH_MOVEMENT_TYPE.deposit]: "deposits",
  [CASH_MOVEMENT_TYPE.withdraw]: "withdrawals",
  [CASH_MOVEMENT_TYPE.transferOut]: "transfers",
  [CASH_MOVEMENT_TYPE.transferIn]: "transfers",
  [CASH_MOVEMENT_TYPE.correctionIncrease]: "corrections",
  [CASH_MOVEMENT_TYPE.correctionDecrease]: "corrections",
  [CASH_MOVEMENT_TYPE.bankDeposit]: "bank_deposits",
};

/** 小金庫應有:各項(含期初 = 起算點)、合計、起算點。 */
export interface VaultCash {
  items: CheckoutCashItem[];
  expected: number;
  baseline: VaultBaseline;
}

const options = (session?: ClientSession) =>
  session === undefined ? {} : { session };

/**
 * 日結的共用讀取(規格 6.10、6.6、10.2;正本 `docs/modules/project/store.md`「日結與存銀行」):
 * 這家店最近一張日結、涵蓋計算的班、還沒被涵蓋的最早一班、小金庫應有的各項。
 * `reader` 是呼叫端的讀取身分(操作者,或租戶邊界的系統身分)。
 *
 * **涵蓋計算**以班的 `closedAt`(送出交班結帳的時間;退回後再送出不變)判斷:
 * 這家店某張日結的 `coveredTo` ≥ 班的 `closedAt` → 那一班已被日結涵蓋計算(那張日結已送出)。
 */
@Injectable()
export class DailyCloseLedger {
  constructor(
    private readonly checkouts: LotteryCheckoutsRepository,
    private readonly shifts: LotteryShiftsRepository,
    private readonly movements: LotteryCashMovementsRepository,
    private readonly ledger: CashLedgerService,
  ) {}

  /** 這家店最近一張日結(任何狀態;`excludeSubmissionId` = 退回後再送出時排除自己)。 */
  lastDaily(
    reader: OperatorContext,
    orgId: Types.ObjectId,
    excludeSubmissionId: Types.ObjectId | null = null,
    session?: ClientSession,
  ): Promise<CheckoutRecord | null> {
    return this.checkouts.findOne(
      reader,
      {
        orgId,
        type: CHECKOUT_TYPE.daily,
        ...(excludeSubmissionId === null
          ? {}
          : { submissionId: { $ne: excludeSubmissionId } }),
      },
      { sort: { coveredTo: -1, _id: -1 }, ...options(session) },
    );
  }

  /** 這家店審核中 / 已退回待更正的日結(不含 `excludeSubmissionId`);沒有 = null。 */
  pendingDaily(
    reader: OperatorContext,
    orgId: Types.ObjectId,
    excludeSubmissionId: Types.ObjectId | null = null,
    session?: ClientSession,
  ): Promise<CheckoutRecord | null> {
    return this.checkouts.findOne(
      reader,
      {
        orgId,
        type: CHECKOUT_TYPE.daily,
        status: { $in: [CHECKOUT_STATUS.pending, CHECKOUT_STATUS.returned] },
        ...(excludeSubmissionId === null
          ? {}
          : { submissionId: { $ne: excludeSubmissionId } }),
      },
      options(session),
    );
  }

  /** 這家店最近一張**已確認**的日結(小金庫起算點);`before` 給了 = 那個時點以前送出的。 */
  lastConfirmedDaily(
    reader: OperatorContext,
    orgId: Types.ObjectId,
    before?: Date,
  ): Promise<CheckoutRecord | null> {
    return this.checkouts.findOne(
      reader,
      {
        orgId,
        type: CHECKOUT_TYPE.daily,
        status: CHECKOUT_STATUS.confirmed,
        ...(before === undefined ? {} : { submittedAt: { $lt: before } }),
      },
      { sort: { coveredTo: -1, _id: -1 } },
    );
  }

  /** 這家店開著的班。 */
  openShifts(
    reader: OperatorContext,
    orgId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<ShiftRecord[]> {
    return this.shifts.findMany(
      reader,
      { orgId, closedAt: null },
      { sort: { openedAt: 1 }, ...options(session) },
    );
  }

  /**
   * 涵蓋計算的班:`from` 之後、`to`(含)之前送出交班結帳的班(`from = null` = 從頭)。
   * `to` 不給 = 到現在(精靈畫面)。
   */
  coveredShifts(
    reader: OperatorContext,
    orgId: Types.ObjectId,
    from: Date | null,
    to: Date | null,
    session?: ClientSession,
    limit?: number,
  ): Promise<ShiftRecord[]> {
    return this.shifts.findMany(
      reader,
      {
        orgId,
        closedAt: {
          $ne: null,
          ...(from === null ? {} : { $gt: from }),
          ...(to === null ? {} : { $lte: to }),
        },
      },
      {
        sort: { closedAt: 1, _id: 1 },
        ...(limit === undefined ? {} : { limit }),
        ...options(session),
      },
    );
  }

  /** 每一班目前的交班結帳(依班次 id;一班只有一張,退回後再送出改寫同一張)。 */
  async shiftCheckoutsOf(
    reader: OperatorContext,
    shiftIds: readonly Types.ObjectId[],
    session?: ClientSession,
  ): Promise<Map<string, CheckoutRecord>> {
    if (shiftIds.length === 0) {
      return new Map();
    }
    const rows = await this.checkouts.findMany(
      reader,
      { shiftId: { $in: [...shiftIds] }, type: CHECKOUT_TYPE.shift },
      { sort: { submittedAt: 1 }, ...options(session) },
    );
    return new Map(rows.map((row) => [String(row.shiftId), row]));
  }

  /** 這一班是否已被送出的日結涵蓋計算(規格 6.6 第一班的判斷)。 */
  async isShiftCovered(
    reader: OperatorContext,
    shiftId: Types.ObjectId,
  ): Promise<boolean> {
    const shift = await this.shifts.findById(reader, shiftId);
    if (shift?.closedAt == null) {
      return false;
    }
    const covering = await this.checkouts.findOne(reader, {
      orgId: shift.orgId,
      type: CHECKOUT_TYPE.daily,
      coveredTo: { $gte: shift.closedAt },
    });
    return covering !== null;
  }

  /**
   * 每家店還沒被日結涵蓋計算的最早一班的送出時間(日結逾期、側欄計數;規格 3.4、6.10)。
   * 範圍 = 讀者看得到的店;沒有 = 不在 map 裡。
   */
  async earliestUncovered(reader: OperatorContext): Promise<Map<string, Date>> {
    const [lastDaily, closed] = await Promise.all([
      this.lastCoveredByOrg(reader),
      this.shifts.aggregate(reader, [
        { $match: { closedAt: { $ne: null } } },
        { $group: { _id: "$orgId", last: { $max: "$closedAt" } } },
      ]),
    ]);
    // 有還沒涵蓋的班的店:各店「涵蓋到」之後最早的一班,一次 aggregate(各店條件不同 → `$or`;TX-07)
    const branches = closed.flatMap((row) => {
      const orgId = row._id as Types.ObjectId;
      const covered = lastDaily.get(String(orgId)) ?? null;
      const latest = row.last as Date;
      if (covered !== null && latest <= covered) {
        return [];
      }
      return [
        {
          orgId,
          closedAt: covered === null ? { $ne: null } : { $gt: covered },
        },
      ];
    });
    const result = new Map<string, Date>();
    if (branches.length === 0) {
      return result;
    }
    const earliest = await this.shifts.aggregate(reader, [
      { $match: { $or: branches } },
      { $group: { _id: "$orgId", first: { $min: "$closedAt" } } },
    ]);
    for (const row of earliest) {
      if (row.first instanceof Date) {
        result.set(String(row._id), row.first);
      }
    }
    return result;
  }

  /**
   * `from`(含)至 `to`(不含)開的班裡,已送出交班結帳、但沒有被日結涵蓋計算的(關帳的警告與快照;規格 10.4)。
   * 判斷和 `isShiftCovered` 同一個定義:這家店最近一張日結的涵蓋計算期間終點 < 班的 `closedAt`。依開班時間排。
   */
  async uncoveredShiftsOpenedIn(
    reader: OperatorContext,
    from: Date,
    to: Date,
  ): Promise<ShiftRecord[]> {
    const [lastDaily, closed] = await Promise.all([
      this.lastCoveredByOrg(reader),
      this.shifts.findMany(
        reader,
        { openedAt: { $gte: from, $lt: to }, closedAt: { $ne: null } },
        { sort: { openedAt: 1, _id: 1 } },
      ),
    ]);
    return closed.filter((shift) => {
      const covered = lastDaily.get(String(shift.orgId)) ?? null;
      return (
        covered === null || shift.closedAt === null || shift.closedAt > covered
      );
    });
  }

  /** 每家店最近一張日結的涵蓋計算期間終點(任何狀態;日結送出就算涵蓋)。 */
  private async lastCoveredByOrg(
    reader: OperatorContext,
  ): Promise<Map<string, Date | null>> {
    const dailies = await this.checkouts.aggregate(reader, [
      { $match: { type: CHECKOUT_TYPE.daily } },
      { $group: { _id: "$orgId", last: { $max: "$coveredTo" } } },
    ]);
    return new Map(
      dailies.map((row) => [String(row._id), row.last as Date | null]),
    );
  }

  /**
   * 小金庫應有的各項(規格 6.10 第 ③ 步):期初(起算點 = 最近一次已確認日結的清點金額)+ 投庫 − 出庫 ± 調貨
   * ± 現金更正 − 存銀行;每筆流水可點回(即時現金帳 `?movementId=`)。合計 = `CashLedgerService.vaultExpected`。
   */
  async vaultCashOf(
    reader: OperatorContext,
    tenantId: Types.ObjectId | null,
    orgId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<VaultCash> {
    const baseline = await this.ledger.vaultBaseline(tenantId, orgId);
    const items = new Map<ExpectedCashItemKind, CheckoutCashItem>(
      VAULT_CASH_ITEM_KINDS.map((kind) => [
        kind,
        { kind, count: 0, amount: 0, entries: [] },
      ]),
    );
    const opening = items.get("opening");
    if (opening !== undefined) {
      opening.amount = baseline.amount;
    }
    const rows = await this.movements.findMany(
      reader,
      {
        orgId,
        $or: [{ from: "vault" }, { to: "vault" }],
        ...(baseline.since === null
          ? {}
          : { occurredAt: { $gt: baseline.since } }),
      },
      { sort: { occurredAt: 1, _id: 1 }, ...options(session) },
    );
    for (const row of rows) {
      const item = items.get(VAULT_KIND[row.type] ?? "corrections");
      if (item === undefined) {
        continue;
      }
      const amount = row.to === "vault" ? row.amount : -row.amount;
      const entry: CheckoutCashEntry = {
        refType: "movement",
        refId: row._id,
        label: row.note ?? "",
        occurredAt: row.occurredAt,
        amount,
      };
      item.count += 1;
      item.amount += amount;
      item.entries.push(entry);
    }
    const list = VAULT_CASH_ITEM_KINDS.flatMap((kind) => {
      const item = items.get(kind);
      return item === undefined ? [] : [item];
    });
    return { items: list, expected: expectedCashTotalOf(list), baseline };
  }
}
