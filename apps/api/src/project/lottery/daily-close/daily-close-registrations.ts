import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { OrgsRepository } from "../../../database/database.module";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { registerVaultBaselineProvider } from "../cash/cash-ledger.service";
import { registerDailyCloseCoverage } from "../store/previous-shift";
import { DailyCloseLedger } from "./daily-close-ledger";

/**
 * 日結向其他功能登記的事(沒有操作者,以租戶邊界的系統身分讀):
 *
 * - **小金庫起算點**(帳戶管理 `registerVaultBaselineProvider`;規格 10.2):最近一次**已完成**日結的清點金額,
 *   起算時間 = 那張日結**最後一次送出**的時間(清點那一刻;之後的流水 —— 含完成時寫的「存銀行」—— 照常加總)
 * - **第一班的判斷**(店面 `registerDailyCloseCoverage`;規格 6.6):上一班已被送出的日結涵蓋計算
 */
@Injectable()
export class DailyCloseRegistrations implements OnModuleInit, OnModuleDestroy {
  private readonly unregister: (() => void)[] = [];

  constructor(
    private readonly dailyLedger: DailyCloseLedger,
    private readonly orgs: OrgsRepository,
  ) {}

  onModuleInit(): void {
    this.unregister.push(
      registerVaultBaselineProvider(async (tenantId, orgId) => {
        if (tenantId === null) {
          return null;
        }
        const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
        const last = await this.dailyLedger.lastConfirmedDaily(reader, orgId);
        return last === null
          ? null
          : { amount: last.counted, since: last.submittedAt };
      }),
      registerDailyCloseCoverage(async (tenantId, shiftId) => {
        if (tenantId === null) {
          return false;
        }
        const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
        return this.dailyLedger.isShiftCovered(reader, shiftId);
      }),
    );
  }

  onModuleDestroy(): void {
    for (const undo of this.unregister.splice(0)) {
      undo();
    }
  }
}
