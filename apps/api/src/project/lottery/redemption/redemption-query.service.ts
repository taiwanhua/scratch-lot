import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  REDEMPTION_STATUS,
  type RedemptionStatus,
  isRedemptionStatus,
} from "@repo/domain/project/lottery";

import type { OperatorContext } from "../../../database/operator-context";
import { LotteryRedemptionsRepository } from "../../database/lottery-redemptions/lottery-redemptions.repository";
import { parseId } from "../store/shift-views";
import { StoreAccess } from "../store/store-access";
import type { LotteryRedemptionsInput } from "./dto/redemption.input";
import type {
  LotteryRedemptionModel,
  LotteryRedemptionsPayload,
} from "./models/redemption.model";
import { notFoundError } from "./redemption-error";
import { RedemptionViews } from "./redemption-views";

/** 兌獎紀錄分頁一次最多幾筆。 */
export const REDEMPTION_PAGE_LIMIT = 100;

/**
 * 兌獎紀錄的讀取(規格 6.5):兌獎紀錄分頁(ST-40)、[最近兌獎](ST-38b)、兌獎紀錄詳情(ST-39a)、
 * 進貨單新增頁的兌獎區(PU-05)。照操作者的可見範圍讀;店面的讀取要 `store.view`。
 */
@Injectable()
export class RedemptionQueryService {
  constructor(
    private readonly redemptions: LotteryRedemptionsRepository,
    private readonly access: StoreAccess,
    private readonly views: RedemptionViews,
  ) {}

  /** 兌獎紀錄分頁:篩選 期間、收銀點、狀態、登記人;登記時間新到舊。 */
  async list(
    operator: OperatorContext,
    input: LotteryRedemptionsInput,
  ): Promise<LotteryRedemptionsPayload> {
    const grant = await this.access.assertView(operator);
    const orgId = parseId(input.orgId);
    if (orgId === null) {
      throw notFoundError(`org not found: ${input.orgId}`);
    }
    const redeemedAt = {
      ...(input.from == null ? {} : { $gte: input.from }),
      ...(input.to == null ? {} : { $lt: input.to }),
    };
    const cashPointId = parseId(input.cashPointId);
    const redeemedBy = parseId(input.redeemedBy);
    const filter = {
      orgId,
      ...(Object.keys(redeemedAt).length === 0 ? {} : { redeemedAt }),
      ...(cashPointId === null ? {} : { cashPointId }),
      ...(redeemedBy === null ? {} : { redeemedBy }),
      ...(isRedemptionStatus(input.status) ? { status: input.status } : {}),
    };
    const limit = Math.min(
      Math.max(input.limit ?? REDEMPTION_PAGE_LIMIT, 1),
      REDEMPTION_PAGE_LIMIT,
    );
    const [rows, total] = await Promise.all([
      this.redemptions.findMany(operator, filter, {
        sort: { redeemedAt: -1, _id: -1 },
        skip: Math.max(input.offset ?? 0, 0),
        limit,
      }),
      this.redemptions.count(operator, filter),
    ]);
    return {
      items: await this.views.toModels(operator, rows, grant),
      total,
    };
  }

  /** [最近兌獎]:自己在這一班登記的兌獎(含已撤銷的,畫面標「已撤銷」),新到舊。 */
  async recent(
    operator: OperatorContext,
    shiftIdText: string,
  ): Promise<LotteryRedemptionModel[]> {
    const grant = await this.access.assertView(operator);
    const shiftId = parseId(shiftIdText);
    if (shiftId === null || operator.actorId === null) {
      return [];
    }
    const rows = await this.redemptions.findMany(
      operator,
      { shiftId, redeemedBy: operator.actorId },
      { sort: { redeemedAt: -1, _id: -1 } },
    );
    return this.views.toModels(operator, rows, grant);
  }

  /** 兌獎紀錄詳情。 */
  async detail(
    operator: OperatorContext,
    idText: string,
  ): Promise<LotteryRedemptionModel> {
    const grant = await this.access.assertView(operator);
    const id = parseId(idText);
    const row =
      id === null ? null : await this.redemptions.findById(operator, id);
    if (row === null) {
      throw notFoundError(`redemption not found: ${idText}`);
    }
    const [model] = await this.views.toModels(operator, [row], grant);
    if (model === undefined) {
      throw notFoundError(`redemption not found: ${idText}`);
    }
    return model;
  }

  /**
   * 進貨單的兌獎區(`purchasing.purchase.create`):進貨分店「店內持有」的兌獎紀錄 + 這張單已勾的
   * (編輯退回的單時);登記時間舊到新。跨分店不做(規格 8.2)。
   */
  async forPurchase(
    operator: OperatorContext,
    orgIdText: string,
    submissionIdText: string | null | undefined,
  ): Promise<LotteryRedemptionModel[]> {
    const orgId = parseId(orgIdText);
    if (orgId === null) {
      throw notFoundError(`org not found: ${orgIdText}`);
    }
    const submissionId = parseId(submissionIdText);
    const statuses: {
      status: RedemptionStatus;
      purchaseSubmissionId?: Types.ObjectId;
    }[] = [{ status: REDEMPTION_STATUS.inStore }];
    if (submissionId !== null) {
      statuses.push({
        status: REDEMPTION_STATUS.sent,
        purchaseSubmissionId: submissionId,
      });
    }
    const rows = await this.redemptions.findMany(
      operator,
      { orgId, $or: statuses },
      { sort: { redeemedAt: 1, _id: 1 } },
    );
    const grant = await this.access.grantOf(operator);
    return this.views.toModels(operator, rows, grant);
  }
}
