/** 營運報表的依遊戲、區塊 6–8 與分店比較(`operations-rows.ts` 的後半)。 */
import type { SheetRow, SheetSection } from "@/lib/project/reports/excel";

import {
  BANK_TYPE_KEYS,
  OUTSTANDING_KEYS,
  type OperationsStore,
  type T,
  hasCost,
  keyIn,
  line,
  negate,
  numberColumn,
  textColumn,
  totalLine,
} from "./operations-row-base";

/** 說明欄列出的單號 / 班名最多幾個(api 也只送這麼多)。 */
const MAX_LISTED = 5;

/** 「T-0001、T-0002」;超過 5 張「… 等 N 張」。 */
const listedText = (items: readonly string[], count: number, t: T): string => {
  const text = items.join("、");
  return count > MAX_LISTED
    ? t("admin.lotteryReports.operations.items.listedMore", {
        list: text,
        count,
      })
    : text;
};

/** 毛利率 = 毛利 ÷ 淨銷售金額(沒有成本或淨銷售 0 → 空白)。 */
const marginOf = (net: number, cost: number | null | undefined) =>
  cost == null || net === 0 ? null : (net - cost) / net;

/** 依遊戲的一列(合計列粗體)。 */
const rowOf = (
  values: {
    game: string;
    price?: number;
    sold: number;
    undone: number;
    net: number;
    cost: number | null | undefined;
  },
  total = false,
): SheetRow => {
  const cells = {
    game: values.game,
    price: values.price,
    sold: values.sold,
    undone: negate(values.undone),
    netTickets: values.sold - values.undone,
    netAmount: values.net,
    soldCost: values.cost,
    grossProfit: values.cost == null ? null : values.net - values.cost,
  };
  return total ? totalLine(cells) : line(cells);
};

/** 1 銷售 · 依遊戲:遊戲 × 面額 / 售出 / 撤銷 / 淨張 / 淨金額(+ 已售成本、毛利、毛利率);最後一列合計。 */
export const gamesSection = (
  store: OperationsStore,
  t: T,
): SheetSection | null => {
  const { games } = store.sales;
  if (games.length === 0) {
    return null;
  }
  const withCost = hasCost(store);
  const sum = (pick: (game: (typeof games)[number]) => number) =>
    games.reduce((value, game) => value + pick(game), 0);
  const totalCost = withCost ? sum((game) => game.cost ?? 0) : null;
  const rows = [
    ...games.map((game) =>
      rowOf({
        game: t("admin.lotteryReports.operations.items.game", {
          code: game.gameCode,
          name: game.gameName,
        }),
        price: game.unitPrice,
        sold: game.sold,
        undone: game.undone,
        net: game.netAmount,
        cost: game.cost,
      }),
    ),
    rowOf(
      {
        game: t("admin.lotteryReports.operations.items.total"),
        sold: sum((game) => game.sold),
        undone: sum((game) => game.undone),
        net: sum((game) => game.netAmount),
        cost: totalCost,
      },
      true,
    ),
  ];
  // 毛利率是比率:Excel 一欄一種格式,放在「毛利率」欄、以 0.0% 顯示
  const withMargin = rows.map((row) => {
    const net = row.netAmount;
    const cost = row.soldCost;
    return {
      ...row,
      margin:
        typeof net === "number" && typeof cost === "number"
          ? marginOf(net, cost)
          : null,
    };
  });
  return {
    title: t("admin.lotteryReports.operations.blocks.games"),
    description: t("admin.lotteryReports.operations.descriptions.games"),
    columns: [
      textColumn("game", t("admin.lotteryReports.operations.columns.game"), 24),
      numberColumn(
        "price",
        t("admin.lotteryReports.operations.columns.price"),
        8,
      ),
      numberColumn(
        "sold",
        t("admin.lotteryReports.operations.columns.sold"),
        8,
      ),
      numberColumn(
        "undone",
        t("admin.lotteryReports.operations.columns.undone"),
        8,
      ),
      numberColumn(
        "netTickets",
        t("admin.lotteryReports.operations.columns.netTickets"),
        8,
      ),
      numberColumn(
        "netAmount",
        t("admin.lotteryReports.operations.columns.netAmount"),
        12,
      ),
      ...(withCost
        ? [
            numberColumn(
              "soldCost",
              t("admin.lotteryReports.operations.columns.soldCost"),
              12,
            ),
            numberColumn(
              "grossProfit",
              t("admin.lotteryReports.operations.columns.grossProfit"),
              12,
            ),
            {
              key: "margin",
              header: t("admin.lotteryReports.operations.columns.margin"),
              width: 8,
              numFmt: "0.0%",
              align: "right" as const,
            },
          ]
        : []),
    ],
    rows: withMargin,
  };
};

