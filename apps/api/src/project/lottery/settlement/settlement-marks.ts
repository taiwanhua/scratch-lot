import { Injectable } from "@nestjs/common";
import type { ClientSession, Types } from "mongoose";

import { OrgsRepository } from "../../../database/base/repositories";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { LotterySettlementMarksRepository } from "../../database/lottery-accounts/lottery-accounts.repositories";
import { tenantOfOperator } from "../../tenant-scope/operator-tenant";

/** 一筆還要算的已完成單據(`rev` 給 `close` 比對)。 */
export interface PendingMark {
  refType: string;
  refId: Types.ObjectId;
  rev: number;
  closedAsOf: Date | null;
}

/**
 * 已完成單據的結清標記(`lottery_settlement_marks`;待結清只掃還沒結清的,規則見 schema 註解)。
 * 標記以單據的租戶為邊界讀寫(兩邊店的單據歸屬其中一家,另一家靠依欄位共用看得到;標記本身只是索引,
 * 單據照樣以讀者的範圍讀,看不到的不會出現)。登記在 `TENANT_BOUNDARY_CONTEXT_CALLERS`,用途「反查」「系統重算」。
 */
@Injectable()
export class SettlementMarks {
  constructor(
    private readonly marks: LotterySettlementMarksRepository,
    private readonly orgs: OrgsRepository,
  ) {}

  /** 單據完成(掛接點 `completed`,同一個交易):建一筆待確認的標記;已有 → 改回待確認。 */
  async completed(
    session: ClientSession,
    submission: {
      _id: Types.ObjectId;
      orgId: Types.ObjectId;
      tenantId: Types.ObjectId | null;
      moduleKey: string;
    },
  ): Promise<void> {
    if (submission.tenantId === null) {
      return;
    }
    const writer = await tenantBoundaryContext(
      this.orgs,
      null,
      submission.tenantId,
    );
    const touched = await this.reopen(writer, submission._id, session);
    if (touched > 0) {
      return;
    }
    await this.marks.create(
      writer,
      {
        orgId: submission.orgId,
        refType: submission.moduleKey,
        refId: submission._id,
        closedAsOf: null,
        rev: 0,
      },
      { session },
    );
  }

  /**
   * 單據寫了一筆收付(銀行交易 / 現金流水,含沖正;同一個交易):有標記就改回待確認。
   * 沒有標記 = 單據還沒完成(待結清照狀態查,不靠標記),不用記。
   */
  async touch(
    tenantId: Types.ObjectId | null,
    refId: Types.ObjectId,
    session?: ClientSession | null,
  ): Promise<void> {
    if (tenantId === null) {
      return;
    }
    const writer = await tenantBoundaryContext(this.orgs, null, tenantId);
    await this.reopen(writer, refId, session);
  }

  /** 讀者用的標記上下文:操作者所在租戶的租戶邊界;根組織 = 他自己;沒有當前組織 → null(沒有標記可看)。 */
  async readerOf(operator: OperatorContext): Promise<OperatorContext | null> {
    if (operator.visibleOrgIds === "all") {
      return operator;
    }
    const tenantId = tenantOfOperator(operator)?.tenantId ?? null;
    return tenantId === null
      ? null
      : tenantBoundaryContext(this.orgs, operator, tenantId);
  }

  /**
   * 還要算的已完成單據:沒給 `asOf` = 待確認的(`closedAsOf` null);給了 = 那個時點可能還有待結清的
   * (`closedAsOf` null 或不早於那個時點)。
   */
  async pending(
    reader: OperatorContext,
    refTypes: readonly string[],
    asOf?: Date,
  ): Promise<PendingMark[]> {
    if (refTypes.length === 0) {
      return [];
    }
    const rows = await this.marks.findMany(
      reader,
      {
        refType: { $in: [...refTypes] },
        ...(asOf === undefined
          ? { closedAsOf: null }
          : { $or: [{ closedAsOf: null }, { closedAsOf: { $gte: asOf } }] }),
      },
      { select: "refType refId rev closedAsOf" },
    );
    return rows.map((row) => ({
      refType: row.refType,
      refId: row.refId,
      rev: row.rev,
      closedAsOf: row.closedAsOf,
    }));
  }

  /** 寫上 `closedAsOf`(一次寫完;`rev` 不符 = 算的途中有新收付,那一筆不寫)。 */
  async close(
    reader: OperatorContext,
    marks: readonly Pick<PendingMark, "refId" | "rev">[],
    closedAsOf: Date,
  ): Promise<void> {
    if (marks.length === 0) {
      return;
    }
    // 依 rev 分組(`{ rev, refId: { $in } }`):上線補的標記幾乎都是 rev 0,子句數收斂成幾組
    const byRev = new Map<number, Types.ObjectId[]>();
    for (const mark of marks) {
      byRev.set(mark.rev, [...(byRev.get(mark.rev) ?? []), mark.refId]);
    }
    await this.marks.updateMany(
      reader,
      {
        closedAsOf: null,
        $or: [...byRev].map(([rev, refIds]) => ({
          rev,
          refId: { $in: refIds },
        })),
      },
      { $set: { closedAsOf } },
    );
  }

  private reopen(
    writer: OperatorContext,
    refId: Types.ObjectId,
    session?: ClientSession | null,
  ): Promise<number> {
    return this.marks.updateMany(
      writer,
      { refId },
      { $set: { closedAsOf: null }, $inc: { rev: 1 } },
      session === undefined ? {} : { session },
    );
  }
}
