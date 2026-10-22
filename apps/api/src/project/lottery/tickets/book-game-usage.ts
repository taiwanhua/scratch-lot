import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { OrgsRepository } from "../../../database/database.module";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { LotteryBooksRepository } from "../../database/lottery-inventory/lottery-inventory.repository";
import { registerGameUsageChecker } from "../games/game-usage";

/** 登記名(`game-usage.ts` 全域唯一)。 */
export const BOOK_GAME_USAGE_CHECKER = "lottery-books";

/**
 * 向檔案管理登記「有本引用這個遊戲」(專案規格 5.1:有庫存後代號、面額、張數鎖定,不能刪除)。
 * 問的是整個租戶有沒有(不是操作者看得到的那一部分),用租戶內存在性檢查 `existsInTenant`
 * (呼叫端登記在專案入口 `project/database/tenant-boundary-callers.ts`)。
 */
@Injectable()
export class BookGameUsage implements OnModuleInit, OnModuleDestroy {
  private unregister: (() => void) | undefined;

  constructor(
    private readonly books: LotteryBooksRepository,
    private readonly orgs: OrgsRepository,
  ) {}

  onModuleInit(): void {
    this.unregister = registerGameUsageChecker(
      BOOK_GAME_USAGE_CHECKER,
      async (tenantId, gameId) => {
        if (tenantId === null) {
          return false;
        }
        // 沒有操作者(遊戲的鎖定檢查問的是整個租戶):租戶邊界上下文的系統身分
        const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
        return this.books.existsInTenant(reader, tenantId, { gameId });
      },
    );
  }

  onModuleDestroy(): void {
    this.unregister?.();
    this.unregister = undefined;
  }
}
