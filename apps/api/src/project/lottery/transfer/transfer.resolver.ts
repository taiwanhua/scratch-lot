import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";
import { Types } from "mongoose";

import { TRANSFER_PERMISSIONS } from "@repo/domain/project/lottery";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import {
  LotteryTransferOptionsModel,
  LotteryTransferProgressModel,
  LotteryTransferReceivingModel,
  LotteryTransferTicketCellModel,
  ReceiveLotteryTransferBookInput,
  ReceiveLotteryTransferBookPayload,
} from "./models/transfer.model";
import { notFoundError } from "./transfer-error";
import { TransferQueryService } from "./transfer-query.service";
import { TransferReceivingService } from "./transfer-receiving.service";

function orgIdOf(text: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(text)) {
    throw notFoundError("分店不存在");
  }
  return new Types.ObjectId(text);
}

/**
 * 調貨單的端點(權限表正本 `docs/modules/project/purchasing.md`「調貨單」):
 * 新增頁的選項與張數格子守 `create`;列表的進度 / 結算守 `view`;
 * 出貨確認清單 / 點收區塊與刷條碼點收不守模組權限(店長從申請中心進來):讀得到單據(兩邊店都看得到)、
 * 點收關卡的任務在自己手上才行。調貨單本身的新增 / 送出 / 審核 / 作廢走表單引擎;收付走 `recordLotterySettlement`
 * (收貨店那一邊要 `pay`、出貨店那一邊要 `receive`)。
 */
@Resolver()
export class TransferResolver {
  constructor(
    private readonly query: TransferQueryService,
    private readonly receiving: TransferReceivingService,
  ) {}

  @RequirePermission(TRANSFER_PERMISSIONS.create)
  @Query(() => LotteryTransferOptionsModel, { name: "lotteryTransferOptions" })
  lotteryTransferOptions(
    @Args("fromOrgId", { type: () => ID }) fromOrgId: string,
    @Args("toOrgId", { type: () => ID, nullable: true })
    toOrgId: string | null,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryTransferOptionsModel> {
    return this.query.optionsOf(
      operator,
      orgIdOf(fromOrgId),
      toOrgId === null || toOrgId === "" ? null : orgIdOf(toOrgId),
    );
  }

  @RequirePermission(TRANSFER_PERMISSIONS.create)
  @Query(() => [LotteryTransferTicketCellModel], {
    name: "lotteryTransferBookTickets",
  })
  lotteryTransferBookTickets(
    @Args("fromOrgId", { type: () => ID }) fromOrgId: string,
    @Args("bookId", { type: () => ID }) bookId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryTransferTicketCellModel[]> {
    return this.query.ticketsOf(operator, orgIdOf(fromOrgId), bookId);
  }

  @RequirePermission(TRANSFER_PERMISSIONS.view)
  @Query(() => [LotteryTransferProgressModel], {
    name: "lotteryTransferProgress",
  })
  lotteryTransferProgress(
    @Args("transferIds", { type: () => [ID] }) transferIds: string[],
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryTransferProgressModel[]> {
    return this.query.progressOf(operator, transferIds);
  }

  @Query(() => LotteryTransferReceivingModel, {
    name: "lotteryTransferReceiving",
  })
  lotteryTransferReceiving(
    @Args("submissionId", { type: () => ID }) submissionId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryTransferReceivingModel> {
    return this.receiving.receivingOf(operator, submissionId);
  }

  @Mutation(() => ReceiveLotteryTransferBookPayload)
  receiveLotteryTransferBook(
    @Args("input") input: ReceiveLotteryTransferBookInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ReceiveLotteryTransferBookPayload> {
    return this.receiving.receive(operator, input.submissionId, input.code);
  }

  /** 送錯分店的 [通知總部更正]:通知那張(送往別家分店的)調貨單的建立者。 */
  @Mutation(() => Boolean)
  notifyLotteryTransferWrongStore(
    @Args("input") input: ReceiveLotteryTransferBookInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<boolean> {
    return this.receiving.notifyWrongStore(
      operator,
      input.submissionId,
      input.code,
    );
  }
}
