import {
  LotteryContactRole,
  LotteryContactStatus,
  type LotteryDealerContactFieldsFragment,
  type LotteryDealerFieldsFragment,
  LotteryDealerStatus,
  LotteryDealerType,
  LotteryLicenseState,
  LotteryRentCycle,
  ModuleEngine,
  ModuleSidebarType,
} from "@repo/graphql";

import type { TestModule } from "../auth-handlers";

/**
 * 經銷商管理的測試 / mock 夾具(Figma DE-01–DE-08 的示範資料:陳志明、林大同、張美華、好運 2 / 3 號店、
 * 關係人陳小芳、林小玉、吳介紹)。元件測試與 mock 模式共用(TEST-08)。
 */

/** 模組 key 與完整路由(`me.modules` 的形狀;關係人是權限容器,沒有路由)。 */
export const DEALERS_TEST_ROUTES = {
  list: "/dealers",
  viewPage: "/dealers/view-page",
  createPage: "/dealers/create-page",
  editPage: "/dealers/edit-page",
  contactViewPage: "/dealers/contact-view-page",
  contactCreatePage: "/dealers/contact-create-page",
  contactEditPage: "/dealers/contact-edit-page",
} as const;

/** 全部權限(總部管理);欄位級權限另外列,測試可以拿掉。 */
export const DEALERS_ALL_PERMISSIONS = [
  "dealers.create",
  "dealers.edit",
  "dealers.show-last-purchase-base-date",
  "dealers.edit-last-purchase-base-date",
  "dealers.show-last-self-purchase-base-date",
  "dealers.edit-last-self-purchase-base-date",
];

export const DEALERS_CONTACT_PERMISSIONS = [
  "dealers.contacts.create",
  "dealers.contacts.edit",
];

const node = (
  id: string,
  key: string,
  name: string,
  parentId: string | null,
  sidebarType: ModuleSidebarType,
  order: number,
  route: string | null,
  permissions: readonly string[],
): TestModule => ({
  id,
  key,
  name,
  parentId,
  sidebarType,
  engine: ModuleEngine.Fixed,
  order,
  route,
  icon: sidebarType === ModuleSidebarType.Link ? "people" : null,
  permissions: [...permissions],
});

/** `me.modules`:經銷商管理的模組樹;`permissions` / `contactPermissions` 分別掛在兩個節點上。 */
export const dealersModules = (
  permissions: readonly string[] = DEALERS_ALL_PERMISSIONS,
  contactPermissions: readonly string[] = DEALERS_CONTACT_PERMISSIONS,
  options: { withContacts?: boolean } = {},
): TestModule[] => {
  const hidden = ModuleSidebarType.Hidden;
  const tree = [
    node(
      "m-dealers",
      "dealers",
      "經銷商管理",
      null,
      ModuleSidebarType.Link,
      60,
      DEALERS_TEST_ROUTES.list,
      permissions,
    ),
    node(
      "m-dealers-view",
      "dealers.view-page",
      "經銷商詳情",
      "m-dealers",
      hidden,
      1,
      DEALERS_TEST_ROUTES.viewPage,
      [],
    ),
    node(
      "m-dealers-create",
      "dealers.create-page",
      "新增經銷商",
      "m-dealers",
      hidden,
      2,
      DEALERS_TEST_ROUTES.createPage,
      [],
    ),
    node(
      "m-dealers-edit",
      "dealers.edit-page",
      "編輯經銷商",
      "m-dealers",
      hidden,
      3,
      DEALERS_TEST_ROUTES.editPage,
      [],
    ),
  ];
  if (options.withContacts === false) {
    return tree;
  }
  return [
    ...tree,
    node(
      "m-contacts",
      "dealers.contacts",
      "關係人",
      "m-dealers",
      hidden,
      4,
      null,
      contactPermissions,
    ),
    node(
      "m-contacts-view",
      "dealers.contacts.view-page",
      "關係人詳情",
      "m-contacts",
      hidden,
      1,
      DEALERS_TEST_ROUTES.contactViewPage,
      [],
    ),
    node(
      "m-contacts-create",
      "dealers.contacts.create-page",
      "新增關係人",
      "m-contacts",
      hidden,
      2,
      DEALERS_TEST_ROUTES.contactCreatePage,
      [],
    ),
    node(
      "m-contacts-edit",
      "dealers.contacts.edit-page",
      "編輯關係人",
      "m-contacts",
      hidden,
      3,
      DEALERS_TEST_ROUTES.contactEditPage,
      [],
    ),
  ];
};

