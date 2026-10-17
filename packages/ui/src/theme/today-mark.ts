import type { CSSObject, Theme } from "@mui/material/styles";

/** 今天標示的形狀:日期數字一兩位數 → 圓;「11/17」這類較寬的日期文字 → 膠囊。 */
export type TodayMarkShape = "circle" | "pill";

/**
 * 日期文字外的那一圈(《底座規格》10.5 / 10.11):高 24px、置中;是今天時畫成主色
 * (`primary.main`)實心底、字色 `primary.contrastText`(依主色自動選深 / 淺字)、粗體。
 * `MonthCalendar` 的日期數字(圓)與 `ScheduleTimeline` 的日期表頭(膠囊)共用這一份,
 * 兩邊只差形狀。本檔是 ui 內部用的(同 `state-layer.ts`),不從 `theme/index.ts` 匯出。
 */
export const todayMarkSx = (
  theme: Theme,
  { isToday, shape }: { isToday: boolean; shape: TodayMarkShape },
): CSSObject => ({
  height: theme.spacing(3),
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  ...(shape === "circle"
    ? { width: theme.spacing(3), borderRadius: "50%" }
    : {
        minWidth: theme.spacing(3),
        paddingInline: isToday ? theme.spacing(0.75) : 0,
        borderRadius: theme.spacing(1.5),
      }),
  ...(isToday && {
    backgroundColor: (theme.vars ?? theme).palette.primary.main,
    color: (theme.vars ?? theme).palette.primary.contrastText,
    fontWeight: 600,
  }),
});
