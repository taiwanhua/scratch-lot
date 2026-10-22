import { STORE_KEY, STORE_PERMISSIONS } from "@repo/domain/project/lottery";
import {
  type LotteryShiftInfoFieldsFragment,
  type LotteryStoreBoardBookFieldsFragment,
  type LotteryStoreBoardQuery,
  type LotteryStoreEntryOptionFieldsFragment,
  type LotteryStoreOpenShiftFormQuery,
  type LotteryStoreShiftFieldsFragment,
  ModuleEngine,
  ModuleSidebarType,
} from "@repo/graphql";

import type { TestModule } from "../../auth-handlers";

/**
 * 店面管理(規格 6.1、6.2、6.6;Figma ST-01 65:15)的夾具:中山店三個收銀點(店內櫃台、店外攤位開班中,
 * 負責人都是王小明;彩券機旁未開班)與 Figma 上的卡片。模組與 seed `seeds/project/store.ts` 同形。
 * 元件測試、假 api 與 mock 模式共用。
 */

export type StoreBoard = LotteryStoreBoardQuery["lotteryStoreBoard"]["item"];
export type StoreCashPoint = StoreBoard["cashPoints"][number];
export type StoreOpenShiftForm =
  LotteryStoreOpenShiftFormQuery["lotteryStoreOpenShiftForm"]["item"];

export const STORE_ALL_PERMISSIONS = Object.values(STORE_PERMISSIONS);

/** 王小明(看板上兩班的負責人;mock 的登入者不是他,`isMine` 由夾具指定)。 */
export const STORE_CLERK = { id: "user-wang", name: "王小明" };

const node = (
  key: string,
  name: string,
  order: number,
  route: string,
  overrides: Partial<TestModule> = {},
): TestModule => ({
  id: `m-${key}`,
  key,
  name,
  parentId: `m-${STORE_KEY}`,
  sidebarType: ModuleSidebarType.Hidden,
  engine: ModuleEngine.Fixed,
  order,
  route,
  icon: null,
  permissions: [],
  ...overrides,
});

/** 店面管理的模組(表單模組 + 三個隱藏頁);`permissions` 給主節點的權限。 */
export const storeModules = (
  permissions: readonly string[] = STORE_ALL_PERMISSIONS,
): TestModule[] => [
  node(STORE_KEY, "店面管理", 10, "/store", {
    parentId: null,
    sidebarType: ModuleSidebarType.Link,
    engine: ModuleEngine.Form,
    icon: "store",
    permissions: [...permissions],
  }),
  ...(
    [
      ["view-page", "詳情"],
      ["create-page", "新增"],
      ["edit-page", "編輯"],
    ] as const
  ).map(([page, name], index) =>
    node(`${STORE_KEY}.${page}`, name, index + 1, `/store/${page}`),
  ),
];

export const storeShift = (
  overrides: Partial<LotteryStoreShiftFieldsFragment> &
    Pick<LotteryStoreShiftFieldsFragment, "id" | "cashPoint">,
): LotteryStoreShiftFieldsFragment => ({
  __typename: "LotteryStoreShift",
  openedBy: { __typename: "LotteryAccountsRef", ...STORE_CLERK },
  openedAt: "2026-10-16T00:02:00.000Z",
  isMine: true,
  openingFloat: 3000,
  expectedCash: 3000,
  soldCount: 0,
  soldAmount: 0,
  unmatchedEntry: false,
  ...overrides,
});

const book = (
  bookId: string,
  gameCode: string,
  gameName: string,
  color: string,
  unitPrice: number,
  bookNo: string,
  remaining: number,
  total: number,
  soldToday: number,
): LotteryStoreBoardBookFieldsFragment => ({
  __typename: "LotteryStoreBoardBook",
  bookId,
  gameCode,
  gameName,
  color,
  unitPrice,
  bookNo,
  remaining,
  total,
  soldToday,
  isLowStock: remaining > 0 && remaining <= total * 0.1,
});

const ref = (id: string, name: string) => ({
  __typename: "LotteryAccountsRef" as const,
  id,
  name,
});

