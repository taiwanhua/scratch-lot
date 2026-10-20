/**
 * 日期與日期時間(值的存法 `date` / `datetime`、表達式 `dateDiff`)的單一入口。
 *
 * `date` 與 `datetime` 都是真實世界的一個**時點**(instant),差別只在顯示精度:
 * `date` = 時間固定在當地 00:00 的 `datetime`。
 *
 * ```text
 * date     → 當地日期 00:00 → UTC 時點
 * datetime → 當地日期時間   → UTC 時點
 * 讀取:時點 → 換成要顯示的時區 → 當地日期時間 → 依型別格式化(date `YYYY-MM-DD`、datetime `YYYY-MM-DD HH:mm`)
 * ```
 *
 * - 存:api 存 Mongo `Date`;JSON(GraphQL `values`、表達式語意值、版本定義裡的常數與上下限)一律是
 *   帶時區的 ISO 8601 字串。本檔的函式兩種都收(`toInstant`),回傳的時點是 ms、字串是 `toIso` 的 UTC 形
 * - 「當地」= 租戶時區(呼叫端給);同一個時點在不同時區可能落在不同日期,這是預期行為
 *
 * 不依賴日期套件:時區換算只用 `Intl.DateTimeFormat`(前後端都有),結果一致。
 */

/** 租戶沒設時區時用的時區(與 api 讀租戶時區的預設同一個)。 */
export const DEFAULT_TENANT_TIMEZONE = "Asia/Taipei";

export type TemporalType = "date" | "datetime";

/** 當地日期(月份 1–12)。 */
export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

/** 當地牆上時間(年月日 + 時分秒)。 */
interface LocalDateTime extends LocalDate {
  hour: number;
  minute: number;
  second: number;
}

/** `addLocalCalendar` 的單位。 */
export const LOCAL_CALENDAR_UNITS = [
  "days",
  "weeks",
  "months",
  "years",
] as const;

export type LocalCalendarUnit = (typeof LOCAL_CALENDAR_UNITS)[number];

/**
 * 收的字串:一定要有 `T` 與時區標記(`Z` 或 `±hh:mm`),沒有時區的字串語意不明,不收。
 * 分兩段比對(時區尾碼 + 本地時間),每段的正則都保持簡單。
 */
const ZONE_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/;
const LOCAL_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/;

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/**
 * 是不是帶時區的 ISO 8601 日期時間字串(且是真的時點)。日期段要是存在的日期:
 * `Date.parse` 會把 2/30 默默滾到 3/2,所以字面的年月日另外驗(`parseLocalDate`)。
 */
export function isDateTimeString(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const zone = ZONE_SUFFIX.exec(value);
  return (
    zone !== null &&
    LOCAL_DATE_TIME.test(value.slice(0, zone.index)) &&
    parseLocalDate(value.slice(0, 10)) !== null &&
    !Number.isNaN(Date.parse(value))
  );
}

/** 值 → 時點(ms):收 `Date` 或帶時區的 ISO 8601 字串;其他(含 `YYYY-MM-DD`、空值、數字)→ null。 */
export function toInstant(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  return isDateTimeString(value) ? Date.parse(value) : null;
}

/** 時點 → ISO 8601 UTC 字串(`2026-09-25T16:00:00.000Z`);表達式語意值與 JSON 輸出用這個形。 */
export function toIso(instant: number): string {
  return new Date(instant).toISOString();
}

/** 值 → ISO 字串(`toInstant` 再 `toIso`);不是時點 → null。GraphQL 輸出 `String` 欄位時用。 */
export function temporalIsoOf(value: unknown): string | null {
  const instant = toInstant(value);
  return instant === null ? null : toIso(instant);
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/** 每個時區一個 formatter(列表逐格換算時不重建);時區不合法 → 丟 `RangeError`。 */
function formatterOf(timezone: string): Intl.DateTimeFormat {
  let formatter = FORMATTERS.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    FORMATTERS.set(timezone, formatter);
  }
  return formatter;
}

