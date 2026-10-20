import { Injectable } from "@nestjs/common";

import {
  ACCOUNTS_PERMISSIONS,
  BANK_ACCOUNT_STATUSES,
  BANK_CODE_PATTERN,
  type BankAccountStatus,
  BANK_ACCOUNT_LIMITS as LIMITS,
  bankAccountLabel,
} from "@repo/domain/project/lottery-accounts";

import { AuditService } from "../../../audit/audit.service";
import type { Persisted } from "../../../database/base.repository";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { normalizeShareOrgs } from "../../../database/share-orgs";
import { TransactionService } from "../../../database/transaction";
import { toShareOrgModels } from "../../../sharing/share-org.model";
import {
  type LotteryBankAccountDocument,
  LotteryBankAccountsRepository,
  LotteryBankTransactionsRepository,
} from "../../database/lottery-accounts/lottery-accounts.repositories";
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
import { firstOf, trimmed } from "./accounts-util";
import { BankTransactionsService } from "./bank-transactions.service";
import type {
  CreateLotteryBankAccountInput,
  LotteryBankAccountsInput,
  UpdateLotteryBankAccountInput,
} from "./dto/lottery-bank-account.input";
import type {
  LotteryBankAccountModel,
  LotteryBankAccountsPayload,
} from "./models/lottery-bank-account.model";

type AccountRecord = Persisted<LotteryBankAccountDocument>;

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/** 主檔欄位(稽核的 before / after、變更比對用)。 */
interface AccountValues {
  bankCode: string;
  branchName: string | null;
  accountNo: string;
  accountName: string;
  openingBalance: number;
  openingDate: Date;
  status: BankAccountStatus;
  note: string | null;
}

function valuesOf(record: AccountRecord): AccountValues {
  return {
    bankCode: record.bankCode,
    branchName: record.branchName,
    accountNo: record.accountNo,
    accountName: record.accountName,
    openingBalance: record.openingBalance,
    openingDate: record.openingDate,
    status: record.status,
    note: record.note,
  };
}

function isSame(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  return a === b;
}

/** 欄位檢查(新增全部、編輯只檢查有給的)。 */
function checkValues(values: AccountValues, errors: FieldErrors): void {
  if (!BANK_CODE_PATTERN.test(values.bankCode)) {
    errors.add("bankCode");
  }
  if ((values.branchName?.length ?? 0) > LIMITS.branchName) {
    errors.add("branchName");
  }
  if (values.accountNo === "" || values.accountNo.length > LIMITS.accountNo) {
    errors.add("accountNo");
  }
  if (
    values.accountName === "" ||
    values.accountName.length > LIMITS.accountName
  ) {
    errors.add("accountName");
  }
  if (!Number.isInteger(values.openingBalance)) {
    errors.add("openingBalance");
  }
  if (Number.isNaN(values.openingDate.getTime())) {
    errors.add("openingDate");
  }
  if (!BANK_ACCOUNT_STATUSES.includes(values.status)) {
    errors.add("status");
  }
  if ((values.note?.length ?? 0) > LIMITS.note) {
    errors.add("note");
  }
}

/**
 * 銀行帳戶(`accounts` → 銀行帳戶分頁;專案規格 10.1,正本 `docs/modules/project/accounts.md`)。
 *
 * - **範圍**:可見範圍 + 使用組織(資料共用 `shareOrgs`):總部看全部、分店看使用組織包含自己的;
 *   看不到的帳戶列表與單筆一律 `NOT_FOUND`。修改 / 刪除只對歸屬組織在可見範圍內的(共用進來的只能看)
 * - 讀取要 `view-bank-accounts`;新增 `create-bank-account`;編輯 / 刪除 `edit-bank-account`
 * - 有交易之後期初餘額、期初日期鎖定;沒有交易才能刪除(軟刪除),有交易只能停用
 * - 餘額不存:期初 + 交易加總;負數只警告(畫面標色)
 */
@Injectable()
export class BankAccountsService {
  constructor(
    private readonly accounts: LotteryBankAccountsRepository,
    private readonly transactions: LotteryBankTransactionsRepository,
    private readonly bankTransactions: BankTransactionsService,
    private readonly names: AccountNames,
    private readonly access: AccountsAccess,
    private readonly audit: AuditService,
    private readonly tx: TransactionService,
  ) {}

  // ---- 讀 ----

  async list(
    operator: OperatorContext,
    input: LotteryBankAccountsInput,
  ): Promise<LotteryBankAccountsPayload> {
    const grant = await this.access.assert(
      operator,
      ACCOUNTS_PERMISSIONS.viewBankAccounts,
    );
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const filter = input.status
      ? { status: input.status as BankAccountStatus }
      : {};
    const totalCount = await this.accounts.count(operator, filter);
    const rows = await this.accounts.findMany(operator, filter, {
      sort: { status: 1, createdAt: 1, _id: 1 },
      skip: (page - 1) * pageSize,
      limit: pageSize,
    });
    return {
      items: await this.toModels(operator, grant, rows),
      totalCount,
      page,
      pageSize,
    };
  }

