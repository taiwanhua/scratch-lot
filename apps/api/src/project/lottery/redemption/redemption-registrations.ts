import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { Types } from "mongoose";

import {
  REDEMPTION_STATUS,
  type RedemptionCashRow,
  redemptionDrawerNetOf,
  redemptionPostCloseNetOf,
} from "@repo/domain/project/lottery";

import type { OperatorContext } from "../../../database/operator-context";
import { LotteryRedemptionsRepository } from "../../database/lottery-redemptions/lottery-redemptions.repository";
import { registerDrawerCashSource } from "../store/drawer-cash";

/** 抽屜應有的來源名(`drawer-cash.ts` 全域唯一)。 */
export const DRAWER_SOURCE_REDEMPTIONS = "redemptions";

/** 一班的兌獎紀錄 → 計算用的列(登記在這一班的 + 事後更正指向這一班的)。 */
async function cashRowsOf(
  repository: LotteryRedemptionsRepository,
  reader: OperatorContext,
  shiftId: Types.ObjectId,
): Promise<RedemptionCashRow[]> {
  const rows = await repository.findMany(
    reader,
    {
      $or: [
        { shiftId },
        { postCloseOf: shiftId },
        { revokePostCloseOf: shiftId },
      ],
    },
    {
      select: "shiftId prizeAmount status postCloseOf revokePostCloseOf",
    },
  );
  return rows.map((row) => ({
    shiftId: String(row.shiftId),
    prizeAmount: row.prizeAmount,
    revoked: row.status === REDEMPTION_STATUS.revoked,
    postCloseOf: row.postCloseOf === null ? null : String(row.postCloseOf),
    revokePostCloseOf:
      row.revokePostCloseOf === null ? null : String(row.revokePostCloseOf),
  }));
}

/**
 * 那一班兌獎的**事後更正淨額**(規格 6.12):交班後撤銷的 +、交班後登記的 −。給交班結帳 / 報表的功能用
 * (`reader` 是呼叫端的讀取身分)。例(第 17 章第 5 題):撤銷 2,000、重新登記 200 → +1,800。
 */
export async function redemptionPostCloseNet(
  repository: LotteryRedemptionsRepository,
  reader: OperatorContext,
  shiftId: Types.ObjectId,
): Promise<number> {
  return redemptionPostCloseNetOf(
    await cashRowsOf(repository, reader, shiftId),
    String(shiftId),
  );
}

/**
 * 兌獎向店面登記的事(規格 6.9 應有現金「− 兌獎」):抽屜應有的來源 `redemptions` = 那一班開著時登記、
 * 沒有在班開著時撤銷的兌獎合計(負數)。交班後的撤銷 / 新增是事後更正,不改結帳時的應有。
 */
@Injectable()
export class RedemptionRegistrations implements OnModuleInit, OnModuleDestroy {
  private readonly unregister: (() => void)[] = [];

  constructor(private readonly redemptions: LotteryRedemptionsRepository) {}

  onModuleInit(): void {
    this.unregister.push(
      registerDrawerCashSource(
        DRAWER_SOURCE_REDEMPTIONS,
        async (reader, shift) =>
          redemptionDrawerNetOf(
            await cashRowsOf(this.redemptions, reader, shift._id),
            String(shift._id),
          ),
      ),
    );
  }

  onModuleDestroy(): void {
    for (const undo of this.unregister.splice(0)) {
      undo();
    }
  }
}
