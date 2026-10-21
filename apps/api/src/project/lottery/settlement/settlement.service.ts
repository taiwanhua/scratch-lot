import { Injectable } from "@nestjs/common";
import { type ClientSession, Types } from "mongoose";

import {
  ACCOUNTS_KEY,
  ACCOUNTS_PERMISSIONS,
  DIRECTIONS,
  type Direction,
  SETTLEMENT_METHODS,
  type SettlementMethod,
  documentRequirementOf,
  pendingPayeeAmount,
} from "@repo/domain/project/lottery-accounts";

import { AuditService } from "../../../audit/audit.service";
import { authError } from "../../../auth/auth-error";
import { OrgsRepository } from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import {
  TransactionService,
  currentSession,
} from "../../../database/transaction";
import { RealtimePublisher } from "../../../realtime/realtime-publisher.service";
import {
  LotteryBankAccountsRepository,
  LotteryBankTransactionsRepository,
  LotteryCashMovementsRepository,
} from "../../database/lottery-accounts/lottery-accounts.repositories";
import { AccountNames } from "../accounts/account-names";
import { AccountsAccess } from "../accounts/accounts-access";
import { ACCOUNTS_AUDIT } from "../accounts/accounts-audit";
import {
  ACCOUNTS_REASONS,
  FieldErrors,
  notFoundError,
  validationError,
} from "../accounts/accounts-error";
import { parseId, trimmed } from "../accounts/accounts-util";
import {
  type BankTransactionRecord,
  BankTransactionsService,
} from "../accounts/bank-transactions.service";
import {
  CashLedgerOutsideTransactionError,
  CashLedgerService,
} from "../cash/cash-ledger.service";
import { openDrawersOf, openShiftOf } from "../cash/open-shift";
import type {
  LotterySettlementCandidatesInput,
  RecordLotterySettlementInput,
  ReverseLotterySettlementInput,
} from "./dto/lottery-settlement.input";
import type {
  LotteryOutstandingSettlementModel,
  LotterySettlementModel,
  LotterySettlementRecordModel,
  RecordLotterySettlementPayload,
} from "./models/lottery-settlement.model";
import {
  type OutstandingRow,
  SettlementLedger,
  type SettlementSnapshot,
  bankTypeOf,
} from "./settlement-ledger";
import {
  type SettlementSideRegistration,
  type SettlementSubmission,
  settlementDocumentOf,
  sideOf,
} from "./settlement-registry";

const DAY_MS = 86_400_000;

/**
 * 兩邊店都看得到的單據(`sharedByValues`,調貨單):只能操作自己看得到的那一邊(這一邊的分店在可見範圍內);
 * 其他單據不另外檢查。
 */
function assertSideVisible(
  operator: OperatorContext,
  snapshot: SettlementSnapshot,
  side: SettlementSideRegistration,
): void {
  const sideBranch =
    side.branchOf?.(snapshot.submission, snapshot.payable) ??
    snapshot.payable.branchOrgId;
  if (
    snapshot.registration.sharedByValues !== undefined &&
    !isOrgVisible(operator, sideBranch)
  ) {
    throw authError("FORBIDDEN", `Side ${side.side} is not visible`);
  }
}

/**
 * 收付機制(專案規格第 9 章;正本 `docs/modules/project/accounts.md`「收付機制」)。
 *
 * - `recordSettlement`:付款 / 收款視窗的 [確認],寫一筆銀行交易或現金流水(`refType / refId /
 *   refRevision` 指回單據、`settlementSide` 記哪一邊);帳一律以實際填的金額為準
 * - `reverseSettlement`:人工登記的帳人工沖正(方向相反的一筆,原交易不改)
 * - `outstandingSettlements`:待結清款項(進貨與調貨同一頁,依可見範圍;側欄數字同一份)
 * - 作廢 / 駁回前的檢查見 `settlement-guard.ts`
 */
