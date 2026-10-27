import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { dayOffBandSx, dayOffCountSx, dayOffHatchSx } from "./day-off-styles";

export interface DayOffLegendProps {
  /** 我的畫休:多色帶、ⓘ 與「我的畫休(斜線)」;總覽:同日人數的說明多寫「只算主要分店的人」 */
  variant: "mine" | "overview";
}

/** 圖例的一格色塊(外觀與月曆格子同一份樣式)。 */
const swatch = (children: ReactNode) => (
  <Box
    component="span"
    aria-hidden
    sx={{
      position: "relative",
      display: "inline-flex",
      width: (theme) => theme.spacing(3),
      height: (theme) => theme.spacing(2),
      border: 1,
      borderColor: "divider",
      borderRadius: 0.5,
      overflow: "hidden",
    }}
  >
    {children}
  </Box>
);

/** 圖例的一項:色塊或符號 + 文字。 */
const item = (key: string, mark: ReactNode, label: string) => (
  <Stack key={key} direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
    {mark}
    <Typography variant="caption" color="textSecondary">
      {label}
    </Typography>
  </Stack>
);

/**
 * 畫休的圖例(規格 14.5「圖例」:畫面上每個顏色、符號都在同畫面的圖例找得到外觀一樣的項目)。
 * 色塊與格子用同一份樣式(`day-off-styles.ts`)。
 */
export const DayOffLegend = ({ variant }: DayOffLegendProps) => {
  const t = useTranslations("admin.schedule.dayOffs");
  const text = (value: string) => (
    <Typography variant="caption" sx={{ fontWeight: 600 }}>
      {value}
    </Typography>
  );
  const items = [
    item("full-day", text(t("cellFullDay")), t("legend.fullDay")),
    item(
      "time-range",
      text(t("cellTimeRange", { start: "09:00", end: "13:00" })),
      t("legend.timeRange"),
    ),
    item(
      "count",
      <Typography variant="caption" sx={dayOffCountSx("warning")}>
        {t("count", { count: 2, limit: 2 })}
      </Typography>,
      variant === "mine" ? t("legend.count") : t("legend.countOverview"),
    ),
    ...(variant === "mine"
      ? [
          item(
            "limit",
            swatch(<Box sx={dayOffBandSx("limit")} />),
            t("legend.limitBand"),
          ),
          item(
            "reminder",
            swatch(<Box sx={dayOffBandSx("reminder")} />),
            t("legend.reminderBand"),
          ),
          item(
            "info",
            <Typography variant="caption" color="textSecondary">
              ⓘ
            </Typography>,
            t("legend.info"),
          ),
          item("mine", swatch(<Box sx={dayOffHatchSx} />), t("legend.mine")),
        ]
      : []),
  ];
  return (
    <Stack
      direction="row"
      spacing={2}
      useFlexGap
      sx={{ flexWrap: "wrap", alignItems: "center" }}
    >
      {items}
    </Stack>
  );
};
