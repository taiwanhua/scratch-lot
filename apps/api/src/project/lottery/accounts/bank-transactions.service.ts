import { Injectable } from "@nestjs/common";
import { type ClientSession, Types } from "mongoose";

import {
  ACCOUNTS_PERMISSIONS,
  BANK_TRANSACTION_TYPE,
  BANK_TRANSACTION_TYPES,
  type BankTransactionType,
  DIRECTIONS,
  type Direction,
  BANK_ACCOUNT_LIMITS as LIMITS,
  documentRequirementOf,
  fixedDirectionOf,
  oppositeDirection,
  requiresBranch,
  requiresSummary,
  signedAmount,
} from "@repo/domain/project/lottery-accounts";

import { AuditService } from "../../../audit/audit.service";
import type { Persisted } from "../../../database/base.repository";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { TransactionService } from "../../../database/transaction";
import { RealtimePublisher } from "../../../realtime/realtime-publisher.service";
import {
  type LotteryBankAccountDocument,
  LotteryBankAccountsRepository,
  type LotteryBankTransactionDocument,
  LotteryBankTransactionsRepository,
  LotteryCashMovementsRepository,
} from "../../database/lottery-accounts/lottery-accounts.repositories";
import { CashLedgerService } from "../cash/cash-ledger.service";
import { SettlementLedger } from "../settlement/settlement-ledger";
import { SettlementMarks } from "../settlement/settlement-marks";
import {
  assertSideReversible,
  canReverseSide,
} from "../settlement/settlement-side-access";
import { publishStoreBoard } from "../store/store-board-signal";
import { StoreVaultGuard } from "../store/store-vault-guard";
import { AccountNames } from "./account-names";
import { AccountsAccess, type AccountsGrant } from "./accounts-access";
import { ACCOUNTS_AUDIT } from "./accounts-audit";
import {
  ACCOUNTS_REASONS,
  FieldErrors,
  isDuplicateKeyError,
  notFoundError,
  validationError,
} from "./accounts-error";
import { firstOf, parseId, trimmed } from "./accounts-util";
import type {
  LotteryBankTransactionsInput,
  RecordLotteryBankTransactionInput,
} from "./dto/lottery-bank-account.input";
import type {
  LotteryAccountsRefModel,
  LotteryBankTransactionModel,
  LotteryBankTransactionsPayload,
} from "./models/lottery-bank-account.model";

type AccountRecord = Persisted<LotteryBankAccountDocument>;
export type BankTransactionRecord = Persisted<LotteryBankTransactionDocument>;

/** 寫一筆銀行交易的內容(登記交易與收付機制共用)。 */
export interface BankTransactionWrite {
  account: AccountRecord;
  type: BankTransactionType;
  direction: Direction;
  amount: number;
  occurredAt: Date;
  branchOrgId: Types.ObjectId | null;
  refType?: string | null;
  refId?: Types.ObjectId | null;
  refRevision?: number | null;
  settlementSide?: string | null;
  summary?: string | null;
  handler?: string | null;
  note?: string | null;
}

/**
 * 銀行交易(專案規格 10.1;正本 `docs/modules/project/accounts.md`「銀行交易」):只新增。
 *
 * - **讀**:先確認帳戶看得到(可見範圍 + 使用組織),再以租戶邊界讀它的交易(登記在
 *   `TENANT_BOUNDARY_CONTEXT_CALLERS`:看得到帳戶就看得到它的交易,交易可能是別家分店登記的)
 * - **登記交易**:`record-bank-transaction`;帳戶要使用中;進貨 / 調貨歸屬分店必填;進貨收入 / 調貨收入
 *   單據必填、只收有待退或待收的單據(那一邊的 [收到退款] / [收款] 預設 > 0)
 * - **提領的現金去向**(`vaultOrgId`,選填):選了分店小金庫 → 同一個交易另寫現金流水「銀行提領」(銀行 → 小金庫,
 *   `bankTransactionId` 連起來),歸屬分店 = 那家店;分店要在帳戶的使用組織裡。沒選 = 從帳戶提領現金,只扣銀行
 * - **沖正**:寫一筆方向相反、同金額的交易,原交易不改;連結的現金流水(存銀行、銀行提領)自動反向。
 *   沖正「銀行提領」= 從小金庫扣回,不能超過小金庫應有(`StoreVaultGuard`,同出庫、存銀行)
 */
