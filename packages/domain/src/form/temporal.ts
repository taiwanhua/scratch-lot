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
 * 把跳過的時間平移過去(例如跳過 02:00–03:00 時,02:30 → 03:30)。時區不合法 → 丟 `RangeError`。
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
 * 重複的時刻(夏令時間結束)取較早的一個;不存在的時刻(夏令時間開始)把跳過的時間平移過去
 * (例如跳過 02:00–03:00 時,02:30 → 03:30)。時區不合法 → 丟 `RangeError`。
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
 * 顯示格式:欄位型別(`date` / `datetime`),或省略年份的短格式 `monthDay`(`M/D`,不補零)/
 * `monthDayTime`(`M/D HH:mm`;行事曆格、卡片這類同年份內的密集顯示)。
 */
export type FormatTemporalType = TemporalType | "monthDay" | "monthDayTime";

export interface FormatTemporalOptions {
  type: FormatTemporalType;
  timezone: string;
}

/**
 * 日期 / 日期時間的顯示文字:時點換成 `timezone` 的當地時間,`date` 印 `YYYY-MM-DD`、
 * `datetime` 印 `YYYY-MM-DD HH:mm`、`monthDay` 印 `M/D`、`monthDayTime` 印 `M/D HH:mm`(月日不補零,時分補零)。空值 → 空字串;不是時點的字串原樣回(不讓舊資料整格消失);
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
  const monthDay = `${String(wall.month)}/${String(wall.day)}`;
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

// ---- 格式字串(對齊 dayjs `format`)----

/**
 * 格式字串支援的 token,意義與 dayjs `format`(預設英文語系、無外掛)一致:
 * 年 `YYYY` / `YY`、月 `MM` / `M`、日 `DD` / `D`、24 時 `HH` / `H`、12 時 `hh` / `h`、分 `mm` / `m`、
 * 秒 `ss` / `s`、毫秒 `SSS`、上下午 `A`(AM / PM)/ `a`(am / pm)。
 */
export const TEMPORAL_FORMAT_TOKENS = [
  "YYYY",
  "YY",
  "MM",
  "M",
  "DD",
  "D",
  "HH",
  "H",
  "hh",
  "h",
  "mm",
  "m",
  "ss",
  "s",
  "SSS",
  "A",
  "a",
] as const;

export type TemporalFormatToken = (typeof TEMPORAL_FORMAT_TOKENS)[number];

/**
 * 切 token 的規則,與 dayjs 的 `REGEX_FORMAT`(`/\[([^\]]+)]|YYYY|YY|M{1,4}|D{1,2}|d{1,4}|H{1,2}|h{1,2}|a|A|m{1,2}|s{1,2}|Z{1,2}|SSS/g`)
 * 切法相同:`[...]`(至少一個字)原樣印;同一個字母連續出現時,依它可用的長度由長到短貪婪地切
 * (例 `YYY` = `YY` + 落單的 `Y`)。切出來但不在 `TEMPORAL_FORMAT_TOKENS` 的(`MMM` 月名、`d` 星期、
 * `Z` 時區…)與落單的字母不支援。逐字掃描而不用整條正則:正則的回溯成本與複雜度都過高。
 */
const TOKEN_LENGTHS: Readonly<Record<string, readonly number[]>> = {
  Y: [4, 2],
  M: [4, 3, 2, 1],
  D: [2, 1],
  d: [4, 3, 2, 1],
  H: [2, 1],
  h: [2, 1],
  m: [2, 1],
  s: [2, 1],
  Z: [2, 1],
  S: [3],
  a: [1],
  A: [1],
};

/** 格式字串的長度上限。 */
export const TEMPORAL_FORMAT_MAX_LENGTH = 50;

type FormatSegment =
  | { kind: "token"; token: TemporalFormatToken }
  | { kind: "literal"; text: string };

function isTemporalFormatToken(text: string): text is TemporalFormatToken {
  return (TEMPORAL_FORMAT_TOKENS as readonly string[]).includes(text);
}

/** 不在 `[...]` 裡的英文字母要是 token,其他字母不收(dayjs 會原樣印,但多半是打錯或外掛 token)。 */
const LETTER = /^[A-Za-z]$/;

/** 從 `start` 起同一個字母連續幾個。 */
function runLengthAt(pattern: string, start: number): number {
  let end = start;
  while (pattern[end] === pattern[start]) {
    end += 1;
  }
  return end - start;
}

