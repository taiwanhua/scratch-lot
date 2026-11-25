import { INVENTORY_MODULE_KEYS as KEYS } from "@repo/domain/project/lottery";
import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import type { TestModule } from "../../auth-handlers";

/** 期初建檔頁的模組(隱藏頁,掛在庫存管理下;與 seed 宣告一致)。 */
export const openingPageModule = (): TestModule => ({
  __typename: "MeModule",
  id: `m-${KEYS.openingPage}`,
  key: KEYS.openingPage,
  name: "期初建檔",
  parentId: `m-${KEYS.list}`,
  sidebarType: ModuleSidebarType.Hidden,
  engine: ModuleEngine.Fixed,
  order: 20,
  route: "/inventory/opening-page",
  icon: "inventory",
  permissions: [],
});
