/** 營運報表區塊 2b 批售(專案規格 21.7;`operations-rows.ts` 的一部分)。 */
import { compareDisplayName } from "@repo/domain/collation";
import { formatTemporal } from "@repo/domain/form";

import type { SheetColumn, SheetSection } from "@/lib/base/reports/excel";

import {
  type OperationsStore,
  type SheetOptions,
  type T,
  hasCost,
  keyIn,
  line,
  numberColumn,
  textColumn,
  totalLine,
} from "./operations-row-base";
import { listedText } from "./operations-rows-more";

type Wholesale = OperationsStore["wholesale"];

/** 說明列最多列幾張單號(同區塊 7)。 */
const MAX_LISTED = 5;

const COLLECT_FIRST_KEY =
  "admin.lotteryPurchasing.wholesale.paymentModes.collect_first";

/** 收款方式的文案(同批售單;不認得的值退回「收到錢再核准」,同 `keyIn` 的做法)。 */
const PAYMENT_MODE_KEYS: Readonly<Record<string, string>> = {
  auto_bank: "admin.lotteryPurchasing.wholesale.paymentModes.auto_bank",
  collect_first: COLLECT_FIRST_KEY,
};

/** 獲利率 = 批售獲利 ÷ 批售金額(沒有成本或批售金額 0 → 空白)。 */
export const profitRateOf = (
  amount: number,
  cost: number | null | undefined,
): number | null =>
  cost == null || amount === 0 ? null : (amount - cost) / amount;

const profitOf = (amount: number, cost: number | null | undefined) =>
  cost == null ? null : amount - cost;

const rateColumn = (t: T): SheetColumn => ({
  key: "rate",
  header: t("admin.lotteryReports.operations.columns.profitRate"),
  width: 8,
  numFmt: "0.0%",
  align: "right",
});

/** 原成本、批售獲利(+ 獲利率)欄:沒有成本權限時不放。 */
const costColumns = (withCost: boolean, t: T, rate: boolean) =>
  withCost
    ? [
        numberColumn(
          "cost",
          t("admin.lotteryReports.operations.columns.originalCost"),
          12,
        ),
        numberColumn(
          "profit",
          t("admin.lotteryReports.operations.columns.wholesaleProfit"),
          12,
        ),
        ...(rate ? [rateColumn(t)] : []),
      ]
    : [];

/** 依批售客戶:客戶 / 單數 / 本數 / 張數 / 批售金額(/ 原成本 / 批售獲利 / 獲利率);合計列。沒有批售只印一列。 */
const customersSection = (store: OperationsStore, t: T): SheetSection => {
  const { customers } = store.wholesale;
  const withCost = hasCost(store);
  const columns = [
    textColumn(
      "customer",
      t("admin.lotteryReports.operations.columns.customer"),
      24,
    ),
    numberColumn(
      "documents",
      t("admin.lotteryReports.operations.columns.documents"),
      8,
    ),
    numberColumn(
      "books",
      t("admin.lotteryReports.operations.columns.books"),
      8,
    ),
    numberColumn(
      "tickets",
      t("admin.lotteryReports.operations.columns.tickets"),
      8,
    ),
    numberColumn(
      "amount",
      t("admin.lotteryReports.operations.columns.wholesaleAmount"),
      12,
    ),
    ...costColumns(withCost, t, true),
  ];
  const base = {
    title: t("admin.lotteryReports.operations.blocks.wholesale"),
    description: t("admin.lotteryReports.operations.descriptions.wholesale"),
    columns,
  };
  if (customers.length === 0 && store.wholesale.documents.length === 0) {
    return {
      ...base,
      rows: [
        line({
          customer: t("admin.lotteryReports.operations.items.wholesaleNone"),
        }),
      ],
    };
  }
  const cells = (values: {
    customer: string;
    documents: number;
    books: number;
    tickets: number;
    amount: number;
    cost: number | null | undefined;
  }) => ({
    ...values,
    cost: withCost ? values.cost : undefined,
    profit: withCost ? profitOf(values.amount, values.cost) : undefined,
    rate: withCost ? profitRateOf(values.amount, values.cost) : undefined,
  });
  const sum = (pick: (row: (typeof customers)[number]) => number) =>
    customers.reduce((total, row) => total + pick(row), 0);
  return {
    ...base,
    rows: [
      ...customers.map((row) =>
        line(
          cells({
            customer: row.customerName,
            documents: row.documents,
            books: row.books,
            tickets: row.tickets,
            amount: row.amount,
            cost: row.cost,
          }),
        ),
      ),
      totalLine(
        cells({
          customer: t("admin.lotteryReports.operations.items.total"),
          documents: sum((row) => row.documents),
          books: sum((row) => row.books),
          tickets: sum((row) => row.tickets),
          amount: sum((row) => row.amount),
          cost: withCost ? sum((row) => row.cost ?? 0) : null,
        }),
      ),
    ],
  };
};

