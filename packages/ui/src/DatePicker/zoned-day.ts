/* eslint-disable import-x/no-named-as-default-member -- dayjs 的發佈檔是 UMD,具名的 `extend` / `tz` 在 node ESM(admin 的 jest)解析不到;MUI 的 AdapterDayjs 也是以預設匯出呼叫 `extend`。到期條件:dayjs 提供真正的 ESM 具名匯出 */
import dayjs from "dayjs";
import timezonePlugin from "dayjs/plugin/timezone";
import utcPlugin from "dayjs/plugin/utc";

/**
 * 日期類元件共用的時區換算(`MonthCalendar`、`ScheduleTimeline`)。
 * 這些元件對外收 IANA 時區(`timezone`,admin 傳租戶時區);沒給時用瀏覽器時區,行為與加上 `timezone` 前相同。
 */

// 下面的換算需要 dayjs 的 utc + timezone 外掛(對整個 dayjs 生效;`DateTimePicker` 也擴充,重複擴充無害)
dayjs.extend(utcPlugin);
dayjs.extend(timezonePlugin);

const DATE_FORMAT = "YYYY-MM-DD";

/** 那個時區此刻的日期(`YYYY-MM-DD`);沒給時區 = 瀏覽器時區。 */
export const todayIn = (timezone?: string): string =>
  (timezone === undefined ? dayjs() : dayjs().tz(timezone)).format(DATE_FORMAT);

/** `YYYY-MM-DD` 那一天在時區 00:00 的 epoch 毫秒;沒給時區 = 瀏覽器時區。 */
export const dayStartIn = (date: string, timezone?: string): number =>
  timezone === undefined
    ? dayjs(date).startOf("day").valueOf()
    : dayjs.tz(date, timezone).valueOf();

/**
 * 下一天 00:00 的 epoch 毫秒。先算出下一天的日期字串再換時點,
 * 不在時區物件上 `add(1, "day")`(夏令時間切換日那天長度不是 24 小時)。
 */
export const nextDayStartIn = (date: string, timezone?: string): number =>
  dayStartIn(dayjs(date).add(1, "day").format(DATE_FORMAT), timezone);

/** 時點在那個時區的 `HH:mm`;沒給時區 = 瀏覽器時區。 */
export const clockIn = (ms: number, timezone?: string): string =>
  (timezone === undefined ? dayjs(ms) : dayjs(ms).tz(timezone)).format("HH:mm");
