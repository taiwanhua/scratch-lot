/** 營運報表區塊 5 現金:5a 差額與更正、5b 現金移動(`operations-rows.ts` 的一部分)。 */
import type { SheetSection } from "@/lib/project/reports/excel";

import {
  MOVEMENT_KEYS,
  type OperationsStore,
  POST_CLOSE_KEYS,
  type T,
  keyIn,
  line,
  numberColumn,
  textColumn,
  totalLine,
} from "./operations-row-base";

const columnsKey = "admin.lotteryReports.operations.columns";

/** 5a 差額與更正(+ 錢比帳多、− 錢比帳少):各班結帳差額、事後更正 · 類別、日結的小金庫差額。 */
export const cashDifferenceSection = (
  store: OperationsStore,
  t: T,
): SheetSection => {
  const { cash } = store;
  const postClose =
    cash.postClose.length === 0
      ? [
          line({
            item: t("admin.lotteryReports.operations.items.postCloseNone"),
            quantity: 0,
            amount: 0,
          }),
        ]
      : cash.postClose.map((entry) =>
          line({
            item: t("admin.lotteryReports.operations.items.postClose", {
              category: t(
                keyIn(
                  POST_CLOSE_KEYS,
                  entry.category,
                  "admin.lotteryReports.operations.postClose.other",
                ),
              ),
            }),
            quantity: entry.count,
            amount: entry.amount,
            note: t("admin.lotteryReports.operations.items.postCloseNote"),
          }),
        );
  return {
    title: t("admin.lotteryReports.operations.blocks.cashDifference"),
    description: t(
      "admin.lotteryReports.operations.descriptions.cashDifference",
    ),
    columns: [
      textColumn("item", t(`${columnsKey}.item`)),
      numberColumn("quantity", t(`${columnsKey}.quantity`)),
      numberColumn("amount", t(`${columnsKey}.amount`), 14),
      textColumn("note", t(`${columnsKey}.note`)),
    ],
    rows: [
      line({
        item: t("admin.lotteryReports.operations.items.shiftDifference"),
        quantity: cash.shiftCount,
        amount: cash.shiftDifference,
        note:
          cash.pendingShiftCount > 0
            ? t("admin.lotteryReports.operations.items.pendingShifts", {
                count: cash.pendingShiftCount,
              })
            : null,
      }),
      ...postClose,
      line({
        item: t("admin.lotteryReports.operations.items.vaultDifference"),
        quantity: cash.dailyCloseCount,
        amount: cash.vaultDifference,
      }),
    ],
  };
};

/** 5b 現金移動(+ 錢進來、− 錢出去):依類型一列,分抽屜 / 小金庫兩欄;最後一列合計。 */
export const cashMovementSection = (
  store: OperationsStore,
  t: T,
): SheetSection => {
  const { movements } = store.cash;
  const sum = (key: "count" | "drawer" | "vault") =>
    movements.reduce((total, entry) => total + entry[key], 0);
  return {
    title: t("admin.lotteryReports.operations.blocks.cashMovement"),
    description: t("admin.lotteryReports.operations.descriptions.cashMovement"),
    columns: [
      textColumn("item", t(`${columnsKey}.item`)),
      numberColumn("count", t(`${columnsKey}.records`)),
      numberColumn("drawer", t(`${columnsKey}.drawer`), 14),
      numberColumn("vault", t(`${columnsKey}.vault`), 14),
    ],
    rows: [
      ...movements.map((entry) =>
        line({
          item: t(
            keyIn(
              MOVEMENT_KEYS,
              entry.type,
              "admin.lotteryReports.operations.movements.correction",
            ),
          ),
          count: entry.count,
          drawer: entry.drawer,
          vault: entry.vault,
        }),
      ),
      totalLine({
        item: t("admin.lotteryReports.operations.items.movementTotal"),
        count: sum("count"),
        drawer: sum("drawer"),
        vault: sum("vault"),
      }),
    ],
    footnotes: [t("admin.lotteryReports.operations.footnotes.cashMovement")],
  };
};
