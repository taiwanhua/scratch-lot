import {
  INVENTORY_MODULE_KEYS as KEYS,
  INVENTORY_PERMISSIONS as PERMISSIONS,
  formatTicketNo,
} from "@repo/domain/project/lottery";
import {
  type LotteryInventoryBookDetailFieldsFragment,
  type LotteryInventoryBookFieldsFragment,
  type LotteryInventoryTicketFieldsFragment,
  ModuleEngine,
  ModuleSidebarType,
} from "@repo/graphql";

import type { TestModule } from "../../auth-handlers";

/** 庫存管理的夾具(元件測試、假 api 與 mock 模式共用;資料照 Figma IN-01 / 03 / 05 / 06)。 */

export const ALL_INVENTORY_PERMISSIONS = Object.values(PERMISSIONS);

const ref = (id: string, name: string) => ({
  __typename: "LotteryInventoryRef" as const,
  id,
  name,
});

export const inventoryOrgs = {
  storeA: ref("org-store-a", "中山店"),
  storeB: ref("org-store-b", "新竹店"),
  storeC: ref("org-store-c", "台中店"),
};

const inCounter = ref("cp-in", "店內櫃台");
const outStall = ref("cp-out", "店外攤位");

export const inventoryGames = [
  { id: "g-5164", gameCode: "5164", name: "發大財", unitPrice: 200 },
  { id: "g-5201", gameCode: "5201", name: "金好運", unitPrice: 200 },
  { id: "g-5198", gameCode: "5198", name: "鼠來寶", unitPrice: 100 },
  { id: "g-5133", gameCode: "5133", name: "招財貓", unitPrice: 1000 },
  { id: "g-5150", gameCode: "5150", name: "好運旺旺", unitPrice: 500 },
] as const;

export type GameFixture = (typeof inventoryGames)[number];

export const inventoryBook = (
  overrides: Partial<LotteryInventoryBookFieldsFragment> &
    Pick<LotteryInventoryBookFieldsFragment, "id" | "bookNo">,
  game: GameFixture = inventoryGames[0],
): LotteryInventoryBookFieldsFragment => ({
  __typename: "LotteryInventoryBook",
  bookKey: `${game.gameCode}-${overrides.bookNo}`,
  gameId: game.id,
  gameCode: game.gameCode,
  gameName: game.name,
  unitPrice: game.unitPrice,
  standardTickets: 100,
  firstTicketNo: "001",
  lastTicketNo: "100",
  org: inventoryOrgs.storeA,
  holdings: [
    {
      __typename: "LotteryInventoryHolding",
      org: inventoryOrgs.storeA,
      count: 100,
    },
  ],
  remainingCount: 100,
  totalCount: 100,
  pendingSkipCount: 0,
  requiredSkipCount: 0,
  skippedTicketNos: [],
  state: "on_counter",
  status: "normal",
  purchasedAt: "2026-10-11T16:00:00.000Z",
  purchaseDealer: ref("d-1", "陳志明 #12345678"),
  ...overrides,
});

/** Figma IN-01 的四本。 */
export const sampleInventoryBooks =
  (): LotteryInventoryBookFieldsFragment[] => [
    inventoryBook({
      id: "b-056527",
      bookNo: "0056527",
      lastTicketNo: "102",
      requiredSkipCount: 2,
      skippedTicketNos: ["037", "064"],
      remainingCount: 35,
    }),
    inventoryBook(
      {
        id: "b-060112",
        bookNo: "0060112",
        lastTicketNo: "102",
        requiredSkipCount: 2,
        pendingSkipCount: 2,
        state: "unopened",
        holdings: [
          {
            __typename: "LotteryInventoryHolding",
            org: inventoryOrgs.storeA,
            count: 70,
          },
          {
            __typename: "LotteryInventoryHolding",
            org: inventoryOrgs.storeB,
            count: 30,
          },
        ],
      },
      inventoryGames[1],
    ),
    inventoryBook(
      {
        id: "b-088102",
        bookNo: "0088102",
        remainingCount: 6,
        purchasedAt: "2026-10-02T16:00:00.000Z",
        purchaseDealer: ref("d-2", "林大同 #87654321"),
      },
      inventoryGames[2],
    ),
    inventoryBook(
      {
        id: "b-071204",
        bookNo: "0071204",
        standardTickets: 25,
        lastTicketNo: "025",
        remainingCount: 25,
        totalCount: 25,
        state: "unopened",
        purchasedAt: "2026-10-14T16:00:00.000Z",
        purchaseDealer: ref("d-2", "林大同 #87654321"),
      },
      inventoryGames[3],
    ),
  ];

export const inventoryTicket = (
  ticketNo: string,
  status: string,
  overrides: Partial<LotteryInventoryTicketFieldsFragment> = {},
): LotteryInventoryTicketFieldsFragment => ({
  __typename: "LotteryInventoryTicket",
  id: `t-${ticketNo}`,
  ticketNo,
  status,
  locationKind: "counter",
  cashPoint: inCounter,
  org: inventoryOrgs.storeA,
  responsibleOrg: null,
  locked: false,
  operable: true,
  version: 3,
  ...overrides,
});

/** 本 056527 的張(Figma IN-03):001–040 已售(037 跳號)、041–065 店外攤位(064 跳號、065 已售)、071 待查。 */
const sampleTickets = (): LotteryInventoryTicketFieldsFragment[] =>
  Array.from({ length: 102 }, (_, index) => {
    const no = index + 1;
    const ticketNo = formatTicketNo(no);
    if (ticketNo === "037" || ticketNo === "064") {
      return inventoryTicket(ticketNo, "skipped");
    }
    if (ticketNo === "071") {
      return inventoryTicket(ticketNo, "investigating", {
        responsibleOrg: inventoryOrgs.storeA,
      });
    }
    if (no <= 40 || ticketNo === "065") {
      return inventoryTicket(
        ticketNo,
        "sold",
        no > 40 ? { cashPoint: outStall } : {},
      );
    }
    return inventoryTicket(
      ticketNo,
      "unsold",
      no <= 65 ? { cashPoint: outStall } : {},
    );
  });