/** 逐單(查帳用):單號 / 出貨時間 / 客戶 / 本數 / 批售金額(/ 原成本 / 批售獲利)/ 收款方式 / 期末已收 / 期末待收。 */
const documentsSection = (
  store: OperationsStore,
  t: T,
  options: SheetOptions,
): SheetSection | null => {
  const { documents } = store.wholesale;
  if (documents.length === 0) {
    return null;
  }
  const withCost = hasCost(store);
  return {
    title: t("admin.lotteryReports.operations.blocks.wholesaleDocuments"),
    description: t(
      "admin.lotteryReports.operations.descriptions.wholesaleDocuments",
    ),
    columns: [
      textColumn(
        "serialNo",
        t("admin.lotteryReports.operations.columns.serialNo"),
        14,
      ),
      textColumn(
        "at",
        t("admin.lotteryReports.operations.columns.shippedAt"),
        14,
      ),
      textColumn(
        "customer",
        t("admin.lotteryReports.operations.columns.customer"),
        20,
      ),
      numberColumn(
        "books",
        t("admin.lotteryReports.operations.columns.books"),
        8,
      ),
      numberColumn(
        "amount",
        t("admin.lotteryReports.operations.columns.wholesaleAmount"),
        12,
      ),
      ...costColumns(withCost, t, false),
      textColumn(
        "paymentMode",
        t("admin.lotteryReports.operations.columns.paymentMode"),
        14,
      ),
      numberColumn(
        "received",
        t("admin.lotteryReports.operations.columns.receivedAtEnd"),
        12,
      ),
      numberColumn(
        "toReceive",
        t("admin.lotteryReports.operations.columns.toReceiveAtEnd"),
        12,
      ),
    ],
    rows: documents.map((row) => {
      const serialNo = row.serialNo ?? "";
      return line({
        serialNo: row.voided
          ? t("admin.lotteryReports.operations.items.wholesaleVoided", {
              serialNo,
            })
          : serialNo,
        at: formatTemporal(row.at, {
          type: "monthDayTime",
          timezone: options.timezone,
        }),
        customer: row.customerName,
        books: row.books,
        amount: row.amount,
        cost: withCost ? row.cost : undefined,
        profit: withCost ? profitOf(row.amount, row.cost) : undefined,
        paymentMode:
          row.paymentMode == null
            ? null
            : t(keyIn(PAYMENT_MODE_KEYS, row.paymentMode, COLLECT_FIRST_KEY)),
        received: row.receivedAtEnd,
        toReceive: row.toReceiveAtEnd,
      });
    }),
  };
};