const day = (date: string) => `${date}T00:00:00.000+08:00`;
const iso = (date: string) => new Date(day(date)).toISOString();

const abilities = {
  canEdit: true,
  canEditLastPurchaseBaseDate: true,
  canEditLastSelfPurchaseBaseDate: true,
};

const contactRef = (id: string, name: string) => ({
  __typename: "LotteryDealerContactRef" as const,
  id,
  name,
  status: LotteryContactStatus.Active,
});

const dealerBase = {
  __typename: "LotteryDealer" as const,
  status: LotteryDealerStatus.Active,
  licenseApprovedAt: iso("2024-03-01"),
  licenseExpiresAt: iso("2027-02-28"),
  licenseState: LotteryLicenseState.Ok,
  coSalesDealer: null,
  agents: [],
  trustees: [],
  introducers: [],
  lastPurchaseBaseDate: null,
  lastSelfPurchaseBaseDate: null,
  lastPurchaseDate: null,
  lastSelfPurchaseDate: null,
  daysSinceLastPurchase: null,
  daysSinceLastSelfPurchase: null,
  currentQuarterSigned: null,
  storeOrg: null,
  storeName: null,
  businessAddress: null,
  storePhone: null,
  terminalNo: null,
  coSellerCount: null,
  rentFee: null,
  rentCycle: null,
  rentStartMonth: null,
  rentDueDay: null,
  nextRentDueAt: null,
  birthday: null,
  phone: null,
  mobile: null,
  email: null,
  mailingAddress: null,
  residentialAddress: null,
  residentialSameAsMailing: false,
  note: null,
  createdBy: {
    __typename: "LotteryDealerUserRef" as const,
    id: "u-1",
    name: "王總",
  },
  createdAt: iso("2026-09-01"),
  updatedAt: iso("2026-09-01"),
  abilities,
} satisfies Partial<LotteryDealerFieldsFragment>;

const storeTwo = {
  __typename: "LotteryDealerRef" as const,
  id: "dealer-b-2",
  type: LotteryDealerType.B,
  licenseNo: "11112222",
  name: "王大明",
  storeName: "好運 2 號店",
  status: LotteryDealerStatus.Active,
};

export const dealerFixtures: LotteryDealerFieldsFragment[] = [
  {
    ...dealerBase,
    id: "dealer-a-1",
    type: LotteryDealerType.A,
    licenseNo: "12345678",
    name: "陳志明",
    coSalesDealer: storeTwo,
    agents: [
      contactRef("contact-1", "陳小芳"),
      contactRef("contact-2", "林小玉"),
    ],
    trustees: [contactRef("contact-1", "陳小芳")],
    lastPurchaseBaseDate: iso("2026-05-17"),
    lastSelfPurchaseBaseDate: iso("2026-05-17"),
    lastPurchaseDate: iso("2026-10-04"),
    lastSelfPurchaseDate: iso("2026-05-17"),
    daysSinceLastPurchase: 12,
    daysSinceLastSelfPurchase: 152,
    currentQuarterSigned: true,
    nationalId: "A123456789",
    mobile: "0912345678",
  },
  {
    ...dealerBase,
    id: "dealer-a-2",
    type: LotteryDealerType.A,
    licenseNo: "87654321",
    name: "林大同",
    daysSinceLastPurchase: 183,
    lastPurchaseDate: iso("2026-04-15"),
    currentQuarterSigned: false,
    nationalId: "A223456789",
  },
  {
    ...dealerBase,
    id: "dealer-a-3",
    type: LotteryDealerType.A,
    licenseNo: "23456789",
    name: "張美華",
    status: LotteryDealerStatus.Suspended,
    coSalesDealer: {
      ...storeTwo,
      id: "dealer-b-3",
      storeName: "好運 3 號店",
      licenseNo: "33334444",
      name: "李小英",
    },
    daysSinceLastPurchase: 30,
    daysSinceLastSelfPurchase: 30,
    currentQuarterSigned: true,
    nationalId: "A323456789",
  },
  {
    ...dealerBase,
    id: "dealer-b-2",
    type: LotteryDealerType.B,
    licenseNo: "11112222",
    name: "王大明",
    storeName: "好運 2 號店",
    storeOrg: {
      __typename: "LotteryDealerOrgRef",
      id: "org-branch-a",
      name: "中山店",
    },
    coSellerCount: 4,
    rentFee: 3000,
    rentCycle: LotteryRentCycle.Month,
    rentDueDay: 5,
    nationalId: "B123456789",
  },
  {
    ...dealerBase,
    id: "dealer-b-3",
    type: LotteryDealerType.B,
    licenseNo: "33334444",
    name: "李小英",
    storeName: "好運 3 號店",
    terminalNo: "T-88021",
    storePhone: "0225112233",
    coSellerCount: 7,
    rentFee: 3000,
    rentCycle: LotteryRentCycle.Month,
    rentDueDay: 5,
    agents: [contactRef("contact-1", "陳小芳")],
    nationalId: "A223456780",
    mobile: "0912345678",
  },
];

