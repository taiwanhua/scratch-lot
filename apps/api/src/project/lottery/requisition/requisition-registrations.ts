import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import {
  REQUISITION_FIELD_KEYS,
  REQUISITION_FORM_KEY,
  REQUISITION_MODULE_KEY,
} from "@repo/domain/project/lottery";

import {
  FormSubmissionsRepository,
  OrgsRepository,
} from "../../../database/database.module";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { LotteryRequisitionLinesRepository } from "../../database/lottery-requisitions/lottery-requisition-lines.repository";
import { registerGameUsageChecker } from "../games/game-usage";
import { registerInTransitSource } from "./in-transit";

/** 登記名(`game-usage.ts`、`in-transit.ts` 各自全域唯一)。 */
export const REQUISITION_GAME_USAGE_CHECKER = "lottery-requisitions";
export const REQUISITION_IN_TRANSIT_SOURCE = "lottery-requisitions";

/** 「被叫貨單引用過」算哪些狀態:草稿不算(還沒成立,規格 8 共通「草稿」),其餘都算(含已作廢 / 已駁回)。 */
const USAGE_STATUSES = [
  "reviewing",
  "returned",
  "withdrawn",
  "completed",
  "rejected",
  "voided",
] as const;

/** 明細裡遊戲引用的存值路徑(`{ id, label }` 的 id)。 */
const GAME_ID_PATH = `values.${REQUISITION_FIELD_KEYS.lines}.${REQUISITION_FIELD_KEYS.game}.id`;

/**
 * 叫貨單向其他功能登記的兩件事(專案規格 5.1、8.1):
 *
 * - **遊戲引用檢查**(`game-usage.ts`):有叫貨單(草稿以外)引用過這個遊戲 → 遊戲「有庫存」,
 *   代號、面額、張數鎖定、不能刪除。問的是整個租戶,用租戶內存在性檢查 `existsInTenant`
 * - **在途來源**(`in-transit.ts`):這家店「待購買」的叫貨單本數(有效且未被引用的副本列)
 *
 * 兩者都沒有操作者,讀取用租戶邊界上下文的系統身分(呼叫端登記在 `project/database/tenant-boundary-callers.ts`)。
 */
@Injectable()
export class RequisitionRegistrations implements OnModuleInit, OnModuleDestroy {
  private readonly unregister: (() => void)[] = [];

  constructor(
    private readonly submissions: FormSubmissionsRepository,
    private readonly lines: LotteryRequisitionLinesRepository,
    private readonly orgs: OrgsRepository,
  ) {}

  onModuleInit(): void {
    this.unregister.push(
      registerGameUsageChecker(
        REQUISITION_GAME_USAGE_CHECKER,
        async (tenantId, gameId) => {
          if (tenantId === null) {
            return false;
          }
          const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
          for (const status of USAGE_STATUSES) {
            const found = await this.submissions.existsInTenant(
              reader,
              tenantId,
              {
                moduleKey: REQUISITION_MODULE_KEY,
                formKey: REQUISITION_FORM_KEY,
                status,
                [GAME_ID_PATH]: String(gameId),
              },
            );
            if (found) {
              return true;
            }
          }
          return false;
        },
      ),
      registerInTransitSource(
        REQUISITION_IN_TRANSIT_SOURCE,
        async ({ tenantId, orgId }) => {
          const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
          const rows = await this.lines.aggregate(reader, [
            { $match: { orgId, voidedAt: null, referencedBy: null } },
            { $group: { _id: "$gameId", books: { $sum: "$books" } } },
          ]);
          return new Map(
            rows.map((row) => [String(row._id), Number(row.books)]),
          );
        },
      ),
    );
  }

  onModuleDestroy(): void {
    for (const unregister of this.unregister.splice(0)) {
      unregister();
    }
  }
}