  async get(operator: OperatorContext, id: string) {
    const grant = await this.access.assert(
      operator,
      ACCOUNTS_PERMISSIONS.viewBankAccounts,
    );
    const account = await this.bankTransactions.mustFindAccount(operator, id);
    return firstOf(await this.toModels(operator, grant, [account]));
  }

  // ---- 寫 ----

  async create(
    operator: OperatorContext,
    input: CreateLotteryBankAccountInput,
  ): Promise<LotteryBankAccountModel> {
    const grant = await this.access.assert(
      operator,
      ACCOUNTS_PERMISSIONS.createBankAccount,
    );
    const values: AccountValues = {
      bankCode: input.bankCode.trim(),
      branchName: trimmed(input.branchName),
      accountNo: input.accountNo.trim(),
      accountName: input.accountName.trim(),
      openingBalance: input.openingBalance,
      openingDate: input.openingDate,
      status: "active",
      note: trimmed(input.note),
    };
    const errors = new FieldErrors();
    checkValues(values, errors);
    errors.throwIfAny("bank account input is invalid");
    const shareOrgs = normalizeShareOrgs(input.shareOrgs ?? []);
    const created = await this.saving(() =>
      this.tx.withTransaction(async () => {
        const row = await this.accounts.create(operator, {
          ...values,
          label: bankAccountLabel(values),
          shareOrgs,
        });
        await this.audit.record(operator, {
          action: ACCOUNTS_AUDIT.accountCreate,
          targetType: ACCOUNTS_AUDIT.accountTarget,
          targetId: row._id,
          after: { ...values, shareOrgs: toShareOrgModels(row.shareOrgs) },
        });
        return row;
      }),
    );
    return firstOf(await this.toModels(operator, grant, [created]));
  }

  async update(
    operator: OperatorContext,
    input: UpdateLotteryBankAccountInput,
  ): Promise<LotteryBankAccountModel> {
    const grant = await this.access.assert(
      operator,
      ACCOUNTS_PERMISSIONS.editBankAccount,
    );
    const current = await this.mustFindOwn(operator, input.id);
    const before = valuesOf(current);
    const next: AccountValues = {
      bankCode: input.bankCode?.trim() ?? before.bankCode,
      branchName:
        input.branchName === undefined
          ? before.branchName
          : trimmed(input.branchName),
      accountNo: input.accountNo?.trim() ?? before.accountNo,
      accountName: input.accountName?.trim() ?? before.accountName,
      openingBalance: input.openingBalance ?? before.openingBalance,
      openingDate: input.openingDate ?? before.openingDate,
      status: (input.status as BankAccountStatus | null) ?? before.status,
      note: input.note === undefined ? before.note : trimmed(input.note),
    };
    const errors = new FieldErrors();
    checkValues(next, errors);
    errors.throwIfAny("bank account input is invalid");
    const changed = (Object.keys(next) as (keyof AccountValues)[]).filter(
      (key) => !isSame(next[key], before[key]),
    );
    const lockedChanged = changed.filter(
      (key) => key === "openingBalance" || key === "openingDate",
    );
    if (
      lockedChanged.length > 0 &&
      (await this.hasTransactions(operator, current))
    ) {
      throw validationError(
        "bank account has transactions: opening balance and date are locked",
        lockedChanged,
        ACCOUNTS_REASONS.accountHasTransactions,
      );
    }
    const shareOrgs =
      input.shareOrgs == null ? null : normalizeShareOrgs(input.shareOrgs);
    if (changed.length === 0 && shareOrgs === null) {
      return firstOf(await this.toModels(operator, grant, [current]));
    }
    const set: Record<string, unknown> = {};
    const auditBefore: Record<string, unknown> = {};
    for (const key of changed) {
      set[key] = next[key];
      auditBefore[key] = before[key];
    }
    if (changed.includes("accountName") || changed.includes("accountNo")) {
      set.label = bankAccountLabel(next);
    }
    if (shareOrgs !== null) {
      set.shareOrgs = shareOrgs;
      auditBefore.shareOrgs = toShareOrgModels(current.shareOrgs);
    }
    const updated = await this.saving(() =>
      this.tx.withTransaction(async () => {
        const row = await this.accounts.updateById(operator, current._id, {
          $set: set,
        });
        if (!row) {
          throw notFoundError(`bank account not found: ${input.id}`);
        }
        await this.audit.record(operator, {
          action: ACCOUNTS_AUDIT.accountEdit,
          targetType: ACCOUNTS_AUDIT.accountTarget,
          targetId: row._id,
          before: auditBefore,
          after: {
            ...set,
            ...(shareOrgs === null
              ? {}
              : { shareOrgs: toShareOrgModels(row.shareOrgs) }),
          },
        });
        return row;
      }),
    );
    return firstOf(await this.toModels(operator, grant, [updated]));
  }

