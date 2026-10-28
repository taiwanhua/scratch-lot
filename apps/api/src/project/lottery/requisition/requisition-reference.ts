import { Injectable } from "@nestjs/common";
import type { ClientSession, Types } from "mongoose";

import type { RequisitionReferenceType } from "@repo/domain/project/lottery";

import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { LotteryRequisitionLinesRepository } from "../../database/lottery-requisitions/lottery-requisition-lines.repository";
import {
  REQUISITION_REASONS,
  conflictError,
  validationError,
} from "./requisition-error";

/** 哪一個租戶的哪一張叫貨單(`tenantId` = 引用它的單據的 `submission.tenantId`)。 */
export interface RequisitionTarget {
  tenantId: Types.ObjectId;
  requisitionId: Types.ObjectId;
}

/** 引用叫貨單:目標 + 引用它的單據。 */
export interface RequisitionReferenceInput extends RequisitionTarget {
  type: RequisitionReferenceType;
  submissionId: Types.ObjectId;
}

/**
 * 叫貨單的引用介面(專案規格 8.1、8.2、8.4;正本 `docs/modules/project/purchasing.md`「叫貨單」)。
 * 進貨單(P18)、調貨單(P19)在自己的掛接點(同一個交易)呼叫,`tenantId` 傳引用單據的 `submission.tenantId`:
 *
 * - `markRequisitionReferenced(session, { tenantId, requisitionId, type, submissionId })`:叫貨單 → 已進貨 / 已調貨。
 *   一張叫貨單只能對應一張;已被**別張**引用 → `CONFLICT`(`REQUISITION_REFERENCED`);同一張重送不重複寫;
 *   不是待購買(還沒完成、已作廢、找不到、別的租戶的)→ `VALIDATION_FAILED`(`REQUISITION_NOT_PENDING`)
 * - `unmarkRequisitionReferenced(session, { tenantId, requisitionId })`:引用的單駁回 / 作廢 → 回到待購買
 *   (多張一次寫:`unmarkRequisitionsReferenced(session, tenantId, requisitionIds)`)
 *
 * 讀寫用該租戶的租戶邊界上下文(調貨單的系統身分只看得到出貨店,叫貨單在收貨店),條件再釘 `tenantId`。
 */
@Injectable()
export class RequisitionReference {
  constructor(
    private readonly lines: LotteryRequisitionLinesRepository,
    private readonly orgs: OrgsRepository,
  ) {}

  async markRequisitionReferenced(
    session: ClientSession,
    reference: RequisitionReferenceInput,
  ): Promise<void> {
    const { tenantId, requisitionId } = reference;
    const writer = await this.writerOf(tenantId);
    const rows = await this.lines.findMany(
      writer,
      { tenantId, requisitionId },
      { select: "voidedAt referencedBy", session },
    );
    if (rows.length === 0 || rows.some((row) => row.voidedAt)) {
      throw validationError(
        "叫貨單不是待購買,不能引用",
        ["requisitionId"],
        REQUISITION_REASONS.notPending,
      );
    }
    const others = rows.filter(
      (row) =>
        row.referencedBy !== null &&
        !row.referencedBy.submissionId.equals(reference.submissionId),
    );
    if (others.length > 0) {
      throw conflictError(
        "叫貨單已被其他單據引用",
        REQUISITION_REASONS.referenced,
      );
    }
    await this.lines.updateMany(
      writer,
      { tenantId, requisitionId, voidedAt: null, referencedBy: null },
      {
        $set: {
          referencedBy: {
            type: reference.type,
            submissionId: reference.submissionId,
          },
        },
      },
      { session },
    );
  }

  async unmarkRequisitionReferenced(
    session: ClientSession,
    { tenantId, requisitionId }: RequisitionTarget,
  ): Promise<void> {
    await this.unmarkRequisitionsReferenced(session, tenantId, [requisitionId]);
  }

  /** 多張叫貨單一次回到待購買(一張單引用好幾張時;同一個租戶,一次寫)。 */
  async unmarkRequisitionsReferenced(
    session: ClientSession,
    tenantId: Types.ObjectId,
    requisitionIds: readonly Types.ObjectId[],
  ): Promise<void> {
    if (requisitionIds.length === 0) {
      return;
    }
    const writer = await this.writerOf(tenantId);
    await this.lines.updateMany(
      writer,
      { tenantId, requisitionId: { $in: [...requisitionIds] } },
      { $set: { referencedBy: null } },
      { session },
    );
  }

  /** 這個租戶的租戶邊界上下文(系統身分)。 */
  private writerOf(tenantId: Types.ObjectId): Promise<OperatorContext> {
    return tenantBoundaryContext(this.orgs, null, tenantId);
  }
}