/** 時區字串能不能用(`Intl` 認得的 IANA 名稱)。 */
export function isValidTimezone(timezone: unknown): timezone is string {
  if (typeof timezone !== "string" || timezone === "") {
    return false;
  }
  try {
    formatterOf(timezone);
    return true;
  } catch {
    return false;
  }
}

/** 某時點在某時區的牆上時間;時區不合法 → 丟 `RangeError`。 */
function localDateTimeOf(instant: number, timezone: string): LocalDateTime {
  const parts = formatterOf(timezone).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((item) => item.type === type)?.value ?? Number.NaN);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    // 部分執行環境在 h23 仍把午夜印成 24
    hour: part("hour") % 24,
    minute: part("minute"),
    second: part("second"),
  };
}

/** 牆上時間當成 UTC 的 ms(只用來做差;年份 0–99 也照字面,不被 `Date.UTC` 挪到 1900 年代)。 */
function wallMs(wall: LocalDate & Partial<LocalDateTime>): number {
  const date = new Date(0);
  date.setUTCFullYear(wall.year, wall.month - 1, wall.day);
  date.setUTCHours(wall.hour ?? 0, wall.minute ?? 0, wall.second ?? 0, 0);
  return date.getTime();
}

/** 時區在某時點相對 UTC 的位移(ms,當地 − UTC)。 */
function offsetAt(instant: number, timezone: string): number {
  const second =
    instant - (((instant % MS_PER_SECOND) + MS_PER_SECOND) % MS_PER_SECOND);
  return wallMs(localDateTimeOf(instant, timezone)) - second;
}

/**
 * 某時區的牆上時間 → 可能的時點:以「猜一個時點 → 用 Intl 取當地時間 → 修正」迭代,
 * 再把前一天 / 後一天的位移也試一次(夏令時間切換日兩個位移都要看到)。回傳去重後的候選。
 */
function candidatesOf(wall: LocalDateTime, timezone: string): number[] {
  const target = wallMs(wall);
  const candidates = new Set<number>();
  let guess = target;
  for (let round = 0; round < 3; round += 1) {
    guess = target - offsetAt(guess, timezone);
    candidates.add(guess);
  }
  for (const probe of [target - MS_PER_DAY, target + MS_PER_DAY]) {
    candidates.add(target - offsetAt(probe, timezone));
  }
  return [...candidates].toSorted((a, b) => a - b);
}

const sameDate = (left: LocalDate, right: LocalDate): boolean =>
  left.year === right.year &&
  left.month === right.month &&
  left.day === right.day;

/**
 * 某時區的牆上時間 → 時點。重複的時刻(夏令時間結束)取較早的一個;不存在的時刻(夏令時間開始)
 * 往後推到切換後的第一個時點。時區不合法 → 丟 `RangeError`。
 */
function instantOfLocal(wall: LocalDateTime, timezone: string): number {
  const target = wallMs(wall);
  const candidates = candidatesOf(wall, timezone);
  const exact = candidates.find(
    (candidate) => wallMs(localDateTimeOf(candidate, timezone)) === target,
  );
  if (exact !== undefined) {
    return exact;
  }
  // 不存在的時刻:取當地時間已經超過目標的最早候選(= 切換後),找不到就用最晚的候選
  const after = candidates.find(
    (candidate) => wallMs(localDateTimeOf(candidate, timezone)) > target,
  );
  return after ?? Math.max(...candidates);
}

/** 時點在某時區的當地日期;時區不合法 → 丟 `RangeError`。 */
export function localDateOf(instant: number, timezone: string): LocalDate {
  const { year, month, day } = localDateTimeOf(instant, timezone);
  return { year, month, day };
}

