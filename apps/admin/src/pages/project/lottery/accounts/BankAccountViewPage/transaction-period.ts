/** 網址 `?transactions=` 的篩選(期間起迄 `YYYY-MM-DD`、類型);空字串 = 預設(本月)/ 不篩。 */
export interface TransactionFilters {
  from: string;
  to: string;
  type: string;
}

/** [清除] 後的篩選:期間回到預設(本月)、類型全部。 */
export const EMPTY_TRANSACTION_FILTERS: TransactionFilters = {
  from: "",
  to: "",
  type: "",
};

/** 期間起:空 = 本月 1 日(`today` 是租戶時區的今天)。 */
export const periodFromOf = (value: string, today: string | null): string => {
  if (value !== "") {
    return value;
  }
  return today === null ? "" : `${today.slice(0, 8)}01`;
};

/** 期間迄:空 = 今天。 */
export const periodToOf = (value: string, today: string | null): string =>
  value === "" ? (today ?? "") : value;
