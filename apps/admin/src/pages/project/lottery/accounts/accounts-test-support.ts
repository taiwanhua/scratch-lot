import { authWorld, overviewModule } from "@/test/msw/auth-handlers";
import {
  ALL_ACCOUNTS_PERMISSIONS,
  accountsModules,
} from "@/test/msw/project/lottery/accounts-fixtures";
import {
  type AccountsWorldOptions,
  accountsWorld,
} from "@/test/msw/project/lottery/accounts-handlers";
import { masterDataOrgs } from "@/test/msw/project/lottery/master-data-fixtures";
import { masterDataSharedLookupHandlers } from "@/test/msw/project/lottery/master-data-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

/**
 * 帳戶管理測試的共用場景:路由、殼、守門都是真的,只有 api 是假的(`accountsWorld`)。
 * 當前組織 = 中山店。
 */
export const renderAccounts = ({
  path = "/accounts",
  permissions = ALL_ACCOUNTS_PERMISSIONS,
  viewPage = true,
  world = {},
}: {
  path?: string;
  permissions?: readonly string[];
  viewPage?: boolean;
  world?: AccountsWorldOptions;
} = {}) => {
  const fake = accountsWorld({ permissions, ...world });
  server.use(
    ...fake.handlers,
    ...masterDataSharedLookupHandlers(),
    ...authWorld({
      hasRefreshCookie: true,
      orgs: [masterDataOrgs.storeA],
      modules: [overviewModule, ...accountsModules({ permissions, viewPage })],
    }).handlers,
  );
  return { ...renderApp({ path }), fake };
};
