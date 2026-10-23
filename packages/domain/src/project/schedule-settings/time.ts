/** `YYYY-MM-DD`(行事曆的日期;日期本身合法,如 2 月沒有 30 日)。 */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** `YYYY-MM`(行事曆一次讀一個月)。 */
export function isIsoMonth(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(value) &&
    isIsoDate(`${value}-01`)
  );
}
