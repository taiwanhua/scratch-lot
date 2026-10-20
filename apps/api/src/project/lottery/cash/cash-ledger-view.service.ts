import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  ACCOUNTS_PERMISSIONS,
  type CashMovementType,
} from "@repo/domain/project/lottery-accounts";

import type { Persisted } from "../../../database/base.repository";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import {
  type LotteryCashMovementDocument,
  LotteryCashMovementsRepository,
} from "../../database/lottery-accounts/lottery-accounts.repositories";
import { LotteryCashPointsRepository } from "../../database/lottery-cash-points/lottery-cash-points.repository";
import { AccountNames } from "../accounts/account-names";
import { AccountsAccess } from "../accounts/accounts-access";
import { notFoundError } from "../accounts/accounts-error";
import { firstOf, parseId } from "../accounts/accounts-util";
import { CashLedgerService } from "./cash-ledger.service";
import type {
  LotteryCashLedgerInput,
  LotteryCashLedgerPayload,
  LotteryCashMovementModel,
} from "./models/lottery-cash-ledger.model";

type MovementRecord = Persisted<LotteryCashMovementDocument>;

const MAX_ROWS = 500;

/**
 * 即時現金帳(`accounts` → 即時現金帳分頁,只能查看;專案規格 10.2)。要 `accounts.view-cash`;
 * 分店要在可見範圍內(看不到 → `NOT_FOUND`)。上方小金庫的應有只從流水算;各收銀點抽屜的應有
 * 由店面(收銀班次)併回後補上。
 */
@Injectable()
export class CashLedgerViewService {
  constructor(
    private readonly movements: LotteryCashMovementsRepository,
    private readonly cashPoints: LotteryCashPointsRepository,
    private readonly ledger: CashLedgerService,
    private readonly names: AccountNames,
    private readonly access: AccountsAccess,
  ) {}

  async ledgerOf(
    operator: OperatorContext,
    input: LotteryCashLedgerInput,
  ): Promise<LotteryCashLedgerPayload> {
    const grant = await this.access.assert(
      operator,
      ACCOUNTS_PERMISSIONS.viewCash,
    );
    const orgId = parseId(input.orgId);
    if (orgId === null || !isOrgVisible(operator, orgId)) {
      throw notFoundError(`branch not found: ${input.orgId}`);
    }
    const range = {
      ...(input.from == null ? {} : { $gte: input.from }),
      ...(input.to == null ? {} : { $lt: input.to }),
    };
    const cashPointId = parseId(input.cashPointId);
    const filter = {
      orgId,
      ...(Object.keys(range).length === 0 ? {} : { occurredAt: range }),
      ...(input.type ? { type: input.type as CashMovementType } : {}),
      ...(cashPointId === null ? {} : { cashPointId }),
    };
    const [vault, totalCount, rows] = await Promise.all([
      this.ledger.vaultExpected(operator, grant.tenantId, orgId),
      this.movements.count(operator, filter),
      this.movements.findMany(operator, filter, {
        sort: { occurredAt: -1, createdAt: -1, _id: -1 },
        limit: MAX_ROWS,
      }),
    ]);
    return {
      vault: {
        amount: vault.amount,
        baselineAmount: vault.baseline.amount,
        baselineAt: vault.baseline.since,
      },
      items: await this.toModels(operator, grant.tenantId, rows),
      totalCount,
    };
  }

  /** 一筆流水(58mm 單據的 QR `?movementId=` → 帶到那一筆的分店與日期)。 */
  async movementOf(
    operator: OperatorContext,
    id: string,
  ): Promise<LotteryCashMovementModel> {
    const grant = await this.access.assert(
      operator,
      ACCOUNTS_PERMISSIONS.viewCash,
    );
    const movementId = parseId(id);
    const row =
      movementId === null
        ? null
        : await this.movements.findById(operator, movementId);
    if (!row) {
      throw notFoundError(`cash movement not found: ${id}`);
    }
    return firstOf(await this.toModels(operator, grant.tenantId, [row]));
  }

  private async toModels(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    rows: readonly MovementRecord[],
  ): Promise<LotteryCashMovementModel[]> {
    const pointIds = rows.flatMap((row) =>
      row.cashPointId === null ? [] : [row.cashPointId],
    );
    const [points, reversals, orgNames, userNames] = await Promise.all([
      pointIds.length === 0
        ? []
        : this.cashPoints.findMany(operator, { _id: { $in: pointIds } }),
      rows.length === 0
        ? []
        : this.movements.findMany(operator, {
            reversalOf: { $in: rows.map((row) => row._id) },
          }),
      this.names.orgNames(
        operator,
        tenantId,
        rows.map((row) => row.orgId),
      ),
      this.names.userNames(
        operator,
        tenantId,
        rows.map((row) => row.createdBy),
      ),
    ]);
    const pointName = new Map(
      points.map((point) => [String(point._id), point.name]),
    );
    const reversedBy = new Map(
      reversals.map((row) => [String(row.reversalOf), String(row._id)]),
    );
    return rows.map((row) => {
      const pointKey =
        row.cashPointId === null ? null : String(row.cashPointId);
      const creatorKey = row.createdBy == null ? null : String(row.createdBy);
      return {
        id: String(row._id),
        org: {
          id: String(row.orgId),
          name: orgNames.get(String(row.orgId)) ?? "",
        },
        occurredAt: row.occurredAt,
        type: row.type,
        from: row.from,
        to: row.to,
        reason: row.reason,
        cashPoint:
          pointKey === null
            ? null
            : { id: pointKey, name: pointName.get(pointKey) ?? "" },
        amount: row.amount,
        payee: row.payee,
        note: row.note,
        refType: row.refType,
        refId: row.refId === null ? null : String(row.refId),
        reversalOf: row.reversalOf === null ? null : String(row.reversalOf),
        reversedById: reversedBy.get(String(row._id)) ?? null,
        createdBy:
          creatorKey === null
            ? null
            : { id: creatorKey, name: userNames.get(creatorKey) ?? "" },
      };
    });
  }
}
