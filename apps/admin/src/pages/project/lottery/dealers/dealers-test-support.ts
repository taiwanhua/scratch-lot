import type { LotteryWholesaleCustomerFieldsFragment } from "@repo/graphql";

import { authWorld } from "@/test/msw/auth-handlers";
import {
  DEALERS_ALL_PERMISSIONS,
  DEALERS_CONTACT_PERMISSIONS,
  DEALERS_TEST_ROUTES,
  dealersModules,
} from "@/test/msw/project/dealers-fixtures";
import {
  type DealersWorldOptions,
  dealersWorld,
} from "@/test/msw/project/dealers-handlers";
import {
  WHOLESALE_CUSTOMER_PERMISSIONS,
  wholesaleCustomerModules,
} from "@/test/msw/project/wholesale-customers-fixtures";
import { wholesaleCustomersWorld } from "@/test/msw/project/wholesale-customers-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

/**
 * 經銷商管理各頁測試的共用場景(TEST-08):兩個旋鈕分開轉 —— 綁了哪些模組(進得去哪一頁)、
 * 持有哪些權限(頁內看得到什麼);逐筆的 [編輯] 看夾具的 `abilities`。
 */
export interface RenderDealersOptions {
  path?: string;
  permissions?: readonly string[];
  contactPermissions?: readonly string[];
  withContacts?: boolean;
  world?: DealersWorldOptions;
  wholesalePermissions?: readonly string[];
  withWholesaleCustomers?: boolean;
  wholesaleCustomers?: LotteryWholesaleCustomerFieldsFragment[];
}

export const renderDealers = ({
  path = DEALERS_TEST_ROUTES.list,
  permissions = DEALERS_ALL_PERMISSIONS,
  contactPermissions = DEALERS_CONTACT_PERMISSIONS,
  withContacts = true,
  world = {},
  wholesalePermissions = WHOLESALE_CUSTOMER_PERMISSIONS,
  withWholesaleCustomers = true,
  wholesaleCustomers,
}: RenderDealersOptions = {}) => {
  const fake = dealersWorld(world);
  const wholesale = wholesaleCustomersWorld(wholesaleCustomers);
  server.use(
    ...fake.handlers,
    ...wholesale.handlers,
    ...authWorld({
      hasRefreshCookie: true,
      modules: [
        ...dealersModules(permissions, contactPermissions, { withContacts }),
        ...(withWholesaleCustomers
          ? wholesaleCustomerModules(wholesalePermissions)
          : []),
      ],
    }).handlers,
  );
  return { ...renderApp({ path }), fake, wholesale };
};

export { DEALERS_TEST_ROUTES } from "@/test/msw/project/dealers-fixtures";
