import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import type { TestModule } from "./auth-handlers";

/**
 * 輸出報表模組(seed `apps/db-migrator/seeds/base/modules/reports.ts`):頂層 link、固定頁。
 * 權限由呼叫端給(報表各自的 `reports.<報表 key>`、`reports.export`、`reports.show-cost`;mock 模式給滿)。
 */
export const reportsModule = (
  permissions: readonly string[] = ["reports.*"],
): TestModule => ({
  id: "m-reports",
  key: "reports",
  name: "輸出報表",
  parentId: null,
  sidebarType: ModuleSidebarType.Link,
  engine: ModuleEngine.Fixed,
  order: 50,
  route: "/reports",
  icon: "chart",
  permissions: [...permissions],
});