/** 2b · 期末已收未出貨(Figma RE-04-2:項目 / 單數 / 金額 / 單號,單號最多 5 張)。合計 0 照樣印。 */
const infoSection = (store: OperationsStore, t: T): SheetSection => {
  const { receivedUnshipped } = store.wholesale;
  return {
    title: t("admin.lotteryReports.operations.blocks.wholesaleInfo"),
    description: t(
      "admin.lotteryReports.operations.descriptions.wholesaleInfo",
    ),
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
      textColumn(
        "note",
        t("admin.lotteryReports.operations.columns.serialNo"),
        30,
      ),
    ],
    rows: [
      line({
        item: t("admin.lotteryReports.operations.items.receivedUnshipped"),
        count: receivedUnshipped.count,
        amount: receivedUnshipped.amount,
        note:
          receivedUnshipped.serialNos.length === 0
            ? null
            : listedText(
                receivedUnshipped.serialNos,
                receivedUnshipped.count,
                t,
              ),
      }),
    ],
  };
};

/** 2b 批售的小表(放在 2 毛利之後):依批售客戶、逐單、期末已收未出貨。 */
export const wholesaleSections = (
  store: OperationsStore,
  t: T,
  options: SheetOptions,
): SheetSection[] =>
  [
    customersSection(store, t),
    documentsSection(store, t, options),
    infoSection(store, t),
  ].filter((section): section is SheetSection => section !== null);

/** 區塊 4 另外列的「期末批售中」(本 / 張 / 批售金額;說明列單號)。不進核對。 */
export const pendingAtEndLine = (store: OperationsStore, t: T) => {
  const { pendingAtEnd } = store.wholesale;
  const withCost = hasCost(store);
  const list = listedText(pendingAtEnd.serialNos, pendingAtEnd.count, t);
  const noteOf = (): string | null => {
    if (pendingAtEnd.count === 0) {
      return null;
    }
    // 沒有成本權限時區塊 4 沒有金額欄,批售金額寫在說明
    return withCost
      ? t("admin.lotteryReports.operations.items.pendingAtEndNote", {
          books: pendingAtEnd.books,
          list,
        })
      : t("admin.lotteryReports.operations.items.pendingAtEndNoteNoCost", {
          books: pendingAtEnd.books,
          amount: pendingAtEnd.amount.toLocaleString(),
          list,
        });
  };
  return line({
    item: t("admin.lotteryReports.operations.items.pendingAtEnd"),
    tickets: pendingAtEnd.tickets,
    amount: withCost ? pendingAtEnd.amount : undefined,
    note: noteOf(),
  });
};

/** 全部分店合計的 2b:依客戶合併、逐單照時間排、另外列的相加(單號最多 5 張)。 */
export const totalWholesaleOf = (list: readonly Wholesale[]): Wholesale => {
  const customers = new Map<string, Wholesale["customers"][number]>();
  for (const row of list.flatMap((item) => item.customers)) {
    const key = row.customerId ?? `name:${row.customerName}`;
    const current = customers.get(key);
    customers.set(
      key,
      current === undefined
        ? row
        : {
            ...current,
            documents: current.documents + row.documents,
            books: current.books + row.books,
            tickets: current.tickets + row.tickets,
            amount: current.amount + row.amount,
            cost:
              current.cost == null || row.cost == null
                ? null
                : current.cost + row.cost,
          },
    );
  }
  const documentsOf = (
    pick: (item: Wholesale) => Wholesale["pendingAtEnd"],
  ): Wholesale["pendingAtEnd"] => {
    const rows = list.map((item) => pick(item));
    const sum = (key: "count" | "books" | "tickets" | "amount") =>
      rows.reduce((total, row) => total + row[key], 0);
    return {
      __typename: "LotteryOperationsWholesaleDocuments",
      count: sum("count"),
      books: sum("books"),
      tickets: sum("tickets"),
      amount: sum("amount"),
      serialNos: rows.flatMap((row) => row.serialNos).slice(0, MAX_LISTED),
    };
  };
  return {
    __typename: "LotteryOperationsWholesale",
    customers: [...customers.values()].toSorted((a, b) =>
      compareDisplayName(a.customerName, b.customerName),
    ),
    documents: list
      .flatMap((item) => item.documents)
      .toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at)),
    receivedUnshipped: documentsOf((item) => item.receivedUnshipped),
    pendingAtEnd: documentsOf((item) => item.pendingAtEnd),
  };
};
