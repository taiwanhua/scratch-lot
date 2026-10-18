import { Args, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../auth/decorators";
import type { OperatorContext } from "../database/operator-context";
import {
  RealtimeBoardInput,
  RealtimeTicketPayload,
} from "./models/realtime-ticket.model";
import { RealtimeTicketService } from "./realtime-ticket.service";

/**
 * 即時通道的訂閱憑證:登入者都可以拿(只含自己的頻道),不需要模組權限;
 * `board` 是看板頁換發用(看板 key + 店),資格看那個看板登記的權限;條件不符時照樣回憑證、只是不含 `board:`。
 * 即時通道停用(未設定)時回 null,前端改 60 秒輪詢。
 */
@Resolver()
export class RealtimeResolver {
  constructor(private readonly tickets: RealtimeTicketService) {}

  @Query(() => RealtimeTicketPayload, {
    name: "realtimeTicket",
    nullable: true,
  })
  realtimeTicket(
    @CurrentOperator() operator: OperatorContext,
    @Args("board", { type: () => RealtimeBoardInput, nullable: true })
    board?: RealtimeBoardInput | null,
  ): Promise<RealtimeTicketPayload | null> {
    return this.tickets.issue(operator, board ?? null);
  }
}
