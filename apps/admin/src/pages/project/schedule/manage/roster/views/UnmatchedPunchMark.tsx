import { useTranslations } from "use-intl";

import { Box, type BoxProps } from "@repo/ui/box";

import { unmatchedPunchSx } from "@/components/project/schedule/ScheduleLegend/schedule-legend-styles";

/** 單一樣式物件(放的位置;呼叫端各自給)。 */
type Placement = Exclude<NonNullable<BoxProps["sx"]>, readonly unknown[]>;

export interface UnmatchedPunchMarkProps {
  /** 那天(或那人那天)未對應排班的打卡張數;0 = 不顯示 */
  count: number;
  /** 放的位置(例:月檢視格子右上角 `position: absolute`) */
  placement?: Placement;
}

/**
 * 未對應排班的打卡「⏲ N」(規格 14.5「未對應排班的打卡」;外觀同圖例 `unmatchedPunch`):週 / 日檢視的日期旁、
 * 手機日檢視與手機週清單那天、月檢視那天格子、班表店休的格子(只標示、不能點)共用。張數由呼叫端從排班表的 `unmatchedPunches` 算
 * (`unmatchedCountsByDate`)。班表格子的時鐘圖示可以點,另外在 `RosterPersonCell` 畫。
 */
export const UnmatchedPunchMark = ({
  count,
  placement = {},
}: UnmatchedPunchMarkProps) => {
  const t = useTranslations("admin.schedule.roster.timeline");
  if (count <= 0) {
    return null;
  }
  return (
    <Box
      component="span"
      aria-label={t("punchAria", { count })}
      sx={[unmatchedPunchSx, placement]}
    >
      {t("punch", { count })}
    </Box>
  );
};