const place = (
  cashPoint: { id: string; name: string } | null,
  kind = "counter",
) => ({
  __typename: "LotteryInventoryPlace" as const,
  org: inventoryOrgs.storeA,
  locationKind: kind,
  cashPoint:
    cashPoint === null
      ? null
      : { __typename: "LotteryInventoryRef" as const, ...cashPoint },
});

const event = (
  at: string,
  type: string,
  ticketNos: string[],
  overrides: Partial<
    LotteryInventoryBookDetailFieldsFragment["events"][number]
  > = {},
) => ({
  __typename: "LotteryInventoryEvent" as const,
  at,
  type,
  reopen: false,
  ticketNos,
  wholeBook: false,
  from: place(inCounter),
  to: place(inCounter),
  by: ref("u-1", "王小明"),
  refType: null,
  refId: null,
  refSerialNo: null,
  reasonKey: null,
  reasonNote: null,
  correctionOfShift: null,
  ...overrides,
});

/** 本 056527 的詳情(Figma IN-03 125:1159)。 */
export const sampleBookDetail =
  (): LotteryInventoryBookDetailFieldsFragment => {
    const tickets = sampleTickets();
    const unsold = (from: number, to: number) =>
      tickets
        .filter(
          (row) =>
            row.status === "unsold" &&
            Number(row.ticketNo) >= from &&
            Number(row.ticketNo) <= to,
        )
        .map((row) => row.ticketNo);
    return {
      __typename: "LotteryInventoryBookDetail",
      book:
        sampleInventoryBooks()[0] ??
        inventoryBook({ id: "b", bookNo: "0000001" }),
      tickets,
      locations: [
        {
          __typename: "LotteryInventoryLocation",
          place: place(inCounter),
          ticketNos: unsold(66, 102),
        },
        {
          __typename: "LotteryInventoryLocation",
          place: place(outStall),
          ticketNos: unsold(41, 65),
        },
      ],
      events: [
        // 跨班撤銷:原售出在 10/15 那一班(時間軸標「前期更正,屬於 X 班」)
        event("2026-10-16T14:05:00.000Z", "sale_undo", ["064"], {
          from: place(outStall),
          to: place(outStall),
          correctionOfShift: "店外攤位 · 李小華 10/15 13:00",
        }),
        event("2026-10-16T13:52:00.000Z", "sale", ["065"], {
          from: place(outStall),
          to: place(outStall),
        }),
        event("2026-10-15T12:10:00.000Z", "investigate", ["071"], {
          refType: "stocktake",
          refId: "s-31",
          refSerialNo: "ST-0031",
        }),
        event(
          "2026-10-14T01:30:00.000Z",
          "move",
          Array.from({ length: 25 }, (_, index) => formatTicketNo(index + 41)),
          { to: place(outStall), by: ref("u-2", "李小華") },
        ),
        event(
          "2026-10-13T02:05:00.000Z",
          "open",
          Array.from({ length: 102 }, (_, index) => formatTicketNo(index + 1)),
          { from: place(null, "stock") },
        ),
        event("2026-10-13T02:05:00.000Z", "skip", ["037", "064"]),
        event(
          "2026-10-12T07:20:00.000Z",
          "purchase",
          Array.from({ length: 102 }, (_, index) => formatTicketNo(index + 1)),
          {
            wholeBook: true,
            from: null,
            to: place(null, "stock"),
            refType: "purchase",
            refId: "p-1016",
            refSerialNo: "P-1016",
          },
        ),
      ],
      sources: [
        {
          __typename: "LotteryInventorySource",
          type: "purchase",
          refId: "p-1016",
          refSerialNo: "P-1016",
          at: "2026-10-12T07:20:00.000Z",
          ticketNos: [],
        },
      ],
      cost: {
        __typename: "LotteryInventoryCost",
        rate: 92,
        cost: 18_400,
        unitCost: 184,
      },
      investigation: null,
      abilities: {
        __typename: "LotteryInventoryBookAbilities",
        canCorrectSkips: true,
        canRecover: true,
        canScrap: true,
        canShowCost: true,
      },
    };
  };

/** 整本待查的本 056420(Figma IN-03 125:1699)。 */
export const sampleInvestigatingBookDetail =
  (): LotteryInventoryBookDetailFieldsFragment => {
    const base = sampleBookDetail();
    const tickets = Array.from({ length: 100 }, (_, index) =>
      inventoryTicket(formatTicketNo(index + 1), "investigating", {
        locationKind: "in_transit",
        cashPoint: null,
        responsibleOrg: inventoryOrgs.storeA,
      }),
    );
    return {
      ...base,
      book: inventoryBook({
        id: "b-056420",
        bookNo: "0056420",
        remainingCount: 0,
        state: "sold_out",
      }),
      tickets,
      locations: [],
      events: [
        event(
          "2026-10-12T02:00:00.000Z",
          "investigate",
          tickets.map((row) => row.ticketNo),
          {
            wholeBook: true,
            refType: "transfer",
            refId: "t-7",
            refSerialNo: "T-0007",
          },
        ),
      ],
      investigation: {
        __typename: "LotteryInventoryInvestigation",
        status: "investigating",
        at: "2026-10-12T02:00:00.000Z",
        refType: "transfer",
        refSerialNo: "T-0007",
        responsibleOrg: inventoryOrgs.storeA,
      },
    };
  };

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
