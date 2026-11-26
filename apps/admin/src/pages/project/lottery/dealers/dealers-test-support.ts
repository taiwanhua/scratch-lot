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
import { purchasingModules } from "@/test/msw/project/lottery/purchasing-fixtures";
import { wholesaleModules } from "@/test/msw/project/lottery/wholesale-fixtures";
import { wholesaleWorld } from "@/test/msw/project/lottery/wholesale-handlers";
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
  /** 另有批售單模組(批售客戶詳情的「批售紀錄」);`omit` = 拿掉的權限 */
  withWholesaleDocuments?: { omit?: readonly string[] };
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
  withWholesaleDocuments,
}: RenderDealersOptions = {}) => {
  const fake = dealersWorld(world);
  const wholesale = wholesaleCustomersWorld(wholesaleCustomers);
  server.use(
    ...fake.handlers,
    ...wholesale.handlers,
    ...(withWholesaleDocuments === undefined
      ? []
      : wholesaleWorld({ settlement: "none" }).handlers),
    ...authWorld({
      hasRefreshCookie: true,
      modules: [
        ...dealersModules(permissions, contactPermissions, { withContacts }),
        ...(withWholesaleCustomers
          ? wholesaleCustomerModules(wholesalePermissions)
          : []),
        ...(withWholesaleDocuments === undefined
          ? []
          : [
              ...purchasingModules(),
              ...wholesaleModules(withWholesaleDocuments.omit),
            ]),
      ],
    }).handlers,
  );
  return { ...renderApp({ path }), fake, wholesale };
};

export { DEALERS_TEST_ROUTES } from "@/test/msw/project/dealers-fixtures";