/** 6 銀行:帳戶 × 類型(收、支、淨額;說明含沖正 N 筆),每個帳戶最後一列期末餘額(整個帳戶)。 */
export const bankSection = (store: OperationsStore, t: T): SheetSection => {
  const rows = store.bankAccounts.flatMap((account) => {
    const label = account.shared
      ? t("admin.lotteryReports.operations.items.sharedAccount", {
          label: account.label,
        })
      : account.label;
    return [
      ...account.types.map((type, index) =>
        line({
          account: index === 0 ? label : null,
          type: t(
            keyIn(
              BANK_TYPE_KEYS,
              type.type,
              "admin.lotteryReports.operations.bankTypes.other",
            ),
          ),
          in: type.inAmount === 0 ? null : type.inAmount,
          out: type.outAmount === 0 ? null : negate(type.outAmount),
          net: type.inAmount - type.outAmount,
          note:
            type.reversalCount > 0
              ? t("admin.lotteryReports.operations.items.reversals", {
                  count: type.reversalCount,
                })
              : null,
        }),
      ),
      totalLine({
        account: account.types.length === 0 ? label : null,
        type: t("admin.lotteryReports.operations.items.bankBalance"),
        net: account.endingBalance,
        note: account.shared
          ? t("admin.lotteryReports.operations.items.sharedBalanceNote")
          : null,
      }),
    ];
  });
  return {
    title: t("admin.lotteryReports.operations.blocks.bank"),
    description: t("admin.lotteryReports.operations.descriptions.bank"),
    columns: [
      textColumn(
        "account",
        t("admin.lotteryReports.operations.columns.account"),
        22,
      ),
      textColumn("type", t("admin.lotteryReports.operations.columns.type"), 20),
      numberColumn("in", t("admin.lotteryReports.operations.columns.in"), 12),
      numberColumn("out", t("admin.lotteryReports.operations.columns.out"), 12),
      numberColumn("net", t("admin.lotteryReports.operations.columns.net"), 12),
      textColumn("note", t("admin.lotteryReports.operations.columns.note"), 24),
    ],
    rows,
    footnotes: [t("admin.lotteryReports.operations.footnotes.bank")],
  };
};

/** 7 未結清:6 種(期末那一刻的餘額)× 單數、金額;說明列單號(最多 5 張)。 */
export const outstandingSection = (
  store: OperationsStore,
  t: T,
): SheetSection => ({
  title: t("admin.lotteryReports.operations.blocks.outstanding"),
  description: t("admin.lotteryReports.operations.descriptions.outstanding"),
  columns: [
    textColumn("item", t("admin.lotteryReports.operations.columns.item")),
    numberColumn(
      "count",
      t("admin.lotteryReports.operations.columns.documents"),
      8,
    ),
    numberColumn(
      "amount",
      t("admin.lotteryReports.operations.columns.amount"),
      14,
    ),
    textColumn("note", t("admin.lotteryReports.operations.columns.note"), 30),
  ],
  rows: store.outstanding.items.map((item) =>
    line({
      item: t(
        keyIn(
          OUTSTANDING_KEYS,
          item.kind,
          "admin.lotteryReports.operations.outstanding.purchaseToPay",
        ),
      ),
      count: item.count,
      amount: item.amount,
      note:
        item.serialNos.length === 0
          ? null
          : listedText(item.serialNos, item.count, t),
    }),
  ),
});

/** 8 註記:跳過盤點、盤點未盤、沒有被日結涵蓋計算的班、前期更正、尚未關帳。 */
export const notesSection = (store: OperationsStore, t: T): SheetSection => {
  const { notes } = store;
  const skipped = notes.skippedStocktakes.reduce(
    (sum, item) => sum + item.count,
    0,
  );
  return {
    title: t("admin.lotteryReports.operations.blocks.notes"),
    description: t("admin.lotteryReports.operations.descriptions.notes"),
    columns: [
      textColumn("item", t("admin.lotteryReports.operations.columns.item")),
      numberColumn(
        "quantity",
        t("admin.lotteryReports.operations.columns.quantity"),
        8,
      ),
      numberColumn(
        "amount",
        t("admin.lotteryReports.operations.columns.amount"),
        14,
      ),
      textColumn("note", t("admin.lotteryReports.operations.columns.note"), 30),
    ],
    rows: [
      line({
        item: t("admin.lotteryReports.operations.items.skippedStocktakes"),
        quantity: skipped,
        note:
          notes.skippedStocktakes.length === 0
            ? null
            : notes.skippedStocktakes
                .map((item) =>
                  t("admin.lotteryReports.operations.items.reasonCount", {
                    reason: item.reason,
                    count: item.count,
                  }),
                )
                .join("、"),
      }),
      line({
        item: t("admin.lotteryReports.operations.items.uncountedBooks"),
        quantity: notes.uncountedBooks,
        note:
          notes.uncountedBooks === 0
            ? null
            : t("admin.lotteryReports.operations.items.uncountedNote", {
                books: notes.uncountedBooks,
                stocktakes: notes.uncountedStocktakes,
              }),
      }),
      line({
        item: t("admin.lotteryReports.operations.items.uncoveredShifts"),
        quantity: notes.uncoveredShifts,
        note:
          notes.uncoveredShiftLabels.length === 0
            ? null
            : listedText(
                notes.uncoveredShiftLabels.filter((label) => label !== ""),
                notes.uncoveredShifts,
                t,
              ) || null,
      }),
      line({
        item: t("admin.lotteryReports.operations.items.priorPeriod"),
        quantity: notes.priorPeriodCount,
        amount: notes.priorPeriodAmount,
        note: t("admin.lotteryReports.operations.items.priorPeriodNote"),
      }),
      line({
        item: t("admin.lotteryReports.operations.items.openMonths"),
        note:
          notes.openMonths.length === 0
            ? t("admin.lotteryReports.operations.items.allClosed")
            : notes.openMonths.join("、"),
      }),
    ],
  };
};