@Injectable()
export class SettlementService {
  constructor(
    private readonly ledger: SettlementLedger,
    private readonly bankTransactions: BankTransactionsService,
    private readonly cashLedger: CashLedgerService,
    private readonly accounts: LotteryBankAccountsRepository,
    private readonly bank: LotteryBankTransactionsRepository,
    private readonly cash: LotteryCashMovementsRepository,
    private readonly orgs: OrgsRepository,
    private readonly names: AccountNames,
    private readonly access: AccountsAccess,
    private readonly audit: AuditService,
    private readonly tx: TransactionService,
    private readonly realtime: RealtimePublisher,
  ) {}

  // ---- 讀 ----

  /** `SettlementPanel` 的資料(看得到單據就看得到它的收付)。 */
  async settlement(
    operator: OperatorContext,
    moduleKey: string,
    refId: string,
  ): Promise<LotterySettlementModel> {
    const snapshot = await this.ledger.snapshotOf(operator, moduleKey, refId);
    return this.toModel(operator, snapshot);
  }

  /** 待結清款項(`accounts.view-outstanding`)。 */
  async outstanding(
    operator: OperatorContext,
  ): Promise<LotteryOutstandingSettlementModel[]> {
    await this.access.assert(operator, ACCOUNTS_PERMISSIONS.viewOutstanding);
    return this.toRowModels(operator, await this.ledger.outstanding(operator));
  }

  /** 側欄「帳戶管理」的數字:看得到的待結清筆數;沒有 `view-outstanding` = 0。 */
  async outstandingCount(operator: OperatorContext): Promise<number> {
    const grant = await this.access.grantOf(operator);
    if (!grant.has(ACCOUNTS_PERMISSIONS.viewOutstanding)) {
      return 0;
    }
    const rows = await this.ledger.outstanding(operator);
    return rows.length;
  }

  /**
   * 銀行 [登記交易] 選「批貨收入 / 調貨收入」的單據候選:只列有待退或待收的(`record-bank-transaction`)。
   */
  async candidates(
    operator: OperatorContext,
    input: LotterySettlementCandidatesInput,
  ): Promise<LotteryOutstandingSettlementModel[]> {
    await this.access.assert(
      operator,
      ACCOUNTS_PERMISSIONS.recordBankTransaction,
    );
    const type = input.type as Parameters<typeof documentRequirementOf>[0];
    if (documentRequirementOf(type) !== "required") {
      return [];
    }
    const branch = parseId(input.branchOrgId);
    const outstanding = await this.ledger.outstanding(operator);
    const rows = outstanding.filter(
      (row) =>
        row.button === "in" &&
        bankTypeOf(row.snapshot.registration.kind, "in") === type &&
        (branch === null || row.branchOrgId.equals(branch)),
    );
    return this.toRowModels(operator, rows);
  }

  /**
   * 付款視窗「帳戶」的選項:操作者看得到、使用中、使用組織包含這一邊的分店(規格 9)。
   * 要看得到單據、且有那一邊的權限(`side.permission`,沒有 → `FORBIDDEN`)。
   */
  async accountOptions(
    operator: OperatorContext,
    moduleKey: string,
    refId: string,
    sideKey: string,
  ): Promise<{ id: string; label: string }[]> {
    const snapshot = await this.ledger.snapshotOf(operator, moduleKey, refId);
    const side = sideOf(snapshot.registration, sideKey);
    if (side === undefined) {
      return [];
    }
    const grant = await this.access.grantOf(operator);
    if (!grant.has(side.permission)) {
      throw authError("FORBIDDEN", `Missing permission ${side.permission}`);
    }
    assertSideVisible(operator, snapshot, side);
    const branchOrgId =
      side.branchOf?.(snapshot.submission, snapshot.payable) ??
      snapshot.payable.branchOrgId;
    const isUsable = await this.usableBy(
      operator,
      snapshot.submission.tenantId,
      branchOrgId,
    );
    const accounts = await this.accounts.findMany(
      operator,
      { status: "active" },
      { sort: { createdAt: 1, _id: 1 } },
    );
    return accounts
      .filter((account) => isUsable(account))
      .map((account) => ({ id: String(account._id), label: account.label }));
  }

