import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  STOCKTAKE_STATUS,
  TICKET_STATUS,
  isMatchingCountMode,
  rescanReminderGamesOf,
} from "@repo/domain/project/lottery";

import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { NotificationService } from "../../../notifications/notification.service";
import { LotteryTicketsRepository } from "../../database/lottery-inventory/lottery-inventory.repository";
import { LotteryStocktakesRepository } from "../../database/lottery-stocktakes/lottery-stocktakes.repository";
import {
  LOTTERY_RESCAN_REMINDER,
  LOTTERY_STORE_BOARD_REF,
} from "../../notifications";
import { StoreCountModeService } from "../settings/store-count-mode.service";
import type { StoreRef } from "../store/store-sales-support";
import { StoreSalesSupport } from "../store/store-sales-support";
import type { LotteryRescanReminderModel } from "./models/rescan.model";

/**
 * 全店重刷提醒(張數店規格 8.3;正本 `docs/modules/project/store.md`「全店重刷」):
 *
 * - 條件:某個遊戲有「待查·未對號未確認」或「標記異常」(上次這個遊戲的全店重刷完成之後才記的;重刷完成後提醒消失)
 * - `remindersOf`:看板、盤點頁、待查清單上方的 [全店重刷 遊戲 X](重刷進行中的遊戲改顯示重刷的橫幅)
 * - `notify`:負責人提醒「全店重刷提醒」給店長(盤點送出時有 [標記異常]、核准時記了待查·未對號)
 *
 * 只有張數店與轉換中。查詢次數固定:上次重刷完成 1 次 aggregate、待查·未對號 1 次 aggregate(走 `unmatched` 的 partial 索引)、
 * 標記異常 1 次 aggregate、遊戲名稱 1 次。
 */
@Injectable()
export class RescanReminders {
  constructor(
    private readonly orgs: OrgsRepository,
    private readonly stocktakes: LotteryStocktakesRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly countModes: StoreCountModeService,
    private readonly support: StoreSalesSupport,
    private readonly notifications: NotificationService,
  ) {}

  /** 要提醒全店重刷的遊戲(`activeGameIds` = 重刷進行中的遊戲,不提醒)。 */
  async remindersOf(
    reader: OperatorContext,
    store: StoreRef,
    activeGameIds: ReadonlySet<string>,
  ): Promise<LotteryRescanReminderModel[]> {
    const mode = await this.countModes.modeOf(reader, store.orgId);
    if (!isMatchingCountMode(mode)) {
      return [];
    }
    const [finished, investigating, flagged] = await Promise.all([
      this.stocktakes.aggregate(reader, [
        {
          $match: {
            orgId: store.orgId,
            purpose: "rescan",
            status: STOCKTAKE_STATUS.confirmed,
          },
        },
        {
          $group: {
            _id: "$rescan.gameId",
            at: { $max: "$rescan.finishedAt" },
          },
        },
      ]),
      this.tickets.aggregate(reader, [
        {
          $match: {
            orgId: store.orgId,
            unmatched: true,
            status: TICKET_STATUS.investigating,
          },
        },
        { $group: { _id: "$gameId", at: { $push: "$updatedAt" } } },
      ]),
      this.stocktakes.aggregate(reader, [
        {
          $match: {
            orgId: store.orgId,
            purpose: { $ne: "rescan" },
            status: {
              $in: [STOCKTAKE_STATUS.pending, STOCKTAKE_STATUS.confirmed],
            },
            "countLines.flaggedCount": { $gt: 0 },
          },
        },
        { $unwind: "$countLines" },
        { $match: { "countLines.flaggedCount": { $gt: 0 } } },
        {
          $project: {
            gameId: "$countLines.gameId",
            count: "$countLines.flaggedCount",
            at: "$submittedAt",
          },
        },
      ]),
    ]);
    const lastOf = new Map(
      finished.map((row) => [String(row._id), row.at as Date | null]),
    );
    const after = (gameId: string, at: Date): boolean => {
      const last = lastOf.get(gameId) ?? null;
      return last === null || at.getTime() > last.getTime();
    };
    const rows = new Map<
      string,
      { gameId: string; investigateCount: number; flaggedCount: number }
    >();
    const rowOf = (gameId: string) => {
      const found = rows.get(gameId) ?? {
        gameId,
        investigateCount: 0,
        flaggedCount: 0,
      };
      rows.set(gameId, found);
      return found;
    };
    for (const row of investigating) {
      const gameId = String(row._id);
      const count = (row.at as Date[]).filter((at) => after(gameId, at)).length;
      if (count > 0) {
        rowOf(gameId).investigateCount += count;
      }
    }
    for (const row of flagged) {
      const gameId = String(row.gameId);
      if (after(gameId, row.at as Date)) {
        rowOf(gameId).flaggedCount += Number(row.count);
      }
    }
    const reminders = rescanReminderGamesOf([...rows.values()], activeGameIds);
    if (reminders.length === 0) {
      return [];
    }
    const games = await this.support.gamesOf(
      reader,
      reminders.map((row) => new Types.ObjectId(row.gameId)),
    );
    return reminders
      .map((row) => {
        const game = games.get(row.gameId);
        return {
          ...row,
          gameCode: game?.gameCode ?? "",
          gameName: game?.name ?? "",
        };
      })
      .toSorted((left, right) => left.gameCode.localeCompare(right.gameCode));
  }

  /**
   * 負責人提醒「全店重刷提醒」(8.3「另發負責人提醒給店長」;比照日結逾期,組織範圍 = 這家店):
   * 張數店的盤點送出時有 [標記異常]、核准時記了待查·未對號 → 一則,點進去是那家店的看板。
   * 同一張盤點單同一個原因只發一次(`dedupeKey`)。交易內呼叫時跟著交易提交。
   */
  async notify(
    reader: OperatorContext,
    store: StoreRef,
    gameIds: readonly Types.ObjectId[],
    key: string,
  ): Promise<void> {
    if (gameIds.length === 0 || store.tenantId === null) {
      return;
    }
    const mode = await this.countModes.modeOf(reader, store.orgId);
    if (!isMatchingCountMode(mode)) {
      return;
    }
    const [org, games] = await Promise.all([
      this.orgs.findById(reader, store.orgId),
      this.support.gamesOf(reader, gameIds),
    ]);
    if (org === null) {
      return;
    }
    const labels = [...games.values()]
      .map((game) => `${game.gameCode} ${game.name}`)
      .toSorted((left, right) => left.localeCompare(right));
    await this.notifications.notify({
      type: LOTTERY_RESCAN_REMINDER,
      tenantId: store.tenantId,
      orgId: store.orgId,
      params: { orgName: org.name, games: labels.join("、") },
      ref: { type: LOTTERY_STORE_BOARD_REF, id: String(store.orgId) },
      dedupeKey: `${LOTTERY_RESCAN_REMINDER}:${key}`,
    });
  }
}
