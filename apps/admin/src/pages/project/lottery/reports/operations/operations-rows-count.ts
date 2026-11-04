/** 營運報表區塊 8 張數店多的列(張數店規格 11.4、第 10 節;Figma CS-40a)。 */
import { formatTemporal } from "@repo/domain/form";

import type { SheetRow } from "@/lib/base/reports/excel";

import {
  type OperationsStore,
  type SheetOptions,
  type T,
  keyIn,
  line,
} from "./operations-row-base";

type CountMode = NonNullable<OperationsStore["notes"]["countMode"]>;

/** 盤點制度的名稱(`countModes.*`)與切換時的簡稱(「11/15 起 張數 → 轉換中」;`countModeShort.*`)。 */
const MODE_KEYS: Readonly<Record<string, string>> = {
  numbered: "admin.lotteryReports.operations.countModes.numbered",
  count: "admin.lotteryReports.operations.countModes.count",
  converting: "admin.lotteryReports.operations.countModes.converting",
};
const SHORT_KEYS: Readonly<Record<string, string>> = {
  numbered: "admin.lotteryReports.operations.countModeShort.numbered",
  count: "admin.lotteryReports.operations.countModeShort.count",
  converting: "admin.lotteryReports.operations.countModeShort.converting",
};

const modeName = (t: T, mode: string) =>
  t(
    keyIn(
      MODE_KEYS,
      mode,
      "admin.lotteryReports.operations.countModes.numbered",
    ),
  );
const shortName = (t: T, mode: string) =>
  t(
    keyIn(
      SHORT_KEYS,
      mode,
      "admin.lotteryReports.operations.countModeShort.numbered",
    ),
  );

/** 「盤點制度」的說明:期間內沒切換 → 「張數盤點(10/01 起)」;有切換 → 「11/15 起 張數 → 轉換中」。 */
const modeNoteOf = (
  mode: CountMode,
  t: T,
  day: (value: string) => string,
): string => {
  if (mode.changes.length > 0) {
    return mode.changes
      .map((change) =>
        t("admin.lotteryReports.operations.items.countModeChange", {
          date: day(change.at),
          from: shortName(t, change.from),
          to: shortName(t, change.to),
        }),
      )
      .join("、");
  }
  if (mode.since == null) {
    return modeName(t, mode.modeAtStart);
  }
  return t("admin.lotteryReports.operations.items.countModeSince", {
    mode: modeName(t, mode.modeAtStart),
    date: day(mode.since),
  });
};

/** 「月底未補點編號」的說明:只有月報判斷(關帳被放行或設「只提醒」的店的月份)。 */
const monthEndNoteOf = (
  mode: CountMode,
  t: T,
  options: SheetOptions,
): string => {
  if (options.periodKind !== "month") {
    return t("admin.lotteryReports.operations.items.monthEndRenumberMonthOnly");
  }
  return mode.monthEndUnrenumbered.length === 0
    ? t("admin.lotteryReports.operations.items.monthEndRenumberNone")
    : mode.monthEndUnrenumbered.join("、");
};

/**
 * 區塊 8 張數店多的四列:盤點制度(期間內的制度與切換時間)、補點編號次數(日期)、距上次補點編號 N 天、
 * 月底未補點編號。期間內一直是編號店(`countMode` = null)→ 不放(編號店畫面不變)。
 */
export const countModeRows = (
  store: OperationsStore,
  t: T,
  options: SheetOptions,
): SheetRow[] => {
  const mode = store.notes.countMode;
  if (mode == null) {
    return [];
  }
  const day = (value: string) =>
    formatTemporal(value, { type: "monthDay", timezone: options.timezone });
  const days = mode.daysSinceRenumber;
  return [
    line({
      item: t("admin.lotteryReports.operations.items.countMode"),
      note: modeNoteOf(mode, t, day),
    }),
    line({
      item: t("admin.lotteryReports.operations.items.renumberCount"),
      quantity: mode.renumberAts.length,
      note:
        mode.renumberAts.length === 0
          ? null
          : mode.renumberAts.map((at) => day(at)).join("、"),
    }),
    line({
      item: t("admin.lotteryReports.operations.items.daysSinceRenumber"),
      quantity: days,
      note:
        days == null
          ? t("admin.lotteryReports.operations.items.neverRenumbered")
          : t("admin.lotteryReports.operations.items.daysValue", { days }),
    }),
    line({
      item: t("admin.lotteryReports.operations.items.monthEndUnrenumbered"),
      quantity:
        options.periodKind === "month"
          ? mode.monthEndUnrenumbered.length
          : null,
      note: monthEndNoteOf(mode, t, options),
    }),
  ];
};
