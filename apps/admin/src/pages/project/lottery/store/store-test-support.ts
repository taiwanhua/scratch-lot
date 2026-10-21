import { authWorld, overviewModule } from "@/test/msw/auth-handlers";
import { inventoryWorld } from "@/test/msw/project/lottery/inventory-handlers";
import { masterDataOrgs } from "@/test/msw/project/lottery/master-data-fixtures";
import { masterDataSharedLookupHandlers } from "@/test/msw/project/lottery/master-data-handlers";
import {
  STORE_ALL_PERMISSIONS,
  storeModules,
} from "@/test/msw/project/lottery/store-fixtures";
import {
  type StoreWorldOptions,
  storeWorld,
} from "@/test/msw/project/lottery/store-handlers";
import { scheduleSettingsWorld } from "@/test/msw/project/schedule-settings-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

/** 開班視窗的 [打卡] 看我的班表的打卡權限(給在店面管理的模組上,`hasPermission` 只看 key)。 */
export const MY_PUNCH = "schedule.my.punch";

/**
 * 店面管理測試的共用場景:路由、殼、守門都是真的,只有 api 是假的(`storeWorld`;下拉選項借庫存管理與
 * 排班設定的假 api)。當前組織 = 中山店;本機收銀點存在 jsdom 的 localStorage(各測試自己清)。
 */
export const renderStore = ({
  path = "/store",
  permissions = [...STORE_ALL_PERMISSIONS, MY_PUNCH],
  world = {},
}: {
  path?: string;
  permissions?: readonly string[];
  world?: StoreWorldOptions;
} = {}) => {
  const fake = storeWorld(world);
  server.use(
    ...fake.handlers,
    ...inventoryWorld().handlers,
    ...scheduleSettingsWorld().handlers,
    ...masterDataSharedLookupHandlers(),
    ...authWorld({
      hasRefreshCookie: true,
      orgs: [masterDataOrgs.storeA],
      modules: [overviewModule, ...storeModules(permissions)],
    }).handlers,
  );
  return { ...renderApp({ path }), fake };
};
