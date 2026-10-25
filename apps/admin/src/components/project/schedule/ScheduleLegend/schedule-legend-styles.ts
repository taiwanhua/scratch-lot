import type { BoxProps } from "@repo/ui/box";

/**
 * 班表管理的外觀(規格 14.5「圖例」:畫面上每個顏色、圖示、符號都在同畫面的圖例找得到外觀一樣的項目;
 * 同一顏色 / 符號在整個模組只有一個意思)。排班表的格子、標籤與圖例共用同一份。
 * 畫休的灰色斜線底在 `DayOffs/day-off-styles.ts`(`dayOffHatchSx`)。
 */

/** 單一樣式物件(不是陣列):呼叫端可以用 `sx={[這個, 其他]}` 疊加。 */
type Sx = Exclude<NonNullable<BoxProps["sx"]>, readonly unknown[]>;

/** 已排的班(格子底色;淡黃只代表已排的班)。 */
export const entryBlockSx: Sx = {
  position: "relative",
  bgcolor: "primary.lighter",
  borderRadius: 1,
  px: 0.75,
  py: 0.5,
};

/** 負責人:名字或範本簡稱套 success/lighter 底、success/darker 字(綠色只代表負責人)。 */
export const leaderMarkSx: Sx = {
  bgcolor: "success.lighter",
  color: "success.darker",
  borderRadius: 0.5,
  px: 0.5,
  fontWeight: 600,
};

/** 不能排(已排在其他分店、時段不可排):灰色區塊。店休用 `closedBlockSx`。 */
export const unavailableBlockSx: Sx = {
  position: "relative",
  bgcolor: "grey.100",
  color: "text.secondary",
  borderRadius: 1,
  px: 0.75,
  py: 0.5,
};

/** 店休(整天不能排;時間軸的停用區、手機週清單那一列、班表格子同一個停用底色)。 */
export const closedBlockSx: Sx = {
  bgcolor: "action.disabledBackground",
  color: "text.secondary",
};

/** 自動排入的小圖示(右上角;四種檢視一致)。 */
export const autoMarkSx: Sx = {
  position: "absolute",
  top: -6,
  right: -6,
  width: 14,
  height: 14,
  borderRadius: "50%",
  bgcolor: "primary.main",
  color: "primary.contrastText",
  fontSize: "0.5625rem",
  lineHeight: "14px",
  textAlign: "center",
};

/** 圖例的一格色塊。 */
export const legendSwatchSx: Sx = {
  position: "relative",
  display: "inline-flex",
  width: (theme) => theme.spacing(3),
  height: (theme) => theme.spacing(2),
  border: 1,
  borderColor: "divider",
  borderRadius: 0.5,
  overflow: "hidden",
};

/** 「×2」:同一筆排班同一段時間填進兩筆以上人力需求(灰色小徽章;同底座 Tag 的 grey)。 */
export const multiBadgeSx: Sx = {
  bgcolor: "grey.200",
  color: "grey.700",
  borderRadius: 0.5,
  px: 0.5,
  fontSize: "0.6875rem",
  fontWeight: 600,
  lineHeight: 1.5,
};

/** 未對應排班的打卡(⏲ + 張數):橘框小膠囊(月檢視日期格右上角、圖例)。 */
export const unmatchedPunchSx: Sx = {
  display: "inline-flex",
  alignItems: "center",
  gap: 0.25,
  border: 1,
  borderColor: "warning.main",
  color: "warning.darker",
  bgcolor: "warning.lighter",
  borderRadius: 1,
  px: 0.5,
  fontSize: "0.6875rem",
  fontWeight: 600,
  lineHeight: 1.5,
};

/** 超出人力需求的時間(長條延伸的淡色虛線段;同底座 `ScheduleTimeline` 的延伸段)。 */
export const extensionSwatchSx: Sx = {
  bgcolor: "primary.lighter",
  opacity: 0.7,
  borderStyle: "dashed",
  borderColor: "primary.main",
};

/** 缺額虛線空位:缺負責紅、缺協同橘。 */
export const vacancySwatchSx = (tone: "error" | "warning"): Sx => ({
  bgcolor: `${tone}.lighter`,
  borderStyle: "dashed",
  borderColor: `${tone}.main`,
});

/** 「+N」長條的樣本:框色依收起的需求(灰 / 橘 / 紅)。 */
export const moreSampleSx = (tone: "neutral" | "warning" | "error"): Sx => ({
  border: 1,
  borderColor: tone === "neutral" ? "divider" : `${tone}.main`,
  color: tone === "neutral" ? "text.secondary" : `${tone}.darker`,
  bgcolor: "background.default",
  borderRadius: 0.75,
  px: 0.5,
  fontWeight: 600,
});

/** 手機月檢視:每筆人力需求一顆實心點(三態:已滿灰、缺協同橘、缺負責紅)。 */
export const demandDotSx = (tone: "grey" | "warning" | "error"): Sx => ({
  display: "inline-block",
  width: 6,
  height: 6,
  borderRadius: "50%",
  bgcolor: tone === "grey" ? "grey.400" : `${tone}.main`,
});

/** 月曆日期格右上角的小圓點(底座 `MonthCalendar` 的 `corner: dot`,8px):我的班表的有異動 / 缺卡。 */
export const cornerDotSx = (tone: "warning" | "error"): Sx => ({
  display: "inline-block",
  width: 8,
  height: 8,
  borderRadius: "50%",
  bgcolor: `${tone}.main`,
});