@Injectable()
export class BankTransactionsService {
  constructor(
    private readonly accounts: LotteryBankAccountsRepository,
    private readonly transactions: LotteryBankTransactionsRepository,
    private readonly movements: LotteryCashMovementsRepository,
    private readonly cashLedger: CashLedgerService,
    private readonly ledger: SettlementLedger,
    private readonly settlementMarks: SettlementMarks,
    private readonly orgs: OrgsRepository,
    private readonly names: AccountNames,
    private readonly access: AccountsAccess,
    private readonly audit: AuditService,
    private readonly tx: TransactionService,
    private readonly realtime: RealtimePublisher,
    private readonly vault: StoreVaultGuard,
  ) {}

  // ---- 讀 ----

  async list(
    operator: OperatorContext,
    input: LotteryBankTransactionsInput,
  ): Promise<LotteryBankTransactionsPayload> {
    const grant = await this.access.assert(
      operator,
      ACCOUNTS_PERMISSIONS.viewBankAccounts,
    );
    const account = await this.mustFindAccount(operator, input.accountId);
    const reader = await this.readerOf(operator, account);
    const range = {
      ...(input.from == null ? {} : { $gte: input.from }),
      ...(input.to == null ? {} : { $lt: input.to }),
    };
    const before =
      input.from == null
        ? 0
        : await this.signedSum(reader, account._id, {
            $lt: input.from,
          });
    const rows = await this.transactions.findMany(
      reader,
      {
        accountId: account._id,
        ...(Object.keys(range).length === 0 ? {} : { occurredAt: range }),
      },
      { sort: { occurredAt: 1, createdAt: 1, _id: 1 } },
    );
    let balance = account.openingBalance + before;
    let totalIn = 0;
    let totalOut = 0;
    const withBalance = rows.map((row) => {
      balance += signedAmount(row.direction, row.amount);
      if (row.direction === "in") {
        totalIn += row.amount;
      } else {
        totalOut += row.amount;
      }
      return { row, balanceAfter: balance };
    });
    const shown = withBalance
      .filter(({ row }) => !input.type || row.type === input.type)
      .toReversed();
    const reversedBy = await this.reversalsOf(
      reader,
      shown.map(({ row }) => row._id),
    );
    const items = await this.toModels(
      operator,
      account.tenantId,
      shown,
      reversedBy,
      grant,
    );
    return { items, totalCount: items.length, totalIn, totalOut };
  }

  /**
   * 帳戶的交易淨額(收 − 支)與筆數,呼叫端加上期初就是餘額;一批帳戶一次算。
   * `before` 給了 = 那個時點(不含)以前的交易(關帳快照的月底餘額)。
   */
  async balancesOf(
    operator: OperatorContext,
    accounts: readonly Pick<AccountRecord, "_id" | "tenantId">[],
    before?: Date,
  ): Promise<Map<string, { sum: number; count: number }>> {
    const result = new Map<string, { sum: number; count: number }>();
    if (accounts.length === 0) {
      return result;
    }
    const reader = await tenantBoundaryContext(
      this.orgs,
      operator,
      accounts[0]?.tenantId ?? null,
    );
    const rows = await this.transactions.aggregate(reader, [
      {
        $match: {
          accountId: { $in: accounts.map((item) => item._id) },
          // 給了 `before` = 那個時點(不含)以前的交易(關帳快照的月底餘額)
          ...(before === undefined ? {} : { occurredAt: { $lt: before } }),
        },
      },
      {
        $group: {
          _id: "$accountId",
          sum: {
            $sum: {
              $cond: [
                { $eq: ["$direction", "in"] },
                "$amount",
                { $multiply: ["$amount", -1] },
              ],
            },
          },
          count: { $sum: 1 },
        },
      },
    ]);
    for (const row of rows as { _id: unknown; sum: number; count: number }[]) {
      result.set(String(row._id), { sum: row.sum, count: row.count });
    }
    return result;
  }