  /**
   * 單據還沒送出前(新增頁、送出前檢查)用:這家分店能用的使用中帳戶(使用組織包含它),依操作者看得到的帳戶。
   * 權限由呼叫端判斷(例:進貨單新增頁看 `purchasing.purchase.create`)。
   */
  async usableAccountsOf(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    branchOrgId: Types.ObjectId,
  ): Promise<{ id: string; label: string }[]> {
    const isUsable = await this.usableBy(operator, tenantId, branchOrgId);
    const accounts = await this.accounts.findMany(
      operator,
      { status: "active" },
      { sort: { createdAt: 1, _id: 1 } },
    );
    return accounts
      .filter((account) => isUsable(account))
      .map((account) => ({ id: String(account._id), label: account.label }));
  }

  /**
   * 帳戶使用中、而且使用組織包含這家分店(以租戶為邊界讀;守門用)。給了 `viewer` 時另要求他看得到這個帳戶
   * (送出的人只能選自己看得到的帳戶)。找不到 → false。
   */
  async isAccountUsable(
    tenantId: Types.ObjectId | null,
    accountId: Types.ObjectId,
    branchOrgId: Types.ObjectId,
    viewer?: OperatorContext,
  ): Promise<boolean> {
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const account = await this.accounts.findById(reader, accountId);
    if (account?.status !== "active") {
      return false;
    }
    if (
      viewer !== undefined &&
      (await this.accounts.findById(viewer, accountId, { select: "_id" })) ===
        null
    ) {
      return false;
    }
    const isUsable = await this.usableBy(null, tenantId, branchOrgId);
    return isUsable(account);
  }

  // ---- 寫 ----

