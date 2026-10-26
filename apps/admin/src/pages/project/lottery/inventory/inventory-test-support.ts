import type { ReactNode } from "react";

import { authWorld, overviewModule } from "@/test/msw/auth-handlers";
import {
  ALL_INVENTORY_PERMISSIONS,
  inventoryModules,
} from "@/test/msw/project/lottery/inventory-fixtures";
import {
  type InventoryWorldOptions,
  inventoryWorld,
} from "@/test/msw/project/lottery/inventory-handlers";
import {
  masterDataModules,
  masterDataOrgs,
} from "@/test/msw/project/lottery/master-data-fixtures";
import {
  masterDataSharedLookupHandlers,
  masterDataWorld,
} from "@/test/msw/project/lottery/master-data-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

/**
 * 庫存管理測試的共用場景:路由、殼、守門都是真的,只有 api 是假的(`inventoryWorld`)。
 * 當前組織 = 中山店。
 */
export const renderInventory = ({
  path = "/inventory",
  permissions = ALL_INVENTORY_PERMISSIONS,
  bookPage = true,
  inventory = true,
  masterData = false,
  world = {},
  extra,
}: {
  path?: string;
  permissions?: readonly string[];
  bookPage?: boolean;
  /** 綁不綁庫存管理 */
  inventory?: boolean;
  /** 另外綁檔案管理(遊戲詳情的庫存分頁) */
  masterData?: boolean;
  world?: InventoryWorldOptions;
  /** 額外掛在路由旁的元件(例:單獨測共用對話框) */
  extra?: ReactNode;
} = {}) => {
  const fake = inventoryWorld({ permissions, ...world });
  server.use(
    ...fake.handlers,
    ...masterDataWorld().handlers,
    ...masterDataSharedLookupHandlers(),
    ...authWorld({
      hasRefreshCookie: true,
      orgs: [masterDataOrgs.storeA],
      modules: [
        overviewModule,
        ...(inventory ? inventoryModules({ permissions, bookPage }) : []),
        ...(masterData ? masterDataModules() : []),
      ],
    }).handlers,
  );
  return { ...renderApp({ path, extra }), fake };
};