  // ---- 寫 ----

  async record(
    operator: OperatorContext,
    input: RecordLotteryBankTransactionInput,
  ): Promise<LotteryBankTransactionModel> {
    const grant = await this.access.assert(
      operator,
      ACCOUNTS_PERMISSIONS.recordBankTransaction,
    );
    const account = await this.mustFindAccount(operator, input.accountId);
    assertActive(account);
    const parsed = parseRecordInput(input);
    const linked = await this.linkedDocumentOf(operator, parsed);
    const vaultOrgId =
      parsed.vaultOrgId === null
        ? null
        : await this.mustVaultStore(operator, account, parsed.vaultOrgId);
    if (
      vaultOrgId !== null &&
      parsed.branchOrgId !== null &&
      !parsed.branchOrgId.equals(vaultOrgId)
    ) {
      // 現金去向的分店就是歸屬分店,兩個不一樣 = 填錯
      throw validationError("branch must be the vault's store", [
        "branchOrgId",
      ]);
    }
    const branchOrgId = vaultOrgId ?? parsed.branchOrgId ?? linked.branchOrgId;
    if (requiresBranch(parsed.type) && branchOrgId === null) {
      throw validationError("branch is required", ["branchOrgId"]);
    }
    const created = await this.tx.withTransaction(async (session) => {
      const row = await this.write(operator, {
        account,
        type: parsed.type,
        direction: parsed.direction,
        amount: input.amount,
        occurredAt: input.occurredAt,
        branchOrgId,
        refType: parsed.ref?.moduleKey ?? null,
        refId: parsed.ref?.refId ?? null,
        refRevision: linked.revision,
        settlementSide: linked.side,
        summary: parsed.summary,
        note: parsed.note,
      });
      const movementId =
        vaultOrgId === null
          ? null
          : await this.recordVaultInflow(session, operator, row, vaultOrgId);
      await this.audit.record(operator, {
        action: ACCOUNTS_AUDIT.transactionCreate,
        targetType: ACCOUNTS_AUDIT.transactionTarget,
        targetId: row._id,
        after: {
          ...auditOf(row),
          ...(movementId === null ? {} : { cashMovementId: movementId }),
        },
      });
      return row;
    });
    if (linked.side !== null) {
      await this.publishBadge(operator, account.tenantId);
    }
    if (vaultOrgId !== null) {
      await publishStoreBoard(this.realtime, account.tenantId, vaultOrgId);
    }
    return firstOf(
      await this.toModels(
        operator,
        account.tenantId,
        [{ row: created, balanceAfter: 0 }],
        new Map(),
        grant,
      ),
    );
  }

  /**
   * 選了單據:進貨收入 / 調貨收入記在有待退或待收的那一邊(`settlementSide`,算進單據淨額);
   * 兌獎入帳只記單據與修訂號(不算進淨額)。
   */
  private async linkedDocumentOf(
    operator: OperatorContext,
    parsed: ParsedRecordInput,
  ): Promise<{
    side: string | null;
    revision: number | null;
    branchOrgId: Types.ObjectId | null;
  }> {
    if (parsed.ref === null) {
      return { side: null, revision: null, branchOrgId: null };
    }
    if (documentRequirementOf(parsed.type) !== "required") {
      return {
        side: null,
        revision: await this.ledger.revisionOf(
          operator,
          parsed.ref.moduleKey,
          parsed.ref.refId,
        ),
        branchOrgId: null,
      };
    }
    const entry = await this.ledger.inboundEntryOf(operator, {
      ...parsed.ref,
      type: parsed.type,
    });
    return {
      side: entry.side,
      revision: entry.revision,
      branchOrgId: entry.branchOrgId,
    };
  }

