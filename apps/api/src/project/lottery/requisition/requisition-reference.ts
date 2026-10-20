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

/** 引用叫貨單的單據。 */
export interface RequisitionReferenceInput {
  type: RequisitionReferenceType;
  submissionId: Types.ObjectId;
}

/**
 * 只為了「從叫貨單 id 找出它屬於哪個租戶」:引用介面只帶交易與單據 id(進貨單 / 調貨單的掛接點以系統身分呼叫,
 * 調貨單的系統身分只看得到出貨店,看不到收貨店的叫貨單)。只讀 `tenantId` 一欄,條件釘在明列的叫貨單 id;
 * 之後的讀寫一律改用該租戶的租戶邊界上下文。登記在 `project/database/elevated-contexts.ts`。
 */
function lineTenantReader(): OperatorContext {
  return {
    actorId: null,
    currentOrgId: null,
    visibleOrgIds: "all",
    managedOrgIds: "all",
    memberOrgIds: [],
    roleIds: [],
    memberTenants: [],
  };
}

/**
 * 叫貨單的引用介面(專案規格 8.1、8.2、8.4;正本 `docs/modules/project/purchasing.md`「叫貨單」)。
 * 進貨單(P18)、調貨單(P19)在自己的掛接點(同一個交易)呼叫:
 *
 * - `markRequisitionReferenced(session, requisitionId, { type, submissionId })`:叫貨單 → 已進貨 / 已調貨。
 *   一張叫貨單只能對應一張;已被**別張**引用 → `CONFLICT`(`REQUISITION_REFERENCED`);同一張重送不重複寫;
 *   不是待購買(還沒完成、已作廢、找不到)→ `VALIDATION_FAILED`(`REQUISITION_NOT_PENDING`)
 * - `unmarkRequisitionReferenced(session, requisitionId)`:引用的單駁回 / 作廢 → 叫貨單回到待購買
 */
@Injectable()
export class RequisitionReference {
  constructor(
    private readonly lines: LotteryRequisitionLinesRepository,
    private readonly orgs: OrgsRepository,
  ) {}

  async markRequisitionReferenced(
    session: ClientSession,
    requisitionId: Types.ObjectId,
    reference: RequisitionReferenceInput,
  ): Promise<void> {
    const writer = await this.writerOf(session, requisitionId);
    const rows =
      writer === null
        ? []
        : await this.lines.findMany(
            writer,
            { requisitionId },
            { select: "voidedAt referencedBy", session },
          );
    if (
      writer === null ||
      rows.length === 0 ||
      rows.some((row) => row.voidedAt)
    ) {
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
      { requisitionId, voidedAt: null, referencedBy: null },
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
    requisitionId: Types.ObjectId,
  ): Promise<void> {
    const writer = await this.writerOf(session, requisitionId);
    if (writer === null) {
      return;
    }
    await this.lines.updateMany(
      writer,
      { requisitionId },
      { $set: { referencedBy: null } },
      { session },
    );
  }

  /** 這張叫貨單所屬租戶的租戶邊界上下文;沒有副本(還沒完成 / 找不到)→ null。 */
  private async writerOf(
    session: ClientSession,
    requisitionId: Types.ObjectId,
  ): Promise<OperatorContext | null> {
    const line = await this.lines.findOne(
      lineTenantReader(),
      { requisitionId },
      { select: "tenantId", session },
    );
    if (!line?.tenantId) {
      return null;
    }
    return tenantBoundaryContext(this.orgs, null, line.tenantId);
  }
}
