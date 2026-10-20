import { Injectable, Module, type OnModuleInit } from "@nestjs/common";

import { SidebarBadgeRegistry } from "../sidebar-badge-registry";
import { SidebarBadgesModule } from "../sidebar-badges.module";

/** 探針計數的數字(`demo.form`:一般流程測試使用者持有 `demo.form.*`)。 */
export const PROBE_BADGE_COUNT = 7;

/** 計算一律拋錯的探針(`system.workflows`:只有流程測試的租戶管理員看得到)。 */
export const FAILING_BADGE_MODULE = "system.workflows";

@Injectable()
class ProbeBadges implements OnModuleInit {
  constructor(private readonly registry: SidebarBadgeRegistry) {}

  onModuleInit(): void {
    this.registry.registerBadge({
      moduleKey: "demo.form",
      count: () => Promise.resolve(PROBE_BADGE_COUNT),
    });
    this.registry.registerBadge({
      moduleKey: FAILING_BADGE_MODULE,
      count: () => Promise.reject(new Error("探針:計算失敗")),
    });
  }
}

/** 測試專用(TEST-07 的 `extraModules`):登記兩筆探針計數,驗模組過濾(綁了模組才算)與單筆失敗不拖垮整份。 */
@Module({
  imports: [SidebarBadgesModule],
  providers: [ProbeBadges],
})
export class ProbeBadgesModule {}