/** 格式字串 → 段落;有不支援的 token 或沒跳脫的英文字母 → null。 */
function formatSegmentsOf(pattern: string): FormatSegment[] | null {
  const segments: FormatSegment[] = [];
  let index = 0;
  while (index < pattern.length) {
    const char = pattern.charAt(index);
    const close = char === "[" ? pattern.indexOf("]", index + 1) : -1;
    // 同 dayjs:`[` 後至少一個字才算跳脫(`[]` 照印)
    if (close > index + 1) {
      segments.push({ kind: "literal", text: pattern.slice(index + 1, close) });
      index = close + 1;
      continue;
    }
    if (!LETTER.test(char)) {
      segments.push({ kind: "literal", text: char });
      index += 1;
      continue;
    }
    const run = runLengthAt(pattern, index);
    const length = (TOKEN_LENGTHS[char] ?? []).find((one) => one <= run);
    const token = length === undefined ? "" : char.repeat(length);
    if (!isTemporalFormatToken(token)) {
      return null;
    }
    segments.push({ kind: "token", token });
    index += token.length;
  }
  return segments;
}

/**
 * 是不是可用的格式字串:1–50 字、至少一個 token、只用 `TEMPORAL_FORMAT_TOKENS`;
 * 要原樣印的英文字母放進 `[...]`(例 `YYYY-MM-DD[T]HH:mm`),其他字元(分隔符號、空白、中文)照印。
 */
export function isTemporalFormat(pattern: unknown): pattern is string {
  if (
    typeof pattern !== "string" ||
    pattern === "" ||
    pattern.length > TEMPORAL_FORMAT_MAX_LENGTH
  ) {
    return false;
  }
  const segments = formatSegmentsOf(pattern);
  return segments?.some((segment) => segment.kind === "token") ?? false;
}

function tokenText(
  token: TemporalFormatToken,
  wall: LocalDateTime,
  ms: number,
): string {
  const hour12 = wall.hour % 12 || 12;
  switch (token) {
    case "YYYY": {
      return pad(wall.year, 4);
    }
    case "YY": {
      return String(wall.year).slice(-2);
    }
    case "MM": {
      return pad(wall.month);
    }
    case "M": {
      return String(wall.month);
    }
    case "DD": {
      return pad(wall.day);
    }
    case "D": {
      return String(wall.day);
    }
    case "HH": {
      return pad(wall.hour);
    }
    case "H": {
      return String(wall.hour);
    }
    case "hh": {
      return pad(hour12);
    }
    case "h": {
      return String(hour12);
    }
    case "mm": {
      return pad(wall.minute);
    }
    case "m": {
      return String(wall.minute);
    }
    case "ss": {
      return pad(wall.second);
    }
    case "s": {
      return String(wall.second);
    }
    case "SSS": {
      return pad(ms, 3);
    }
    case "A": {
      return wall.hour < 12 ? "AM" : "PM";
    }
    case "a": {
      return wall.hour < 12 ? "am" : "pm";
    }
  }
}

/**
 * 依格式字串印日期 / 日期時間(token 意義同 dayjs `format`,見 `TEMPORAL_FORMAT_TOKENS`):
 * 時點換成 `timezone` 的當地時間再套格式。空值 → 空字串;不是時點的字串原樣回(同 `formatTemporal`);
 * 時區不合法 → 以 UTC;格式字串不合法(`isTemporalFormat` 不過)→ 退回 `formatTemporal` 的 `datetime`。
 */
export function formatTemporalPattern(
  value: unknown,
  pattern: string,
  timezone: string,
): string {
  const segments = isTemporalFormat(pattern) ? formatSegmentsOf(pattern) : null;
  if (segments === null) {
    return formatTemporal(value, { type: "datetime", timezone });
  }
  const instant = toInstant(value);
  if (instant === null) {
    return typeof value === "string" ? value : "";
  }
  const zone = isValidTimezone(timezone) ? timezone : "UTC";
  const wall = localDateTimeOf(instant, zone);
  const ms = ((instant % MS_PER_SECOND) + MS_PER_SECOND) % MS_PER_SECOND;
  return segments
    .map((segment) =>
      segment.kind === "literal"
        ? segment.text
        : tokenText(segment.token, wall, ms),
    )
    .join("");
}

// ---- 時刻(`HH:mm`)----

/** `HH:mm`(00:00–23:59,到分鐘;24 小時制、補零,字串比較就是先後順序)。 */
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

/**
 * 當地日期 + `HH:mm` 在某時區的時點(ms),例如「那天 09:00」;`HH:mm` 不合法 → null。
 * 夏令時間照 `instantOfLocalTime`:重複的時刻取較早的一個,不存在的時刻把跳過的時間平移過去(02:30 → 03:30)。
 * 時區不合法 → 丟 `RangeError`。
 */
export function instantOfLocalHhMm(
  date: LocalDate,
  time: string,
  timezone: string,
): number | null {
  const minutes = minutesOfHhMm(time);
  return minutes === null
    ? null
    : instantOfLocalTime(
        date,
        Math.floor(minutes / 60),
        minutes % 60,
        timezone,
      );
}

// ---- 純日曆(不看時區;日期鍵 `YYYY-MM-DD`、月份鍵 `YYYY-MM` 先 parse 再算)----

/** 當地月份(月份 1–12)。 */
export interface LocalMonth {
  year: number;
  month: number;
}

