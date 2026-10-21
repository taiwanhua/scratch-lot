import type { Types } from "mongoose";

import { STORE_BOARD_SIGNAL } from "@repo/domain/project/lottery";
import { boardTopic } from "@repo/domain/realtime";

import { currentSession } from "../../../database/transaction";
import type { RealtimePublisher } from "../../../realtime/realtime-publisher.service";

/**
 * 看板有變(開班、投庫、出庫…):對 `board:<分店>` 送 `board` 信號(不帶資料,RT-02;每 2 秒合併,RT-05)。
 * 在交易內 → 提交後才送(回復不送);交易外 → 立即送(盡力而為,送不出去只記 log)。
 */
export async function publishStoreBoard(
  realtime: RealtimePublisher,
  tenantId: Types.ObjectId | null,
  orgId: Types.ObjectId,
): Promise<void> {
  const topics = [boardTopic(String(orgId))];
  const signal = { type: STORE_BOARD_SIGNAL };
  if (currentSession() === undefined) {
    await realtime.publish(tenantId, topics, signal);
    return;
  }
  realtime.publishAfterCommit(tenantId, topics, signal);
}