  /** 刪除(軟刪除):沒有任何交易的帳戶才可以;有交易 → `BANK_ACCOUNT_HAS_TRANSACTIONS`。 */
  async delete(operator: OperatorContext, id: string): Promise<string> {
    await this.access.assert(operator, ACCOUNTS_PERMISSIONS.editBankAccount);
    const current = await this.mustFindOwn(operator, id);
    if (await this.hasTransactions(operator, current)) {
      throw validationError(
        "bank account has transactions: deactivate it instead",
        ["id"],
        ACCOUNTS_REASONS.accountHasTransactions,
      );
    }
    await this.tx.withTransaction(async () => {
      const deleted = await this.accounts.softDeleteById(operator, current._id);
      if (!deleted) {
        throw notFoundError(`bank account not found: ${id}`);
      }
      await this.audit.record(operator, {
        action: ACCOUNTS_AUDIT.accountDelete,
        targetType: ACCOUNTS_AUDIT.accountTarget,
        targetId: current._id,
        before: { ...valuesOf(current) },
      });
    });
    return String(current._id);
  }

  // ---- 內部 ----

  /**
   * 有沒有任何交易:以租戶邊界出口問「有沒有」(交易可能是別家分店登記的、讀者不一定看得到),
   * 登記在 `TENANT_BOUNDARY_CALLERS`。
   */
  private hasTransactions(
    operator: OperatorContext,
    account: AccountRecord,
  ): Promise<boolean> {
    return this.transactions.existsInTenant(operator, account.tenantId, {
      accountId: account._id,
    });
  }

  /** 要改的帳戶:看得到,且歸屬組織在可見範圍內(共用進來的只能看 → `NOT_FOUND`)。 */
  private async mustFindOwn(
    operator: OperatorContext,
    id: string,
  ): Promise<AccountRecord> {
    const account = await this.bankTransactions.mustFindAccount(operator, id);
    if (!isOrgVisible(operator, account.orgId)) {
      throw notFoundError(`bank account not found: ${id}`);
    }
    return account;
  }

  /** 寫入撞到唯一索引(同租戶同銀行代碼 + 帳號)。 */
  private async saving<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw validationError(
          "bank account duplicated",
          ["accountNo"],
          ACCOUNTS_REASONS.accountDuplicate,
        );
      }
      throw error;
    }
  }

  private async toModels(
    operator: OperatorContext,
    grant: AccountsGrant,
    rows: readonly AccountRecord[],
  ): Promise<LotteryBankAccountModel[]> {
    const balances = await this.bankTransactions.balancesOf(operator, rows);
    const orgNames = new Map<string, string>();
    for (const row of rows) {
      const missing = row.shareOrgs.filter(
        (entry) => !orgNames.has(String(entry.orgId)),
      );
      if (missing.length > 0) {
        for (const [key, value] of await this.names.orgNames(
          operator,
          row.tenantId,
          missing.map((entry) => entry.orgId),
        )) {
          orgNames.set(key, value);
        }
      }
    }
    const canEditAny = grant.has(ACCOUNTS_PERMISSIONS.editBankAccount);
    const canRecord = grant.has(ACCOUNTS_PERMISSIONS.recordBankTransaction);
    const canReverse = grant.has(ACCOUNTS_PERMISSIONS.reverseBankTransaction);
    return rows.map((row) => {
      const stats = balances.get(String(row._id)) ?? { sum: 0, count: 0 };
      const canEdit = canEditAny && isOrgVisible(operator, row.orgId);
      return {
        id: String(row._id),
        bankCode: row.bankCode,
        branchName: row.branchName,
        accountNo: row.accountNo,
        accountName: row.accountName,
        label: row.label,
        openingBalance: row.openingBalance,
        openingDate: row.openingDate,
        status: row.status,
        note: row.note,
        balance: row.openingBalance + stats.sum,
        hasTransactions: stats.count > 0,
        shareOrgs: toShareOrgModels(row.shareOrgs),
        usageOrgs: row.shareOrgs.map((entry) => ({
          id: String(entry.orgId),
          name: orgNames.get(String(entry.orgId)) ?? "",
        })),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        abilities: {
          canEdit,
          canDelete: canEdit && stats.count === 0,
          canRecordTransaction: canRecord && row.status === "active",
          canReverse,
        },
      };
    });
  }
}
