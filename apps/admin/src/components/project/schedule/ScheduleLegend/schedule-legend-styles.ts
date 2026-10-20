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

/** 不能排(店休、已排在其他分店、時段不可排):灰色區塊。 */
export const unavailableBlockSx: Sx = {
  position: "relative",
  bgcolor: "grey.100",
  color: "text.secondary",
  borderRadius: 1,
  px: 0.75,
  py: 0.5,
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
