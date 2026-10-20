import type { BoxProps } from "@repo/ui/box";
import type { TagTone } from "@repo/ui/tag";

import type { DayOffBandLevel } from "@/lib/project/schedule-day-offs";

/**
 * 畫休的外觀(規格 14.5「圖例」、14.6:畫休一律灰色斜線底;色帶紅 = 違反限制、橘 = 提醒;
 * 「2/2」未滿灰、滿了橘、超過紅)。月曆格子與圖例共用同一份,圖例的外觀才會和格子一樣。
 */

type Sx = NonNullable<BoxProps["sx"]>;

/** 灰色斜線底的線距(一條線 + 一段空白,px;Figma「我的畫休(斜線)」)。設計值,只有畫休用到(STYLE-06)。 */
const HATCH_STEP = 6;

/** 灰色斜線底:鋪滿父層(父層要 `position: relative`)。 */
export const dayOffHatchSx: Sx = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  backgroundImage: (theme) =>
    `repeating-linear-gradient(135deg, ${theme.palette.grey[400]} 0 1px, transparent 1px ${String(HATCH_STEP)}px)`,
};

/** 色帶的顏色。 */
const BAND_COLOR: Record<DayOffBandLevel, "error.main" | "warning.main"> = {
  limit: "error.main",
  reminder: "warning.main",
};

/** 底部色帶:貼著格子底邊、左右留白。 */
export const dayOffBandSx = (level: DayOffBandLevel): Sx => ({
  position: "absolute",
  left: (theme) => theme.spacing(1),
  right: (theme) => theme.spacing(1),
  bottom: (theme) => theme.spacing(0.5),
  height: (theme) => theme.spacing(0.5),
  borderRadius: 1,
  bgcolor: BAND_COLOR[level],
});

/** 「2/2」的字色:未滿灰、滿了橘、超過紅。 */
const COUNT_COLOR: Record<TagTone, string> = {
  grey: "text.secondary",
  primary: "primary.main",
  success: "success.main",
  warning: "warning.dark",
  error: "error.main",
};

export const dayOffCountSx = (tone: TagTone): Sx => ({
  color: COUNT_COLOR[tone],
  fontWeight: tone === "grey" ? undefined : 600,
});
