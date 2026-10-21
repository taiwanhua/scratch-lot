import { Injectable } from "@nestjs/common";
import type { ClientSession, Types } from "mongoose";

import type { OperatorContext } from "../../../database/operator-context";
import { LotteryVaultLocksRepository } from "../../database/lottery-store/lottery-shifts.repository";
import { isDuplicateKeyError } from "../accounts/accounts-error";
import { CashLedgerService } from "../cash/cash-ledger.service";
import { STORE_REASONS, validationError } from "./store-error";

/**
 * 從小金庫拿錢(出庫、開班從小金庫領零用金)不能超過小金庫應有(使用者 10/21 定案;規格 6.7)。
 * 小金庫應有沿用 `CashLedgerService.vaultExpected`(日結起算點 + 之後流水)。
 *
 * 同一家店同時兩筆:交易外先建好守門文件(`prepare`),交易內先 `$inc` 它再算應有(`assertCovers`)——
 * 兩個交易在守門文件上衝突、重跑的一方讀得到對方剛寫的流水(比照抽屜的 `drawerVersion`)。
 */
@Injectable()
export class StoreVaultGuard {
  constructor(
    private readonly locks: LotteryVaultLocksRepository,
    private readonly ledger: CashLedgerService,
  ) {}

  /** 交易外先建好這家店的守門文件(兩個請求同時建,唯一索引擋下的那一個略過)。 */
  async prepare(
    operator: OperatorContext,
    orgId: Types.ObjectId,
  ): Promise<void> {
    if (await this.locks.findOne(operator, { orgId })) {
      return;
    }
    try {
      await this.locks.create(operator, { orgId, version: 0 });
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }
  }

  /**
   * 交易內(`session` = 呼叫端交易的 session):碰守門文件,再檢查小金庫應有 ≥ 這次要拿的金額;不夠 → `VALIDATION_FAILED`
   * (`reason = AMOUNT_EXCEEDS_VAULT`,欄位 `field`)。
   */
  async assertCovers(
    session: ClientSession,
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    orgId: Types.ObjectId,
    amount: number,
    field: string,
  ): Promise<void> {
    const touched = await this.locks.findOneAndUpdate(
      operator,
      { orgId },
      { $inc: { version: 1 } },
      { session },
    );
    if (!touched) {
      throw new Error(`vault lock missing: org ${String(orgId)}`);
    }
    const vault = await this.ledger.vaultExpected(operator, tenantId, orgId);
    if (amount > vault.amount) {
      throw validationError(
        "amount exceeds the vault's expected cash",
        [field],
        STORE_REASONS.amountExceedsVault,
      );
    }
  }

  /**
   * 交易內只碰守門文件、不檢查應有(現金更正單完成時寫小金庫:增加不用檢查、減少是登記實際短少的錢,
   * 不擋;規格 8.8)。讓同一家店同時動小金庫的動作照同一個守門文件序列化;守門文件不存在就在同一個交易裡先建
   * (`session` = 掛接點的交易)。
   */
  async serialize(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    if (!(await this.locks.findOne(operator, { orgId }, { session }))) {
      await this.locks.create(operator, { orgId, version: 0 }, { session });
    }
    await this.locks.findOneAndUpdate(
      operator,
      { orgId },
      { $inc: { version: 1 } },
      { session },
    );
  }
}
