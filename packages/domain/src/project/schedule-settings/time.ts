/** `HH:mm`(00:00–23:59,到分鐘)。人力需求範本的開始 / 結束時間用這個格式。 */
const HH_MM = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

/** 是不是合法的 `HH:mm`(兩位數小時、兩位數分鐘;`24:00`、`8:00` 都不是)。 */
export function isHhMm(value: unknown): value is string {
  return typeof value === "string" && HH_MM.test(value);
}

/** `HH:mm` → 從 00:00 起算的分鐘數;不合法回 `null`。 */
export function minutesOfHhMm(value: string): number | null {
  if (!isHhMm(value)) {
    return null;
  }
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

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