/**
 * 當地日期在某時區 00:00 的時點(ms)。當天 00:00 不存在(夏令時間在午夜開始)時回當天的第一個時點;
 * 00:00 出現兩次時回較早的一個。時區不合法 → 丟 `RangeError`。
 */
export function startOfLocalDay(date: LocalDate, timezone: string): number {
  const wall = { ...date, hour: 0, minute: 0, second: 0 };
  // 候選已由早到晚排序:第一個落在當天的就是當天的起點
  const first = candidatesOf(wall, timezone).find((candidate) =>
    sameDate(localDateOf(candidate, timezone), date),
  );
  return first ?? instantOfLocal(wall, timezone);
}

/**
 * 當地日期的某個牆上時刻(時、分)在某時區的時點(ms),例如租戶當地「今天 08:00」。
 * 重複的時刻(夏令時間結束)取較早的一個;不存在的時刻(夏令時間開始)往後推到切換後的第一個時點。
 * 時區不合法 → 丟 `RangeError`。
 */
export function instantOfLocalTime(
  date: LocalDate,
  hour: number,
  minute: number,
  timezone: string,
): number {
  return instantOfLocal({ ...date, hour, minute, second: 0 }, timezone);
}

/** 值 → 時點;數字直接當 ms。 */
function instantOfAny(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  return toInstant(value);
}

/**
 * 兩個值(`Date` / ISO 字串 / ms)換成某時區的當地日期再比:回 -1 / 0 / 1;任一不是時點或時區不合法 → null。
 * 日期與日期時間互比、「今天」的邊界都用它(不看時分秒)。
 */
export function compareLocalDay(
  a: unknown,
  b: unknown,
  timezone: string,
): -1 | 0 | 1 | null {
  const left = instantOfAny(a);
  const right = instantOfAny(b);
  if (left === null || right === null || !isValidTimezone(timezone)) {
    return null;
  }
  const diff =
    wallMs(localDateOf(left, timezone)) - wallMs(localDateOf(right, timezone));
  return Math.sign(diff) as -1 | 0 | 1;
}

/** 兩個值在某時區是不是同一天;任一不是時點 → false。 */
export function sameLocalDay(
  a: unknown,
  b: unknown,
  timezone: string,
): boolean {
  return compareLocalDay(a, b, timezone) === 0;
}

/** 迄 − 起 的當地日曆日數(`dateDiff` 的 `days`);任一不是時點或時區不合法 → null。 */
export function localDayDiff(
  start: unknown,
  end: unknown,
  timezone: string,
): number | null {
  const from = instantOfAny(start);
  const to = instantOfAny(end);
  if (from === null || to === null || !isValidTimezone(timezone)) {
    return null;
  }
  return Math.round(
    (wallMs(localDateOf(to, timezone)) - wallMs(localDateOf(from, timezone))) /
      MS_PER_DAY,
  );
}

/** 一個單位有幾毫秒(`dateDiff` 的精確差用)。 */
export const MS_PER_UNIT = {
  hours: MS_PER_HOUR,
  minutes: MS_PER_MINUTE,
} as const;

/** 迄 − 起 的毫秒差(時點差);任一不是時點 → null。 */
export function instantDiffMs(start: unknown, end: unknown): number | null {
  const from = instantOfAny(start);
  const to = instantOfAny(end);
  return from === null || to === null ? null : to - from;
}

/** 某年某月有幾天(下個月第 0 天 = 這個月最後一天)。 */
function daysInMonth(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}

/**
 * 在某時區以**日曆單位**加減(`dateAdd` 用;`amount` 負數 = 往前):先換成當地牆上時間,加在日期上、
 * 時分秒不變,再換回時點。`months` / `years` 溢出時取該月最後一天(1/31 + 1 個月 = 2/28 或 2/29)。
 * `date`(當地 00:00)加完仍是當地 00:00。時區不合法 → 丟 `RangeError`。
 */