  /**
   * 沖正(`accounts.reverse-bank-transaction`):帳戶要看得到;原因必填。
   * 掛在單據上的收付(`refType` / `settlementSide` 有值)還要那一邊的收付權限、看得到那一邊
   * (與單據結算區的 [沖正] 同一判準,`settlement-side-access.ts`)。
   */
  async reverse(
    operator: OperatorContext,
    input: { id: string; reason: string },
  ): Promise<LotteryBankTransactionModel> {
    const grant = await this.access.assert(
      operator,
      ACCOUNTS_PERMISSIONS.reverseBankTransaction,
    );
    const original = await this.mustFindTransaction(operator, input.id);
    if (
      original.refType !== null &&
      original.refId !== null &&
      original.settlementSide !== null
    ) {
      await assertSideReversible(operator, this.ledger, grant, {
        id: input.id,
        refType: original.refType,
        refId: original.refId,
        settlementSide: original.settlementSide,
      });
    }
    const reason = trimmed(input.reason);
    if (reason === null || reason.length > LIMITS.summary) {
      throw validationError("reason is required", ["reason"]);
    }
    const account = await this.mustFindAccount(
      operator,
      String(original.accountId),
    );
    // 沖正「銀行提領」= 從小金庫扣回:不能超過小金庫應有(與出庫、存銀行同一個守門文件;規格 9)
    const vaultOut = await this.linkedVaultInflowOf(operator, original);
    if (vaultOut !== null) {
      await this.vault.prepare(vaultOut.reader, vaultOut.orgId);
    }
    const reversal = await this.tx.withTransaction(async (session) => {
      if (vaultOut !== null) {
        await this.vault.assertCovers(
          session,
          vaultOut.reader,
          original.tenantId,
          vaultOut.orgId,
          vaultOut.amount,
          "id",
        );
      }
      return this.reverseRecord(operator, original, reason);
    });
    if (original.settlementSide !== null) {
      await this.publishBadge(operator, account.tenantId);
    }
    if (vaultOut !== null) {
      await publishStoreBoard(this.realtime, original.tenantId, vaultOut.orgId);
    }
    return firstOf(
      await this.toModels(
        operator,
        account.tenantId,
        [{ row: reversal, balanceAfter: 0 }],
        new Map(),
        false,
      ),
    );
  }

  /**
   * 交易內寫一筆(登記交易與收付共用;呼叫端已檢查權限與欄位)。帳戶要使用中;
   * `allowInactiveAccount` = **已送出單據的系統寫入**(例:日結核准完成時寫存入):帳戶在送出時已驗過,之後被停用
   * 只是不能再被選用,不影響已送出的單(使用者 10/10 進貨單定案)。人工登記與收付一律不給。
   */
  async write(
    operator: OperatorContext,
    data: BankTransactionWrite,
    options: {
      session?: ClientSession | null;
      allowInactiveAccount?: boolean;
    } = {},
  ): Promise<BankTransactionRecord> {
    const { allowInactiveAccount = false, ...createOptions } = options;
    if (!allowInactiveAccount) {
      assertActive(data.account);
    }
    const row = await this.transactions.create(
      operator,
      {
        accountId: data.account._id,
        occurredAt: data.occurredAt,
        type: data.type,
        direction: data.direction,
        amount: data.amount,
        branchOrgId: data.branchOrgId,
        refType: data.refType ?? null,
        refId: data.refId ?? null,
        refRevision: data.refRevision ?? null,
        settlementSide: data.settlementSide ?? null,
        reversalOf: null,
        summary: data.summary ?? null,
        handler: data.handler ?? null,
        note: data.note ?? null,
      },
      createOptions,
    );
    await this.touchSettlement(row, createOptions.session);
    return row;
  }

  /** 掛在單據某一邊的收付(含沖正):單據的結清標記改回待確認(待結清只掃還沒結清的)。 */
  private async touchSettlement(
    row: BankTransactionRecord,
    session?: ClientSession | null,
  ): Promise<void> {
    if (row.refId !== null && row.settlementSide !== null) {
      await this.settlementMarks.touch(row.tenantId, row.refId, session);
    }
  }

