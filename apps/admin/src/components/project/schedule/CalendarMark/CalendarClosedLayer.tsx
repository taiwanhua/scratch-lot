import { Box } from "@repo/ui/box";

import { calendarMarkBackground } from "./calendar-mark";

/**
 * 店休整格店休灰(`calendarMarkBackground` 的店休色),鋪在底座 `MonthCalendar` 每日 `content` 的底層:
 * 底座 `disabled` 會讓格子不能點,要可點的月曆(我的班表月曆、行事曆分頁)用這層代替;日期與註記由底座疊在上面。
 */
export const CalendarClosedLayer = () => (
  <Box
    aria-hidden
    data-closed-layer
    sx={{
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
      bgcolor: calendarMarkBackground({ kind: "closed" }),
    }}
  />
);
