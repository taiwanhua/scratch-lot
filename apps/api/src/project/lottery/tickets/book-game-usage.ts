import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { OrgsRepository } from "../../../database/database.module";
import { systemTenantReader } from "../../../database/system-tenant-reader";
import { LotteryBooksRepository } from "../../database/lottery-inventory/lottery-inventory.repository";
import { registerGameUsageChecker } from "../games/game-usage";

/** 登記名(`game-usage.ts` 全域唯一)。 */
export const BOOK_GAME_USAGE_CHECKER = "lottery-books";

/**
 * 向檔案管理登記「有本引用這個遊戲」(專案規格 5.1:有庫存後代號、面額、張數鎖定,不能刪除)。
 * 問的是整個租戶有沒有(不是操作者看得到的那一部分),用租戶內存在性檢查 `existsInTenant`
 * (呼叫端登記在 `TENANT_BOUNDARY_CALLERS`);根組織建的遊戲沒有租戶,不會有本。
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
        const reader = await systemTenantReader(this.orgs, tenantId);
        return this.books.existsInTenant(reader, tenantId, "gameId", gameId);
      },
    );
  }

  onModuleDestroy(): void {
    this.unregister?.();
    this.unregister = undefined;
  }
}
