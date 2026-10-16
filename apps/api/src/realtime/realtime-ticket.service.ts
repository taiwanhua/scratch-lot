import { Inject, Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  REALTIME_TICKET_TTL_SECONDS,
  boardTopic,
  signRealtimeTicket,
  userTopic,
} from "@repo/domain/realtime";

import { OrgsRepository } from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { tenantIdOfOrg } from "../database/tenant-id";
import {
  PermissionResolver,
  holdsPermission,
} from "../permission/permission-resolver";
import {
  REALTIME_BOARDS,
  type RealtimeBoardRegistration,
} from "./realtime-board-registration";
import { realtimeHubOf } from "./realtime-publisher.service";
import { REALTIME_CONFIG, type RealtimeConfig } from "./realtime.config";

/** 簽發結果:前端拿 `ticket` 連 `connectUrl?ticket=`,或在原連線上換發。 */
export interface RealtimeTicketGrant {
  ticket: string;
  /** `wss://<REALTIME_URL 的 host>/connect`。 */
  connectUrl: string;
  /** 到期時間(Unix 秒)。 */
  expiresAt: number;
  /** 實際放進憑證的頻道(看板頁據此判斷是否換發到 `board:`)。 */
  topics: string[];
}

/** 讀組織用:orgs 以 `_id` 判定可見,這裡要的是組織本身的祖先(推導租戶),不受操作者範圍限制。 */
function orgReader(operator: OperatorContext): OperatorContext {
  return {
    actorId: operator.actorId,
    currentOrgId: operator.currentOrgId,
    visibleOrgIds: "all",
    managedOrgIds: "all",
    memberOrgIds: [],
    roleIds: [],
  };
}

function isVisible(operator: OperatorContext, orgId: Types.ObjectId): boolean {
  return (
    operator.visibleOrgIds === "all" ||
    operator.visibleOrgIds.some((visible) => visible.equals(orgId))
  );
}

/**
 * 訂閱憑證的簽發(底座規格第 4 章「訂閱憑證」):
 *
 * - **平常只放自己的頻道** `user:<操作者>`;通知、計數、列印結果都走它,與目前組織無關。
 * - **看板頻道按需換發**:帶 `boardOrgId` 時,兩件事都成立才多放 `board:<那家店>`:
 *   ① 持有專案登記的任一看板檢視權限(`project/realtime-boards.ts`);② 那家店在操作者的可見範圍內,
 *   且與憑證同一個租戶。不成立就只放 `user:<自己>`,不報錯(Durable Object 會拒絕訂閱)。
 * - 憑證對應的 Durable Object 是**目前組織所屬的租戶**(根組織 = 平台);切換到別的租戶後,
 *   下一次換發的憑證持有者不同,Durable Object 回 `ticket-mismatch`,前端改為重新連線。
 * - 效期 10 分鐘;不存資料庫。即時通道停用(未設定)或沒有登入主體時回 null,前端改 60 秒輪詢。
 */
@Injectable()
export class RealtimeTicketService {
  constructor(
    @Inject(REALTIME_CONFIG) private readonly config: RealtimeConfig,
    @Inject(REALTIME_BOARDS)
    private readonly boards: readonly RealtimeBoardRegistration[],
    private readonly permissions: PermissionResolver,
    private readonly orgs: OrgsRepository,
  ) {}

  async issue(
    operator: OperatorContext,
    boardOrgId: string | null,
    nowSeconds = Math.floor(Date.now() / 1000),
  ): Promise<RealtimeTicketGrant | null> {
    if (!this.config.enabled || operator.actorId === null) {
      return null;
    }
    const tenantId = await this.tenantOf(operator, operator.currentOrgId);
    const hub = realtimeHubOf(tenantId);
    const topics = [userTopic(String(operator.actorId))];
    if (
      boardOrgId !== null &&
      (await this.canWatchBoard(operator, hub, boardOrgId))
    ) {
      topics.push(boardTopic(boardOrgId));
    }
    const expiresAt = nowSeconds + REALTIME_TICKET_TTL_SECONDS;
    const ticket = await signRealtimeTicket(
      {
        tenantId: hub,
        userId: String(operator.actorId),
        exp: expiresAt,
        topics,
      },
      this.config.ticketSecret,
    );
    const connect = new URL("/connect", this.config.url);
    connect.protocol = connect.protocol === "http:" ? "ws:" : "wss:";
    return { ticket, connectUrl: connect.toString(), expiresAt, topics };
  }

  private async canWatchBoard(
    operator: OperatorContext,
    hub: string,
    boardOrgId: string,
  ): Promise<boolean> {
    if (
      this.boards.length === 0 ||
      operator.actorId === null ||
      !Types.ObjectId.isValid(boardOrgId)
    ) {
      return false;
    }
    const orgId = new Types.ObjectId(boardOrgId);
    if (!isVisible(operator, orgId)) {
      return false;
    }
    const resolution = await this.permissions.resolve(
      operator.actorId,
      operator.currentOrgId,
    );
    if (
      !this.boards.some((board) =>
        holdsPermission(resolution, board.permission),
      )
    ) {
      return false;
    }
    // 可見範圍是 "all"(根組織)時也只放同一個租戶的店:別的租戶的信號不會送進這個 Durable Object
    const org = await this.orgs.findById(orgReader(operator), orgId);
    return (
      org !== null &&
      realtimeHubOf(
        tenantIdOfOrg({ _id: org._id, ancestors: org.ancestors }),
      ) === hub
    );
  }

  private async tenantOf(
    operator: OperatorContext,
    orgId: Types.ObjectId | null,
  ): Promise<Types.ObjectId | null> {
    if (orgId === null) {
      return null;
    }
    const org = await this.orgs.findById(orgReader(operator), orgId);
    return org === null
      ? null
      : tenantIdOfOrg({ _id: org._id, ancestors: org.ancestors });
  }
}