export function addLocalCalendar(
  instant: number,
  amount: number,
  unit: LocalCalendarUnit,
  timezone: string,
): number {
  const wall = localDateTimeOf(instant, timezone);
  const whole = Math.trunc(amount);
  let { year, month, day } = wall;
  if (unit === "days" || unit === "weeks") {
    const shifted = new Date(
      wallMs({ year, month, day }) +
        whole * (unit === "weeks" ? 7 : 1) * MS_PER_DAY,
    );
    year = shifted.getUTCFullYear();
    month = shifted.getUTCMonth() + 1;
    day = shifted.getUTCDate();
  } else {
    const months =
      year * 12 + (month - 1) + whole * (unit === "years" ? 12 : 1);
    year = Math.floor(months / 12);
    month = months - year * 12 + 1;
    day = Math.min(day, daysInMonth(year, month));
  }
  const next = { ...wall, year, month, day };
  const isMidnight = wall.hour === 0 && wall.minute === 0 && wall.second === 0;
  const result = isMidnight
    ? startOfLocalDay(next, timezone)
    : instantOfLocal(next, timezone);
  // 牆上時間只到秒:把原時點的毫秒補回來
  return result + (((instant % MS_PER_SECOND) + MS_PER_SECOND) % MS_PER_SECOND);
}

const pad = (number: number, length = 2): string =>
  String(number).padStart(length, "0");

/** 當地日期 → `YYYY-MM-DD`。 */
export function localDateText(date: LocalDate): string {
  return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;
}

/** `YYYY-MM-DD`(日期選擇器給的字)→ 當地日期;格式不對或不存在的日期(2/30)→ null。 */
export function parseLocalDate(text: unknown): LocalDate | null {
  if (typeof text !== "string") {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    return null;
  }
  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  return date.month >= 1 &&
    date.month <= 12 &&
    date.day >= 1 &&
    date.day <= daysInMonth(date.year, date.month)
    ? date
    : null;
}

/** 某時點在某時區那一天的 00:00(`date` 的存值);時區不合法 → 丟 `RangeError`。 */
export function startOfLocalDayOf(instant: number, timezone: string): number {
  return startOfLocalDay(localDateOf(instant, timezone), timezone);
}

/**
 * 顯示格式:欄位型別(`date` / `datetime`),或省略年份的短格式 `monthDay`(`MM/DD`)/
 * `monthDayTime`(`MM/DD HH:mm`;排班、卡片這類同年份內的密集顯示)。
 */
export type FormatTemporalType = TemporalType | "monthDay" | "monthDayTime";

export interface FormatTemporalOptions {
  type: FormatTemporalType;
  timezone: string;
}

/**
 * 日期 / 日期時間的顯示文字:時點換成 `timezone` 的當地時間,`date` 印 `YYYY-MM-DD`、
 * `datetime` 印 `YYYY-MM-DD HH:mm`、`monthDay` 印 `MM/DD`、`monthDayTime` 印 `MM/DD HH:mm`(月日補零)。空值 → 空字串;不是時點的字串原樣回(不讓舊資料整格消失);
 * 時區不合法 → 以 UTC 顯示。admin 顯示與 api(信件、lookup label)共用。
 */
export function formatTemporal(
  value: unknown,
  options: FormatTemporalOptions,
): string {
  const instant = toInstant(value);
  if (instant === null) {
    return typeof value === "string" ? value : "";
  }
  const timezone = isValidTimezone(options.timezone) ? options.timezone : "UTC";
  const wall = localDateTimeOf(instant, timezone);
  const time = `${pad(wall.hour)}:${pad(wall.minute)}`;
  const monthDay = `${pad(wall.month)}/${pad(wall.day)}`;
  switch (options.type) {
    case "date": {
      return localDateText(wall);
    }
    case "datetime": {
      return `${localDateText(wall)} ${time}`;
    }
    case "monthDay": {
      return monthDay;
    }
    case "monthDayTime": {
      return `${monthDay} ${time}`;
    }
  }
}
