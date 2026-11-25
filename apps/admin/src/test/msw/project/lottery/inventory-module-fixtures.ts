import {
  INVENTORY_MODULE_KEYS as KEYS,
  INVENTORY_PERMISSIONS as PERMISSIONS,
} from "@repo/domain/project/lottery";
import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import type { TestModule } from "../../auth-handlers";

/** 庫存管理全部權限(與 `inventory-fixtures` 同一份)。 */
const ALL_INVENTORY_PERMISSIONS = Object.values(PERMISSIONS);

const module = (
  key: string,
  name: string,
  parentId: string | null,
  route: string,
  permissions: readonly string[],
  sidebarType = ModuleSidebarType.Hidden,
): TestModule => ({
  __typename: "MeModule",
  id: `m-${key}`,
  key,
  name,
  parentId,
  sidebarType,
  engine: ModuleEngine.Fixed,
  order: 20,
  route,
  icon: "inventory",
  permissions: [...permissions],
});

/** 庫存管理的模組(與 seed 宣告一致):列表 + 本的詳情;`bookPage` 決定綁不綁詳情頁。 */
export const inventoryModules = ({
  permissions = ALL_INVENTORY_PERMISSIONS,
  bookPage = true,
}: {
  permissions?: readonly string[];
  bookPage?: boolean;
} = {}): TestModule[] => {
  const root = module(
    KEYS.list,
    "庫存管理",
    null,
    "/inventory",
    permissions,
    ModuleSidebarType.Link,
  );
  return [
    root,
    ...(bookPage
      ? [module(KEYS.bookPage, "本的詳情", root.id, "/inventory/book-page", [])]
      : []),
  ];
};
