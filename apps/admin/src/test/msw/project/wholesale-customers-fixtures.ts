import {
  type LotteryWholesaleCustomerFieldsFragment,
  LotteryWholesaleCustomerStatus,
  ModuleSidebarType,
} from "@repo/graphql";

import type { TestModule } from "../auth-handlers";
import { iso, node, systemInfo } from "./dealers-fixtures";

/** 批售客戶分頁(經銷商管理)的測試 / mock 夾具。 */
export const WHOLESALE_CUSTOMER_TEST_ROUTES = {
  viewPage: "/dealers/wholesale-customer-view-page",
  createPage: "/dealers/wholesale-customer-create-page",
  editPage: "/dealers/wholesale-customer-edit-page",
} as const;

export const WHOLESALE_CUSTOMER_PERMISSIONS = [
  "dealers.wholesale-customers.create",
  "dealers.wholesale-customers.edit",
];

/** `me.modules`:批售客戶是掛在經銷商管理下的權限容器(接在 `dealersModules` 後面)。 */
export const wholesaleCustomerModules = (
  permissions: readonly string[] = WHOLESALE_CUSTOMER_PERMISSIONS,
): TestModule[] => {
  const hidden = ModuleSidebarType.Hidden;
  return [
    node(
      "m-wholesale",
      "dealers.wholesale-customers",
      "批售客戶",
      "m-dealers",
      hidden,
      5,
      null,
      permissions,
    ),
    node(
      "m-wholesale-view",
      "dealers.wholesale-customers.view-page",
      "批售客戶詳情",
      "m-wholesale",
      hidden,
      1,
      WHOLESALE_CUSTOMER_TEST_ROUTES.viewPage,
      [],
    ),
    node(
      "m-wholesale-create",
      "dealers.wholesale-customers.create-page",
      "新增批售客戶",
      "m-wholesale",
      hidden,
      2,
      WHOLESALE_CUSTOMER_TEST_ROUTES.createPage,
      [],
    ),
    node(
      "m-wholesale-edit",
      "dealers.wholesale-customers.edit-page",
      "編輯批售客戶",
      "m-wholesale",
      hidden,
      3,
      WHOLESALE_CUSTOMER_TEST_ROUTES.editPage,
      [],
    ),
  ];
};

const wholesaleCustomerBase = {
  __typename: "LotteryWholesaleCustomer" as const,
  licenseNo: null,
  contactName: null,
  phone: null,
  address: null,
  note: null,
  status: LotteryWholesaleCustomerStatus.Active,
  lastWholesaleAt: null,
  ...systemInfo,
  shareOrgs: [],
  isShared: false,
  abilities: {
    __typename: "LotteryWholesaleCustomerAbilities" as const,
    canEdit: true,
  },
};

/** 批售客戶(Figma DE-09 的示範資料);好運彩券行被批售單引用、刪除會被擋。 */
export const wholesaleCustomerFixtures: LotteryWholesaleCustomerFieldsFragment[] =
  [
    {
      ...wholesaleCustomerBase,
      id: "wholesale-1",
      storeName: "好運彩券行",
      licenseNo: "12345678",
      contactName: "林大明",
      phone: "0223456789",
      address: "新北市三重區重新路 3 段 88 號",
      note: "每月中旬來拿貨,習慣匯款",
      lastWholesaleAt: iso("2026-11-19"),
    },
    {
      ...wholesaleCustomerBase,
      id: "wholesale-2",
      storeName: "大發彩券行",
      contactName: "王美玲",
      phone: "0912345678",
    },
    {
      ...wholesaleCustomerBase,
      id: "wholesale-3",
      storeName: "吉利彩券行",
      licenseNo: "87654321",
      contactName: "陳志遠",
      phone: "0287654321",
      status: LotteryWholesaleCustomerStatus.Inactive,
      lastWholesaleAt: iso("2026-08-12"),
    },
  ];
