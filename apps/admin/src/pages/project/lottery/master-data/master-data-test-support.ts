import { authWorld, overviewModule } from "@/test/msw/auth-handlers";
import {
  ALL_MASTER_DATA_PERMISSIONS,
  masterDataModules,
  masterDataOrgs,
} from "@/test/msw/project/lottery/master-data-fixtures";
import {
  type MasterDataWorldOptions,
  masterDataSharedLookupHandlers,
  masterDataWorld,
} from "@/test/msw/project/lottery/master-data-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

/**
 * 檔案管理測試的共用場景:路由、殼、守門都是真的,只有 api 是假的(`masterDataWorld`)。
 * 當前組織 = 中山店。
 */
export const renderMasterData = ({
  path = "/master-data",
  permissions = ALL_MASTER_DATA_PERMISSIONS,
  games = true,
  cashPoints = true,
  world = {},
}: {
  path?: string;
  permissions?: readonly string[];
  games?: boolean;
  cashPoints?: boolean;
  world?: MasterDataWorldOptions;
} = {}) => {
  const fake = masterDataWorld({ permissions, ...world });
  server.use(
    ...fake.handlers,
    ...masterDataSharedLookupHandlers(),
    ...authWorld({
      hasRefreshCookie: true,
      orgs: [masterDataOrgs.storeA],
      modules: [
        overviewModule,
        ...masterDataModules({ permissions, games, cashPoints }),
      ],
    }).handlers,
  );
  return { ...renderApp({ path }), fake };
};