const contactBase = {
  __typename: "LotteryDealerContact" as const,
  birthday: null,
  phone: null,
  email: null,
  mailingAddress: null,
  residentialAddress: null,
  residentialSameAsMailing: false,
  note: null,
  createdBy: {
    __typename: "LotteryDealerUserRef" as const,
    id: "u-1",
    name: "王總",
  },
  createdAt: iso("2026-09-01"),
  updatedAt: iso("2026-09-01"),
  abilities: {
    __typename: "LotteryDealerContactAbilities" as const,
    canEdit: true,
  },
};

const dealerRefOf = (dealer: LotteryDealerFieldsFragment) => ({
  __typename: "LotteryDealerRef" as const,
  id: dealer.id,
  type: dealer.type,
  licenseNo: dealer.licenseNo,
  name: dealer.name,
  storeName: dealer.storeName ?? null,
  status: dealer.status,
});

const chen = dealerFixtures.find((dealer) => dealer.id === "dealer-a-1");

export const contactFixtures: LotteryDealerContactFieldsFragment[] = [
  {
    ...contactBase,
    id: "contact-1",
    name: "陳小芳",
    roles: [LotteryContactRole.Trustee, LotteryContactRole.Agent],
    nationalId: "B223456780",
    birthday: iso("1985-08-20"),
    mobile: "0911222333",
    email: "chen@example.com",
    mailingAddress: "新北市板橋區文化路 2 段 5 號",
    residentialAddress: "新北市板橋區文化路 2 段 5 號",
    residentialSameAsMailing: true,
    status: LotteryContactStatus.Active,
    dealerCount: 2,
    links:
      chen === undefined
        ? []
        : [
            {
              __typename: "LotteryDealerContactLink",
              dealer: dealerRefOf(chen),
              role: LotteryContactRole.Trustee,
            },
            {
              __typename: "LotteryDealerContactLink",
              dealer: dealerRefOf(chen),
              role: LotteryContactRole.Agent,
            },
          ],
  },
  {
    ...contactBase,
    id: "contact-2",
    name: "林小玉",
    roles: [LotteryContactRole.Agent],
    nationalId: "C123456789",
    mobile: "0922333444",
    status: LotteryContactStatus.Active,
    dealerCount: 1,
    links: [],
  },
  {
    ...contactBase,
    id: "contact-3",
    name: "吳介紹",
    roles: [LotteryContactRole.Introducer],
    nationalId: "D123456789",
    mobile: "0933444555",
    status: LotteryContactStatus.Disabled,
    dealerCount: 1,
    links: [],
  },
];

/** 已對應乙類的分店(對應分店的樹上停用)。 */
export const occupiedStoreFixtures = [
  {
    __typename: "LotteryOccupiedStore" as const,
    orgId: "org-branch-a",
    dealer: storeTwo,
  },
];