/** Figma ST-01 的看板(`orgId` = 看的那家店)。 */
export const sampleStoreBoard = (
  orgId = "org-store-a",
  orgName = "中山店",
): StoreBoard => {
  const counter = storeShift({
    id: "shift-counter",
    cashPoint: ref("cp-counter", "店內櫃台"),
    openedAt: "2026-10-16T00:02:00.000Z",
    expectedCash: 12_350,
    soldCount: 42,
    soldAmount: 8400,
  });
  const outdoor = storeShift({
    id: "shift-outdoor",
    cashPoint: ref("cp-outdoor", "店外攤位"),
    openedAt: "2026-10-16T05:00:00.000Z",
    openingFloat: 0,
    expectedCash: 7200,
    soldCount: 18,
    soldAmount: 3600,
  });
  return {
    __typename: "LotteryStoreBoard",
    org: ref(orgId, orgName),
    cashPoints: [
      {
        __typename: "LotteryStoreCashPoint",
        id: "cp-counter",
        name: "店內櫃台",
        positionKey: "in-store-counter",
        shift: counter,
        books: [
          book("b-1", "5164", "發大財", "red", 200, "0056527", 35, 100, 12),
          book("b-2", "5201", "金好運", "orange", 100, "0060112", 35, 100, 9),
          book("b-3", "5198", "鼠來寶", "blue", 100, "0088102", 6, 100, 21),
          book("b-4", "5150", "好運旺旺", "green", 500, "0042210", 18, 50, 3),
        ],
      },
      {
        __typename: "LotteryStoreCashPoint",
        id: "cp-outdoor",
        name: "店外攤位",
        positionKey: "outdoor-stall",
        shift: outdoor,
        books: [
          book("b-5", "5164", "發大財", "red", 200, "0056528", 35, 100, 6),
          book("b-6", "5133", "招財貓", "purple", 1000, "0071204", 10, 25, 2),
        ],
      },
      {
        __typename: "LotteryStoreCashPoint",
        id: "cp-machine",
        name: "彩券機旁",
        positionKey: "lottery-machine",
        shift: null,
        books: [],
      },
    ],
    myOpenShifts: [counter, outdoor],
    vaultExpected: 48_200,
  };
};

const entryOption = (
  overrides: Partial<LotteryStoreEntryOptionFieldsFragment> &
    Pick<LotteryStoreEntryOptionFieldsFragment, "id">,
): LotteryStoreEntryOptionFieldsFragment => ({
  __typename: "LotteryStoreEntryOption",
  startAt: "2026-10-16T00:00:00.000Z",
  endAt: "2026-10-16T08:00:00.000Z",
  shortName: "早",
  tasks: [],
  snapshot: null,
  hasStartPunch: false,
  ...overrides,
});

const task = (role: string, taskKey: string, positionKey: string) => ({
  __typename: "LotteryStoreEntryTask" as const,
  role,
  taskKey,
  positionKey,
});

/** 王小明今天在中山店的兩筆排班:早班(負責 · 店內櫃台)、晚班(協同 · 補貨)。 */
export const sampleEntryOptions =
  (): LotteryStoreEntryOptionFieldsFragment[] => [
    entryOption({
      id: "entry-morning",
      tasks: [task("leader", "store-and-accounts-lead", "in-store-counter")],
      snapshot: task("leader", "store-and-accounts-lead", "in-store-counter"),
    }),
    entryOption({
      id: "entry-evening",
      startAt: "2026-10-16T08:00:00.000Z",
      endAt: "2026-10-16T14:00:00.000Z",
      shortName: "晚",
      tasks: [task("helper", "store-duties", "restock")],
    }),
  ];

/** 開班視窗:彩券機旁是第一班(可以從小金庫領零用金),預選早班。 */
export const sampleOpenShiftForm = (
  cashPointId: string,
  cashPointName: string,
  positionKey: string,
): StoreOpenShiftForm => ({
  __typename: "LotteryStoreOpenShiftForm",
  cashPoint: ref(cashPointId, cashPointName),
  positionKey,
  plan: "first",
  handoverAmount: 0,
  previousOpenedBy: null,
  previousClosedAt: null,
  canTakeFloat: true,
  suggestedEntryId: "entry-morning",
  entries: sampleEntryOptions().map((option) => ({
    ...option,
    snapshot:
      option.tasks.find((item) => item.positionKey === positionKey) ?? null,
  })),
});

/** 班次資訊(ST-42a):店內櫃台那一班。 */
export const sampleShiftInfo = (
  shift: LotteryStoreShiftFieldsFragment,
): LotteryShiftInfoFieldsFragment => {
  const morning = sampleEntryOptions().at(0) ?? null;
  return {
    __typename: "LotteryShiftInfo",
    id: shift.id,
    cashPoint: shift.cashPoint,
    openedBy: shift.openedBy,
    openedAt: shift.openedAt,
    openingFloat: shift.openingFloat,
    openingFloatSource: "vault",
    entry: shift.unmatchedEntry ? null : morning,
    taskSnapshot: shift.unmatchedEntry ? null : (morning?.snapshot ?? null),
    positionMismatch: false,
    closed: false,
    canReassign: true,
    entryOptions: sampleEntryOptions(),
  };
};
