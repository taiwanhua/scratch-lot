import { Injectable, Logger } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  REALTIME_PUBLISH_BODY_MAX_LENGTH,
  type RealtimePublishRequest,
  type RealtimeSignal,
  isRealtimeSignal,
  isRealtimeTopic,
  userTopic,
} from "@repo/domain/realtime";

import {
  afterCommit,
  assertOutsideTransaction,
  currentSession,
} from "../database/transaction";
import { RealtimeTransport } from "./realtime-transport";
import { SignalCoalescer } from "./signal-coalescer";

/** 送出端認得的租戶識別:ObjectId、字串,或 null(根組織 = 平台)。 */
export type RealtimeTenant = Types.ObjectId | string | null;

/**
 * 根組織(平台)不屬於任何租戶(`tenantIdOfOrg` 回 null),它的連線與信號共用這個 Durable Object 名稱;
 * 簽發訂閱憑證與送出信號都經 `realtimeHubOf`,兩邊一定對得上。
 */
export const REALTIME_PLATFORM_HUB = "platform";

/** 租戶 id → Durable Object 名稱的那一段(`hub:<這個值>`)。 */
export function realtimeHubOf(tenantId: RealtimeTenant): string {
  return tenantId === null ? REALTIME_PLATFORM_HUB : String(tenantId);
}

/** 側欄計數的信號類型:`badge:<模組 key>`(底座規格 10.4)。 */
export function badgeSignalType(moduleKey: string): string {
  return `badge:${moduleKey}`;
}

/** 把頻道切成 body 不超過 `/publish` 上限的批次(每批一次請求)。 */
export function chunkTopics(
  hub: string,
  topics: readonly string[],
  signal: RealtimeSignal,
): string[][] {
  const overhead = JSON.stringify({
    tenantId: hub,
    topics: [],
    signal,
  } satisfies RealtimePublishRequest).length;
  const chunks: string[][] = [];
  let current: string[] = [];
  let size = overhead;
  for (const topic of topics) {
    // 每個頻道佔 `"<topic>",`;頻道名只有英數、底線、連字號與冒號,不必跳脫
    const cost = topic.length + 3;
    if (current.length > 0 && size + cost > REALTIME_PUBLISH_BODY_MAX_LENGTH) {
      chunks.push(current);
      current = [];
      size = overhead;
    }
    current.push(topic);
    size += cost;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

/**
 * 送出信號(底座規格第 4 章):API → Worker `/publish`,一次可帶多個頻道。
 *
 * - **交易後執行**:`publish` 是對外 adapter 的入口,先 `assertOutsideTransaction`(TX-03);
 *   交易內一律用 `publishAfterCommit`(掛 `afterCommit`,交易回復就不送)。
 * - **盡力而為**:Worker 連不上、逾時、回非 2xx 都只記 log,不拋錯、不影響已提交的資料;
 *   前端斷線時改 60 秒輪詢,重連後補抓,所以漏一次信號不會讓畫面停在舊資料。
 * - **合併**:只有看板(`board`)同一頻道每 2 秒最多送一次,窗內丟棄(`SignalCoalescer`);其他類型照送。
 * - 信號只有類型與編號(RT-02),格式不對直接拒絕(程式錯誤,拋錯)。
 */
@Injectable()
export class RealtimePublisher {
  private readonly logger = new Logger(RealtimePublisher.name);
  private readonly coalescer = new SignalCoalescer();

  constructor(private readonly transport: RealtimeTransport) {}

  /** 立即送出(不在交易內)。`tenantId` 為 null = 根組織(平台)。 */
  async publish(
    tenantId: RealtimeTenant,
    topics: readonly string[],
    signal: RealtimeSignal,
  ): Promise<void> {
    assertOutsideTransaction("送出即時信號");
    if (!isRealtimeSignal(signal)) {
      throw new Error(
        `信號格式錯誤(只能有 type 與 id):${JSON.stringify(signal)}`,
      );
    }
    const unique = [...new Set(topics)];
    const invalid = unique.filter((topic) => !isRealtimeTopic(topic));
    if (invalid.length > 0) {
      throw new Error(`頻道格式錯誤:${invalid.join(",")}`);
    }
    const hub = realtimeHubOf(tenantId);
    const selected = this.coalescer.select(hub, unique, signal);
    if (selected.length === 0) {
      return;
    }
    await this.send(hub, selected, signal);
  }

  /** 在目前交易登記「提交後送出」;不在交易內呼叫即拋錯(同 `afterCommit`)。 */
  publishAfterCommit(
    tenantId: RealtimeTenant,
    topics: readonly string[],
    signal: RealtimeSignal,
  ): void {
    const snapshot = [...topics];
    afterCommit(() => this.publish(tenantId, snapshot, signal));
  }

  /**
   * 側欄計數有變:對這些使用者送 `badge:<模組 key>`,一次 `/publish` 帶多個 `user:<id>` 頻道(10.4)。
   * 在交易內呼叫 → 交易提交後才送(回復不送);不在交易內(排程、未改交易的流程)→ 立即送。
   */
  async publishBadge(
    tenantId: RealtimeTenant,
    moduleKey: string,
    userIds: readonly (Types.ObjectId | string)[],
  ): Promise<void> {
    const topics = userIds.map((id) => userTopic(String(id)));
    const signal = { type: badgeSignalType(moduleKey) };
    if (currentSession() === undefined) {
      await this.publish(tenantId, topics, signal);
      return;
    }
    this.publishAfterCommit(tenantId, topics, signal);
  }

  private async send(
    hub: string,
    topics: readonly string[],
    signal: RealtimeSignal,
  ): Promise<void> {
    for (const batch of chunkTopics(hub, topics, signal)) {
      try {
        await this.transport.send({ tenantId: hub, topics: batch, signal });
      } catch (error) {
        this.logger.warn(
          `送出即時信號失敗(盡力而為,不影響已提交的資料):${signal.type} → ${String(batch.length)} 個頻道:${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