/** 當地月份 → `YYYY-MM`。 */
export function localMonthText(month: LocalMonth): string {
  return `${pad(month.year, 4)}-${pad(month.month)}`;
}

/** `YYYY-MM` → 當地月份;格式不對或月份不在 01–12 → null。 */
export function parseLocalMonth(text: unknown): LocalMonth | null {
  if (typeof text !== "string") {
    return null;
  }
  const match = /^(\d{4})-(\d{2})$/.exec(text);
  if (!match) {
    return null;
  }
  const month = { year: Number(match[1]), month: Number(match[2]) };
  return month.month >= 1 && month.month <= 12 ? month : null;
}

/** 那個月有幾天。 */
export function daysInLocalMonth(month: LocalMonth): number {
  return daysInMonth(month.year, month.month);
}

/** 牆上日期的日序數(只拿來做差與加減)。 */
const dayNumberOf = (date: LocalDate): number => wallMs(date) / MS_PER_DAY;

const dateOfDayNumber = (dayNumber: number): LocalDate => {
  const value = new Date(dayNumber * MS_PER_DAY);
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
};

/** 當地日期加減天數(`days` 負數 = 往前,小數捨去);跨月、跨年照日曆進位。 */
export function addLocalDays(date: LocalDate, days: number): LocalDate {
  return dateOfDayNumber(dayNumberOf(date) + Math.trunc(days));
}

/** `to − from` 的日曆日數(同一天 = 0)。 */
export function localDateDiff(from: LocalDate, to: LocalDate): number {
  return Math.round(dayNumberOf(to) - dayNumberOf(from));
}

/** 星期幾:0 = 星期日 … 6 = 星期六。 */
export function weekdayOfLocalDate(date: LocalDate): number {
  return new Date(wallMs(date)).getUTCDay();
}

/** 當地月份加減月數(`amount` 負數 = 往前,小數捨去;`2026-01` − 1 = `2025-12`)。 */
export function addLocalMonths(month: LocalMonth, amount: number): LocalMonth {
  const index = month.year * 12 + (month.month - 1) + Math.trunc(amount);
  const year = Math.floor(index / 12);
  return { year, month: index - year * 12 + 1 };
}

/** 兩個月份相差幾個月(`to − from`;同月 = 0、`2025-12` → `2026-01` = 1)。 */
export function localMonthDiff(from: LocalMonth, to: LocalMonth): number {
  return to.year * 12 + to.month - (from.year * 12 + from.month);
}

/**
 * 那個月的第 `day` 日,超過月底就用月底(「每月 N 日」:31 日 → 2 月 28 / 29 日、4 月 30 日);
 * 小於 1 → 1 日,小數捨去。
 */
export function clampedDateOfMonth(month: LocalMonth, day: number): LocalDate {
  const last = daysInLocalMonth(month);
  return {
    year: month.year,
    month: month.month,
    day: Math.min(Math.max(Math.trunc(day), 1), last),
  };
}

/** 那個月的每一天(1 日到月底,由早到晚)。 */
export function datesOfLocalMonth(month: LocalMonth): LocalDate[] {
  return Array.from({ length: daysInLocalMonth(month) }, (_, index) => ({
    year: month.year,
    month: month.month,
    day: index + 1,
  }));
}

/** 時點在某時區屬於哪個月份;時區不合法 → 丟 `RangeError`。 */
export function localMonthOf(instant: number, timezone: string): LocalMonth {
  const { year, month } = localDateOf(instant, timezone);
  return { year, month };
}

// ---- 期間 → 時點區間 ----

/** 半開的時點區間 `[from, to)`(ms);查詢寫成 `$gte from, $lt to`。 */
export interface InstantRange {
  from: number;
  to: number;
}

/**
 * 當地日期期間(`from`–`to`,含頭尾)在某時區的時點區間 `[from 00:00, to 隔天 00:00)`。
 * 邊界用 `startOfLocalDay` 算(夏令時間在午夜切換的時區也對);`from` 晚於 `to` 不檢查(回的 `to` ≤ `from`,呼叫端先驗)。時區不合法 → 丟 `RangeError`。
 */
export function localDayRange(
  from: LocalDate,
  to: LocalDate,
  timezone: string,
): InstantRange {
  return {
    from: startOfLocalDay(from, timezone),
    to: startOfLocalDay(addLocalDays(to, 1), timezone),
  };
}

/** 當地月份在某時區的時點區間 `[月初 00:00, 下月初 00:00)`。時區不合法 → 丟 `RangeError`。 */
export function localMonthRange(
  month: LocalMonth,
  timezone: string,
): InstantRange {
  const next = addLocalMonths(month, 1);
  return {
    from: startOfLocalDay({ ...month, day: 1 }, timezone),
    to: startOfLocalDay({ ...next, day: 1 }, timezone),
  };
}