  async record(
    operator: OperatorContext,
    input: RecordLotterySettlementInput,
  ): Promise<RecordLotterySettlementPayload> {
    const snapshot = await this.ledger.snapshotOf(
      operator,
      input.moduleKey,
      input.refId,
    );
    const side = sideOf(snapshot.registration, input.side);
    if (side === undefined) {
      throw validationError(
        `unknown settlement side: ${input.side}`,
        ["side"],
        ACCOUNTS_REASONS.settlementUnknown,
      );
    }
    const grant = await this.access.grantOf(operator);
    if (!grant.has(side.permission)) {
      throw authError("FORBIDDEN", `Missing permission ${side.permission}`);
    }
    assertSideVisible(operator, snapshot, side);
    const errors = new FieldErrors();
    const button = (DIRECTIONS as readonly string[]).includes(input.button)
      ? (input.button as Direction)
      : null;
    if (button === null) {
      errors.add("button");
    }
    const method =
      (SETTLEMENT_METHODS as readonly string[]).includes(input.method) &&
      side.methods.includes(input.method as SettlementMethod)
        ? (input.method as SettlementMethod)
        : errors.add("method");
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      errors.add("amount");
    }
    const handler = trimmed(input.handler);
    if (method === "cash" && handler === null) {
      errors.add("handler");
    }
    errors.throwIfAny("settlement input is invalid");
    const chosen: Direction = button ?? "out";
    if (side.defaultAmount(chosen, snapshot.state) <= 0) {
      throw validationError(
        "nothing is due for this button",
        ["button"],
        ACCOUNTS_REASONS.settlementNothingDue,
      );
    }
    const branchOrgId =
      side.branchOf?.(snapshot.submission, snapshot.payable) ??
      snapshot.payable.branchOrgId;
    const note = trimmed(input.note);
    const ref = {
      refType: snapshot.registration.moduleKey,
      refId: snapshot.submission._id,
      refRevision: snapshot.submission.revision,
      settlementSide: side.side,
    };
    let recordId: Types.ObjectId;
    if (method === "bank") {
      const account = await this.usableAccount(
        operator,
        input.accountId,
        snapshot.submission.tenantId,
        branchOrgId,
      );
      const row = await this.tx.withTransaction(async () => {
        const created = await this.bankTransactions.write(operator, {
          account,
          type: bankTypeOf(snapshot.registration.kind, chosen),
          direction: chosen,
          amount: input.amount,
          occurredAt: new Date(),
          branchOrgId,
          ...ref,
          summary: `${snapshot.registration.label} ${snapshot.payable.docNo}`,
          handler,
          note,
        });
        await this.audit.record(operator, {
          action: ACCOUNTS_AUDIT.transactionCreate,
          targetType: ACCOUNTS_AUDIT.transactionTarget,
          targetId: created._id,
          after: { ...ref, amount: input.amount, direction: chosen },
        });
        return created;
      });
      recordId = row._id;
    } else {
      if (snapshot.registration.kind !== "transfer") {
        throw validationError("cash is not allowed", ["method"]);
      }
      const source = await this.cashSourceOf(
        input,
        snapshot.submission.tenantId,
        branchOrgId,
      );
      const row = await this.tx.withTransaction(async (session) => {
        const created = await this.cashLedger.recordCashMovement(session, {
          operator,
          orgId: branchOrgId,
          type: chosen === "out" ? "transfer_out" : "transfer_in",
          from: chosen === "out" ? source.place : "external",
          to: chosen === "out" ? "external" : source.place,
          amount: input.amount,
          cashPointId: source.cashPointId,
          shiftId: source.shiftId,
          ...ref,
          payee: handler,
          note,
        });
        await this.audit.record(operator, {
          action: ACCOUNTS_AUDIT.movementCreate,
          targetType: ACCOUNTS_AUDIT.movementTarget,
          targetId: created._id,
          after: { ...ref, amount: input.amount, direction: chosen },
        });
        return created;
      });
      recordId = row._id;
    }
    await this.publishBadge(operator, snapshot.submission.tenantId);
    return {
      recordId: String(recordId),
      item: await this.settlement(
        operator,
        snapshot.registration.moduleKey,
        String(snapshot.submission._id),
      ),
    };
  }

  /**
   * **交易內的自動記帳**(進貨單送出時記第一筆「批貨支出」這類):不檢查按鈕權限、不看先填的金額,
   * 沿用呼叫端的交易(不在交易內 → 拋錯)。**金額 0 照記**(進貨單應付 0 也要留一筆,規格 8.2 / 9 驗算 ⑤;
   * 人工登記仍要正數);負數或不是整數 → 不記(回 null)。
   * 帳戶要使用中、使用組織包含這一邊的分店;帳戶以單據的租戶為邊界讀(事後動作是系統身分,看不到共用進來的帳戶)。
   * 寫入者 = `operator`(事後動作給的系統身分,或按按鈕的人)。
   */
  async recordAutomatic(
    session: ClientSession | undefined,
    input: {
      operator: OperatorContext;
      moduleKey: string;
      submission: SettlementSubmission;
      side: string;
      button: Direction;
      accountId: Types.ObjectId;
      amount: number;
      handler?: string | null;
      note?: string | null;
    },
  ): Promise<Types.ObjectId | null> {
    const active = session ?? currentSession();
    if (active?.inTransaction() !== true) {
      throw new CashLedgerOutsideTransactionError();
    }
    if (!Number.isInteger(input.amount) || input.amount < 0) {
      return null;
    }
    const registration = settlementDocumentOf(input.moduleKey);
    const side =
      registration === undefined ? undefined : sideOf(registration, input.side);
    const payable =
      registration === undefined
        ? null
        : await registration.payable(input.submission);
    if (registration === undefined || side === undefined || payable === null) {
      throw validationError(
        `settlement is not registered: ${input.moduleKey}/${input.side}`,
        ["moduleKey"],
        ACCOUNTS_REASONS.settlementUnknown,
      );
    }
    const tenantId = input.submission.tenantId;
    const branchOrgId =
      side.branchOf?.(input.submission, payable) ?? payable.branchOrgId;
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const account = await this.accounts.findById(reader, input.accountId, {
      session: active,
    });
    if (account?.status !== "active") {
      throw validationError(
        "bank account is inactive",
        ["accountId"],
        ACCOUNTS_REASONS.accountInactive,
      );
    }
    const isUsable = await this.usableBy(null, tenantId, branchOrgId);
    if (!isUsable(account)) {
      throw validationError(
        "bank account is not used by this branch",
        ["accountId"],
        ACCOUNTS_REASONS.accountNotUsable,
      );
    }
    const created = await this.bankTransactions.write(
      input.operator,
      {
        account,
        type: bankTypeOf(registration.kind, input.button),
        direction: input.button,
        amount: input.amount,
        occurredAt: new Date(),
        branchOrgId,
        refType: registration.moduleKey,
        refId: input.submission._id,
        refRevision: input.submission.revision,
        settlementSide: side.side,
        summary: `${registration.label} ${payable.docNo}`,
        handler: input.handler ?? null,
        note: input.note ?? null,
      },
      { session: active },
    );
    return created._id;
  }

  async reverse(
    operator: OperatorContext,
    input: ReverseLotterySettlementInput,
  ): Promise<RecordLotterySettlementPayload> {
    const reason = trimmed(input.reason);
    if (reason === null) {
      throw validationError("reason is required", ["reason"]);
    }
    const original = await this.findReversible(operator, input);
    // 看得到單據才看得到它的收付;沖正要那一邊的權限
    const snapshot = await this.ledger.snapshotOf(
      operator,
      original.refType,
      original.refId,
    );
    const side = sideOf(snapshot.registration, original.settlementSide);
    if (side === undefined) {
      throw notFoundError(`settlement record not found: ${input.id}`);
    }
    const grant = await this.access.grantOf(operator);
    if (!grant.has(side.permission)) {
      throw authError("FORBIDDEN", `Missing permission ${side.permission}`);
    }
    assertSideVisible(operator, snapshot, side);
    await this.tx.withTransaction(async (session) => {
      if (original.method === "cash") {
        // 現金在這一邊的分店(已確認在操作者的可見範圍內):以操作者自己的上下文寫
        const created = await this.cashLedger.reverseCashMovement(
          session,
          original._id,
          { operator, note: reason },
        );
        await this.audit.record(operator, {
          action: ACCOUNTS_AUDIT.movementReverse,
          targetType: ACCOUNTS_AUDIT.movementTarget,
          targetId: created._id,
          before: { reversalOf: String(original._id) },
          after: { reason },
        });
      } else {
        await this.bankTransactions.reverseRecord(
          operator,
          original.bank,
          reason,
        );
      }
    });
    await this.publishBadge(operator, snapshot.submission.tenantId);
    return {
      recordId: String(original._id),
      item: await this.settlement(
        operator,
        snapshot.registration.moduleKey,
        String(snapshot.submission._id),
      ),
    };
  }

  /**
   * 要沖正的那一筆:收付的紀錄(有單據與那一邊)、**這一邊的記帳分店在操作者的可見範圍內**
   * (現金 = 流水的分店;銀行 = 歸屬分店,沒有時看登記的組織),銀行另要求看得到那個帳戶。
   * 不符合一律 `NOT_FOUND`(不透露別家店的紀錄存在與否)。
   */
  private async findReversible(
    operator: OperatorContext,
    input: ReverseLotterySettlementInput,
  ): Promise<
    {
      _id: Types.ObjectId;
      refType: string;
      refId: Types.ObjectId;
      settlementSide: string;
    } & ({ method: "cash" } | { method: "bank"; bank: BankTransactionRecord })
  > {
    const notFound = () =>
      notFoundError(`settlement record not found: ${input.id}`);
    const id = parseId(input.id);
    if (id === null) {
      throw notFound();
    }
    const { tenantId } = await this.access.grantOf(operator);
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    if (input.method === "cash") {
      // 流水照操作者的可見範圍讀:讀得到就表示那家分店在可見範圍內
      const row = await this.cash.findById(operator, id);
      if (!row?.refType || !row.refId || !row.settlementSide) {
        throw notFound();
      }
      return {
        _id: row._id,
        refType: row.refType,
        refId: row.refId,
        settlementSide: row.settlementSide,
        method: "cash",
      };
    }
    const row = await this.bank.findById(reader, id);
    if (
      !row?.refType ||
      !row.refId ||
      !row.settlementSide ||
      !isOrgVisible(operator, row.branchOrgId ?? row.orgId) ||
      (await this.accounts.findById(operator, row.accountId)) === null
    ) {
      throw notFound();
    }
    return {
      _id: row._id,
      refType: row.refType,
      refId: row.refId,
      settlementSide: row.settlementSide,
      method: "bank",
      bank: row,
    };
  }

  // ---- 內部 ----

  /** 銀行:帳戶看得到、使用中、使用組織包含這一邊的分店。 */
  private async usableAccount(
    operator: OperatorContext,
    accountIdText: string | null | undefined,
    tenantId: Types.ObjectId | null,
    branchOrgId: Types.ObjectId,
  ) {
    const accountId = parseId(accountIdText);
    if (accountId === null) {
      throw validationError("account is required", ["accountId"]);
    }
    const account = await this.accounts.findById(operator, accountId);
    if (!account) {
      throw validationError("account is required", ["accountId"]);
    }
    if (account.status !== "active") {
      throw validationError(
        "bank account is inactive",
        ["accountId"],
        ACCOUNTS_REASONS.accountInactive,
      );
    }
    const isUsable = await this.usableBy(operator, tenantId, branchOrgId);
    const usable = isUsable(account);
    if (!usable) {
      throw validationError(
        "bank account is not used by this branch",
        ["accountId"],
        ACCOUNTS_REASONS.accountNotUsable,
      );
    }
    return account;
  }

  /** 「帳戶的使用組織包含這家分店」的判斷(歸屬是它、共用給它、或共用給它的上層並含下層)。 */
  private async usableBy(
    operator: OperatorContext | null,
    tenantId: Types.ObjectId | null,
    branchOrgId: Types.ObjectId,
  ): Promise<
    (account: {
      orgId: Types.ObjectId;
      shareOrgs: readonly {
        orgId: Types.ObjectId;
        includeDescendants: boolean;
      }[];
    }) => boolean
  > {
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const branch = await this.orgs.findById(reader, branchOrgId);
    const chain = new Set([
      String(branchOrgId),
      ...(branch?.ancestors ?? []).map(String),
    ]);
    return (account) =>
      account.orgId.equals(branchOrgId) ||
      account.shareOrgs.some(
        (entry) =>
          entry.orgId.equals(branchOrgId) ||
          (entry.includeDescendants && chain.has(String(entry.orgId))),
      );
  }

  /** 現金來源:小金庫,或這一邊分店裡有開著班的收銀點抽屜(別家店的抽屜 → 擋下)。 */
  private async cashSourceOf(
    input: RecordLotterySettlementInput,
    tenantId: Types.ObjectId | null,
    branchOrgId: Types.ObjectId,
  ): Promise<{
    place: "vault" | "drawer";
    cashPointId: Types.ObjectId | null;
    shiftId: Types.ObjectId | null;
  }> {
    if (input.cashSource === "vault") {
      return { place: "vault", cashPointId: null, shiftId: null };
    }
    if (input.cashSource !== "drawer") {
      throw validationError("cash source is required", ["cashSource"]);
    }
    const cashPointId = parseId(input.cashPointId);
    const shift =
      cashPointId === null ? null : await openShiftOf(tenantId, cashPointId);
    if (shift === null) {
      throw validationError(
        "cash point has no open shift",
        ["cashSource"],
        ACCOUNTS_REASONS.noOpenShift,
      );
    }
    if (!shift.orgId.equals(branchOrgId)) {
      throw validationError(
        "cash point is not at this side's branch",
        ["cashSource"],
        ACCOUNTS_REASONS.cashPointNotAtBranch,
      );
    }
    return { place: "drawer", cashPointId, shiftId: shift.shiftId };
  }

  private async toModel(
    operator: OperatorContext,
    snapshot: SettlementSnapshot,
  ): Promise<LotterySettlementModel> {
    const { registration, submission, payable, state } = snapshot;
    const tenantId = submission.tenantId;
    const grant = await this.access.grantOf(operator);
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const match = {
      refType: registration.moduleKey,
      refId: submission._id,
      settlementSide: { $ne: null },
    };
    const [bankRows, cashRows] = await Promise.all([
      this.bank.findMany(reader, match, { sort: { createdAt: 1, _id: 1 } }),
      this.cash.findMany(reader, match, { sort: { createdAt: 1, _id: 1 } }),
    ]);
    // 帳戶名稱:另一邊付款用的帳戶不一定共用給讀者,以同一個租戶邊界讀(只取名稱)
    const accountRows =
      bankRows.length === 0
        ? []
        : await this.accounts.findMany(
            reader,
            { _id: { $in: bankRows.map((row) => row.accountId) } },
            { select: "label" },
          );
    const accountLabel = new Map(
      accountRows.map((row) => [String(row._id), row.label]),
    );
    const sideBranches = registration.sides.map(
      (side) => side.branchOf?.(submission, payable) ?? payable.branchOrgId,
    );
    // 現金來源的抽屜:這一邊的分店開著班的收銀點(看得到那家店才列;店面登記的清單)
    const sideDrawers = await Promise.all(
      registration.sides.map((side, index) => {
        const branch = sideBranches[index] ?? payable.branchOrgId;
        return side.methods.includes("cash") && isOrgVisible(operator, branch)
          ? openDrawersOf(operator, branch)
          : Promise.resolve([]);
      }),
    );
    const [orgNames, userNames] = await Promise.all([
      this.names.orgNames(operator, tenantId, sideBranches),
      this.names.userNames(operator, tenantId, [
        ...bankRows.map((row) => row.createdBy),
        ...cashRows.map((row) => row.createdBy),
      ]),
    ]);
    const reversedIds = new Set(
      [...bankRows, ...cashRows].flatMap((row) =>
        row.reversalOf === null ? [] : [String(row.reversalOf)],
      ),
    );
    const reversedBy = new Map(
      [...bankRows, ...cashRows].flatMap((row) =>
        row.reversalOf === null
          ? []
          : [[String(row.reversalOf), String(row._id)] as const],
      ),
    );
    const canSideSettle = (sideKey: string) => {
      const side = sideOf(registration, sideKey);
      return side !== undefined && grant.has(side.permission);
    };
    const creator = (id: Types.ObjectId | null | undefined) =>
      id == null
        ? null
        : { id: String(id), name: userNames.get(String(id)) ?? "" };
    const records: LotterySettlementRecordModel[] = [
      ...bankRows.map((row) => ({
        id: String(row._id),
        method: "bank",
        side: row.settlementSide ?? "",
        type: row.type,
        direction: row.direction,
        amount: row.amount,
        accountLabel: accountLabel.get(String(row.accountId)) ?? null,
        handler: row.handler,
        note: row.note,
        occurredAt: row.occurredAt,
        createdBy: creator(row.createdBy),
        reversalOf: row.reversalOf === null ? null : String(row.reversalOf),
        reversedById: reversedBy.get(String(row._id)) ?? null,
        canReverse:
          canSideSettle(row.settlementSide ?? "") &&
          row.reversalOf === null &&
          !reversedIds.has(String(row._id)),
      })),
      ...cashRows.map((row) => ({
        id: String(row._id),
        method: "cash",
        side: row.settlementSide ?? "",
        type: row.type,
        direction: row.to === "external" ? "out" : "in",
        amount: row.amount,
        accountLabel: null,
        handler: row.payee,
        note: row.note,
        occurredAt: row.occurredAt,
        createdBy: creator(row.createdBy),
        reversalOf: row.reversalOf === null ? null : String(row.reversalOf),
        reversedById: reversedBy.get(String(row._id)) ?? null,
        canReverse:
          canSideSettle(row.settlementSide ?? "") &&
          row.reversalOf === null &&
          !reversedIds.has(String(row._id)),
      })),
    ].toSorted((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const payer = registration.sides.find((side) => side.role === "payer");
    const payee = registration.sides.find((side) => side.role === "payee");
    return {
      moduleKey: registration.moduleKey,
      label: registration.label,
      kind: registration.kind,
      refId: String(submission._id),
      docNo: payable.docNo,
      counterparty: payable.counterparty,
      payable: payable.amount,
      pendingPayee:
        payer === undefined || payee === undefined
          ? 0
          : pendingPayeeAmount(
              state.sides[payer.side] ?? { out: 0, in: 0 },
              state.sides[payee.side] ?? { out: 0, in: 0 },
            ),
      sides: registration.sides.map((side, index) => {
        const totals = state.sides[side.side] ?? { out: 0, in: 0 };
        const branchId = String(sideBranches[index]);
        // 兩邊店都看得到的單據(調貨單):這一邊的分店也要在讀者的可見範圍內才能按
        const canSettle =
          grant.has(side.permission) &&
          (registration.sharedByValues === undefined ||
            isOrgVisible(operator, sideBranches[index] ?? payable.branchOrgId));
        return {
          side: side.side,
          label: side.label,
          role: side.role,
          methods: [...side.methods],
          branch: { id: branchId, name: orgNames.get(branchId) ?? "" },
          totalOut: totals.out,
          totalIn: totals.in,
          net:
            side.role === "payer"
              ? totals.out - totals.in
              : totals.in - totals.out,
          canSettle,
          cashDrawers: (sideDrawers[index] ?? []).map((drawer) => ({
            id: String(drawer.cashPointId),
            name: drawer.cashPointName,
          })),
          buttons: (["out", "in"] as const).map((button) => {
            const defaultAmount = Math.max(
              0,
              side.defaultAmount(button, state),
            );
            return {
              button,
              defaultAmount,
              canUse: canSettle && defaultAmount > 0,
            };
          }),
        };
      }),
      records,
    };
  }

  private async toRowModels(
    operator: OperatorContext,
    rows: readonly OutstandingRow[],
  ): Promise<LotteryOutstandingSettlementModel[]> {
    const grant = await this.access.grantOf(operator);
    const byTenant = new Map<string, OutstandingRow[]>();
    for (const row of rows) {
      const key = String(row.snapshot.submission.tenantId);
      byTenant.set(key, [...(byTenant.get(key) ?? []), row]);
    }
    const names = new Map<string, string>();
    for (const group of byTenant.values()) {
      const found = await this.names.orgNames(
        operator,
        group[0]?.snapshot.submission.tenantId ?? null,
        group.map((row) => row.branchOrgId),
      );
      for (const [key, value] of found) {
        names.set(key, value);
      }
    }
    const now = Date.now();
    return rows.map((row) => {
      const branchId = String(row.branchOrgId);
      const submittedAt = row.snapshot.submission.submittedAt;
      return {
        moduleKey: row.snapshot.registration.moduleKey,
        label: row.snapshot.registration.label,
        refId: String(row.snapshot.submission._id),
        docNo: row.snapshot.payable.docNo,
        side: row.side.side,
        sideLabel: row.side.label,
        branch: { id: branchId, name: names.get(branchId) ?? "" },
        counterparty: row.snapshot.payable.counterparty,
        payable: row.snapshot.payable.amount,
        net: row.net,
        kind: row.kind,
        amount: row.amount,
        button: row.button,
        daysOutstanding:
          submittedAt === null
            ? 0
            : Math.max(0, Math.floor((now - submittedAt.getTime()) / DAY_MS)),
        canSettle: grant.has(row.side.permission),
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
    await this.realtime.publishBadge(tenantId, ACCOUNTS_KEY, [
      operator.actorId,
    ]);
  }
}