  /**
   * 交易內沖正一筆(呼叫端已檢查權限;沖正「銀行提領」的小金庫檢查也由呼叫端做):寫一筆同類型、方向相反、
   * 同金額的交易,原交易不改;連結的現金流水(存入 → 「存銀行」、提領 → 「銀行提領」)自動寫一筆反向。
   * 已被沖正 / 本身是沖正 → `ALREADY_REVERSED`。
   */
  async reverseRecord(
    operator: OperatorContext,
    original: BankTransactionRecord,
    reason: string,
  ): Promise<BankTransactionRecord> {
    if (original.reversalOf !== null) {
      throw alreadyReversed();
    }
    const reader = await tenantBoundaryContext(
      this.orgs,
      operator,
      original.tenantId,
    );
    if (await this.transactions.findOne(reader, { reversalOf: original._id })) {
      throw alreadyReversed();
    }
    let reversal: BankTransactionRecord;
    try {
      reversal = await this.transactions.create(operator, {
        accountId: original.accountId,
        occurredAt: new Date(),
        type: original.type,
        direction: oppositeDirection(original.direction),
        amount: original.amount,
        branchOrgId: original.branchOrgId,
        refType: original.refType,
        refId: original.refId,
        refRevision: original.refRevision,
        settlementSide: original.settlementSide,
        reversalOf: original._id,
        summary: original.summary,
        handler: original.handler,
        note: reason,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw alreadyReversed();
      }
      throw error;
    }
    await this.touchSettlement(reversal);
    // 連結的流水(存銀行、銀行提領)在分店;沖正的人不一定看得到那家分店的現金(例外寫入,租戶邊界)
    const linked = await this.movements.findMany(reader, {
      bankTransactionId: original._id,
      reversalOf: null,
    });
    for (const movement of linked) {
      // 沿用呼叫端進行中的交易(與這筆沖正一起成功、一起回復)
      await this.cashLedger.reverseCashMovement(undefined, movement._id, {
        operator: reader,
        note: reason,
      });
    }
    await this.audit.record(operator, {
      action: ACCOUNTS_AUDIT.transactionReverse,
      targetType: ACCOUNTS_AUDIT.transactionTarget,
      targetId: reversal._id,
      before: { reversalOf: String(original._id) },
      after: auditOf(reversal),
    });
    return reversal;
  }

  /**
   * 提領的「現金去向」可選的分店(規格 10.1):帳戶的使用組織包含的分店(最上層組織底下的組織;共用給含下層時
   * 含它底下的組織),依名稱排序。以租戶邊界讀(分店不一定在操作者的可見範圍內,和沖正連結流水同理)。
   */
  async vaultStoresOf(
    operator: OperatorContext,
    accountId: string,
  ): Promise<LotteryAccountsRefModel[]> {
    await this.access.assert(
      operator,
      ACCOUNTS_PERMISSIONS.recordBankTransaction,
    );
    const account = await this.mustFindAccount(operator, accountId);
    const stores = await this.vaultStoreRows(operator, account);
    return stores.map((org) => ({ id: String(org._id), name: org.name }));
  }

  // ---- 內部 ----

  private async vaultStoreRows(
    operator: OperatorContext,
    account: AccountRecord,
  ): Promise<{ _id: Types.ObjectId; name: string }[]> {
    if (account.tenantId === null) {
      return [];
    }
    const reader = await tenantBoundaryContext(
      this.orgs,
      operator,
      account.tenantId,
    );
    const orgs = await this.orgs.findMany(
      reader,
      { ancestors: account.tenantId },
      { sort: { name: 1, _id: 1 } },
    );
    return orgs.filter((org) => isUsableByAccount(account, org));
  }

  /** 現金去向的分店要在帳戶的使用組織裡;不在 → `VALIDATION_FAILED`(欄位 `vaultOrgId`)。 */
  private async mustVaultStore(
    operator: OperatorContext,
    account: AccountRecord,
    orgId: Types.ObjectId,
  ): Promise<Types.ObjectId> {
    const stores = await this.vaultStoreRows(operator, account);
    if (!stores.some((org) => org._id.equals(orgId))) {
      throw validationError(
        "vault store is not using this account",
        ["vaultOrgId"],
        ACCOUNTS_REASONS.accountNotUsable,
      );
    }
    return orgId;
  }

  /** 交易內寫「銀行提領」流水(銀行 → 那家店的小金庫),連到剛寫的銀行「提領」;回傳流水 id。 */
  private async recordVaultInflow(
    session: ClientSession,
    operator: OperatorContext,
    row: BankTransactionRecord,
    orgId: Types.ObjectId,
  ): Promise<string> {
    // 分店不一定在操作者的可見範圍內(例外寫入,租戶邊界;同沖正連結流水)
    const reader = await tenantBoundaryContext(
      this.orgs,
      operator,
      row.tenantId,
    );
    const movement = await this.cashLedger.recordCashMovement(session, {
      operator: reader,
      orgId,
      type: "bank_withdraw",
      from: "bank",
      to: "vault",
      amount: row.amount,
      occurredAt: row.occurredAt,
      note: row.note ?? row.summary ?? null,
      bankTransactionId: row._id,
    });
    return String(movement._id);
  }

  /** 這筆銀行交易連結的「錢進小金庫」流水(銀行提領,還沒被沖正);沒有 → null。 */
  private async linkedVaultInflowOf(
    operator: OperatorContext,
    original: BankTransactionRecord,
  ): Promise<{
    reader: OperatorContext;
    orgId: Types.ObjectId;
    amount: number;
  } | null> {
    if (original.reversalOf !== null) {
      return null;
    }
    const reader = await tenantBoundaryContext(
      this.orgs,
      operator,
      original.tenantId,
    );
    const movement = await this.movements.findOne(reader, {
      bankTransactionId: original._id,
      reversalOf: null,
      to: "vault",
    });
    return movement === null
      ? null
      : { reader, orgId: movement.orgId, amount: movement.amount };
  }

  /** 看得到的帳戶(可見範圍 + 使用組織);看不到 → `NOT_FOUND`。 */
  async mustFindAccount(
    operator: OperatorContext,
    id: string,
  ): Promise<AccountRecord> {
    const accountId = parseId(id);
    const found =
      accountId === null
        ? null
        : await this.accounts.findById(operator, accountId);
    if (!found) {
      throw notFoundError(`bank account not found: ${id}`);
    }
    return found;
  }

  /** 交易:先以租戶邊界讀,再確認它的帳戶看得到;看不到 → `NOT_FOUND`。 */
  async mustFindTransaction(
    operator: OperatorContext,
    id: string,
  ): Promise<BankTransactionRecord> {
    const transactionId = parseId(id);
    const { tenantId } = await this.access.grantOf(operator);
    if (transactionId === null || (tenantId === null && !isRoot(operator))) {
      throw notFoundError(`bank transaction not found: ${id}`);
    }
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const found = await this.transactions.findById(reader, transactionId);
    if (!found || !(await this.accounts.findById(operator, found.accountId))) {
      throw notFoundError(`bank transaction not found: ${id}`);
    }
    return found;
  }

  private readerOf(
    operator: OperatorContext,
    account: AccountRecord,
  ): Promise<OperatorContext> {
    return tenantBoundaryContext(this.orgs, operator, account.tenantId);
  }

  private async signedSum(
    reader: OperatorContext,
    accountId: Types.ObjectId,
    occurredAt: Record<string, Date>,
  ): Promise<number> {
    const rows = await this.transactions.aggregate(reader, [
      { $match: { accountId, occurredAt } },
      {
        $group: {
          _id: null,
          sum: {
            $sum: {
              $cond: [
                { $eq: ["$direction", "in"] },
                "$amount",
                { $multiply: ["$amount", -1] },
              ],
            },
          },
        },
      },
    ]);
    return (rows[0] as { sum?: number } | undefined)?.sum ?? 0;
  }

  /** 沖正的原交易 id → 原交易的發生時間(看得到帳戶就看得到它的交易:以租戶邊界讀)。 */
  private async originalsOf(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    ids: readonly Types.ObjectId[],
  ): Promise<Map<string, Date>> {
    if (ids.length === 0) {
      return new Map();
    }
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const rows = await this.transactions.findMany(
      reader,
      { _id: { $in: [...ids] } },
      { select: "occurredAt" },
    );
    return new Map(rows.map((row) => [String(row._id), row.occurredAt]));
  }

  /** 原交易 id → 沖正它的那一筆 id。 */
  private async reversalsOf(
    reader: OperatorContext,
    ids: readonly Types.ObjectId[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await this.transactions.findMany(reader, {
      reversalOf: { $in: [...ids] },
    });
    return new Map(
      rows.map((row) => [String(row.reversalOf), String(row._id)]),
    );
  }

  private async toModels(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    rows: readonly { row: BankTransactionRecord; balanceAfter: number }[],
    reversedBy: ReadonlyMap<string, string>,
    /** 沖正按鈕的判準來源:傳 `false` = 一律不能(例:`reverse` 回傳剛寫入的那筆沖正) */
    grant: AccountsGrant | false,
  ): Promise<LotteryBankTransactionModel[]> {
    const canReverseAny =
      grant !== false && grant.has(ACCOUNTS_PERMISSIONS.reverseBankTransaction);
    const originalIds = rows.flatMap(({ row }) =>
      row.reversalOf === null ? [] : [row.reversalOf],
    );
    const [orgNames, userNames, originals] = await Promise.all([
      this.names.orgNames(
        operator,
        tenantId,
        rows.map(({ row }) => row.branchOrgId),
      ),
      this.names.userNames(
        operator,
        tenantId,
        rows.map(({ row }) => row.createdBy),
      ),
      this.originalsOf(operator, tenantId, originalIds),
    ]);
    return rows.map(({ row, balanceAfter }) => {
      const branchKey =
        row.branchOrgId === null ? null : String(row.branchOrgId);
      const creatorKey = row.createdBy == null ? null : String(row.createdBy);
      const reversed = reversedBy.get(String(row._id)) ?? null;
      return {
        id: String(row._id),
        accountId: String(row.accountId),
        occurredAt: row.occurredAt,
        type: row.type,
        direction: row.direction,
        amount: row.amount,
        balanceAfter,
        branch:
          branchKey === null
            ? null
            : { id: branchKey, name: orgNames.get(branchKey) ?? "" },
        refType: row.refType,
        refId: row.refId === null ? null : String(row.refId),
        settlementSide: row.settlementSide,
        summary: row.summary,
        handler: row.handler,
        note: row.note,
        reversalOf: row.reversalOf === null ? null : String(row.reversalOf),
        reversedById: reversed,
        reversalOfAt:
          row.reversalOf === null
            ? null
            : (originals.get(String(row.reversalOf)) ?? null),
        createdBy:
          creatorKey === null
            ? null
            : { id: creatorKey, name: userNames.get(creatorKey) ?? "" },
        createdAt: row.createdAt,
        abilities: {
          canReverse:
            canReverseAny &&
            reversed === null &&
            row.reversalOf === null &&
            canReverseSide(grant, row),
        },
      };
    });
  }

  private async publishBadge(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
  ): Promise<void> {
    if (operator.actorId === null) {
      return;
    }
    await this.realtime.publishBadge(tenantId, "accounts", [operator.actorId]);
  }
}

function isRoot(operator: OperatorContext): boolean {
  return operator.visibleOrgIds === "all";
}

function assertActive(account: AccountRecord): void {
  if (account.status !== "active") {
    throw validationError(
      "bank account is inactive",
      ["accountId"],
      ACCOUNTS_REASONS.accountInactive,
    );
  }
}

function alreadyReversed() {
  return validationError(
    "bank transaction already reversed",
    ["id"],
    ACCOUNTS_REASONS.alreadyReversed,
  );
}

function auditOf(row: BankTransactionRecord): Record<string, unknown> {
  return {
    accountId: String(row.accountId),
    type: row.type,
    direction: row.direction,
    amount: row.amount,
    occurredAt: row.occurredAt,
    branchOrgId: row.branchOrgId === null ? null : String(row.branchOrgId),
    refType: row.refType,
    refId: row.refId === null ? null : String(row.refId),
    settlementSide: row.settlementSide,
    summary: row.summary,
    note: row.note,
  };
}

/** 登記交易的輸入(檢查過)。 */
interface ParsedRecordInput {
  type: BankTransactionType;
  direction: Direction;
  branchOrgId: Types.ObjectId | null;
  /** 提領的現金去向(分店小金庫);只有提領能給 */
  vaultOrgId: Types.ObjectId | null;
  summary: string | null;
  note: string | null;
  ref: { moduleKey: string; refId: Types.ObjectId } | null;
}

function isTransactionType(value: string): value is BankTransactionType {
  return (BANK_TRANSACTION_TYPES as readonly string[]).includes(value);
}

function isDirection(value: string | null | undefined): value is Direction {
  return (DIRECTIONS as readonly (string | null | undefined)[]).includes(value);
}

/** 類型與方向(調整 / 其他才看輸入的方向)。 */
function typeAndDirectionOf(
  input: RecordLotteryBankTransactionInput,
  errors: FieldErrors,
): { type: BankTransactionType; direction: Direction } | null {
  if (!isTransactionType(input.type)) {
    errors.add("type");
    return null;
  }
  const direction =
    fixedDirectionOf(input.type) ??
    (isDirection(input.direction) ? input.direction : null);
  if (direction === null) {
    errors.add("direction");
    return null;
  }
  return { type: input.type, direction };
}

/** 說明(調整、其他必填)與備註的長度。 */
function textsOf(
  input: RecordLotteryBankTransactionInput,
  errors: FieldErrors,
): { summary: string | null; note: string | null } {
  const summary = trimmed(input.summary);
  const required = isTransactionType(input.type) && requiresSummary(input.type);
  if (
    (required && summary === null) ||
    (summary?.length ?? 0) > LIMITS.summary
  ) {
    errors.add("summary");
  }
  const note = trimmed(input.note);
  if ((note?.length ?? 0) > LIMITS.note) {
    errors.add("note");
  }
  return { summary, note };
}

/** 欄位檢查:一次回所有錯的欄位。 */
function parseRecordInput(
  input: RecordLotteryBankTransactionInput,
): ParsedRecordInput {
  const errors = new FieldErrors();
  const typed = typeAndDirectionOf(input, errors);
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    errors.add("amount");
  }
  const { summary, note } = textsOf(input, errors);
  const branchOrgId = parseId(input.branchOrgId);
  if (input.branchOrgId != null && branchOrgId === null) {
    errors.add("branchOrgId");
  }
  const vaultOrgId = parseId(input.vaultOrgId);
  if (
    input.vaultOrgId != null &&
    (vaultOrgId === null ||
      (typed !== null && typed.type !== BANK_TRANSACTION_TYPE.withdrawal))
  ) {
    errors.add("vaultOrgId");
  }
  const refId = parseId(input.refId);
  const ref =
    input.refType == null || refId === null
      ? null
      : { moduleKey: input.refType, refId };
  // 進貨收入 / 調貨收入:單據必填
  if (
    typed !== null &&
    documentRequirementOf(typed.type) === "required" &&
    ref === null
  ) {
    errors.add("refId");
  }
  errors.throwIfAny("bank transaction input is invalid");
  if (typed === null) {
    throw validationError("bank transaction input is invalid", ["type"]);
  }
  return { ...typed, branchOrgId, vaultOrgId, summary, note, ref };
}

/** 帳戶的使用組織包含這個組織(歸屬組織本身、共用給的組織,或共用給含下層時它底下的組織)。 */
function isUsableByAccount(
  account: AccountRecord,
  org: { _id: Types.ObjectId; ancestors?: readonly Types.ObjectId[] | null },
): boolean {
  const chain = [org._id, ...(org.ancestors ?? [])];
  return (
    account.orgId.equals(org._id) ||
    account.shareOrgs.some(
      (entry) =>
        entry.orgId.equals(org._id) ||
        (entry.includeDescendants &&
          chain.some((id) => id.equals(entry.orgId))),
    )
  );
}
