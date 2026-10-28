import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { dayOffHatchSx } from "../DayOffs/day-off-styles";
import {
  autoMarkSx,
  closedBlockSx,
  cornerDotSx,
  demandDotSx,
  entryBlockSx,
  extensionSwatchSx,
  leaderMarkSx,
  legendSwatchSx,
  moreSampleSx,
  multiBadgeSx,
  unmatchedPunchSx,
  vacancySwatchSx,
} from "./schedule-legend-styles";

/**
 * 班表管理的圖例項目(規格 14.5「圖例」)。每個檢視列自己畫面上**可能**出現的項目(不看當下資料;
 * 排班表各檢視的清單在 `roster/views/roster-legend.ts`);
 * 各功能追加自己的項目(本型別、元件裡的 `markOf` 與 i18n `admin.schedule.legend.items.*` 各加一筆)。
 */
export type ScheduleLegendItem =
  | "leader"
  | "entry"
  | "temp"
  | "tempEntry"
  | "auto"
  | "breakMinutes"
  | "unavailable"
  | "dayOff"
  | "missingLeader"
  | "missingHelper"
  | "full"
  | "multi"
  | "multiText"
  | "closed"
  | "special"
  | "unmatchedPunch"
  | "extension"
  | "vacancyLeader"
  | "vacancyHelper"
  | "moreNeutral"
  | "moreWarning"
  | "moreError"
  | "dotFull"
  | "dotMissingHelper"
  | "dotMissingLeader"
  | "punchTimes"
  | "changedDot"
  | "missingDot";

const swatch = (children?: ReactNode, sx: object = {}) => (
  <Box component="span" aria-hidden sx={[legendSwatchSx, sx]}>
    {children}
  </Box>
);

const mark = (text: string, sx: object) => (
  <Box component="span" aria-hidden sx={[{ typography: "caption" }, sx]}>
    {text}
  </Box>
);

export interface ScheduleLegendProps {
  items: readonly ScheduleLegendItem[];
}

/**
 * 班表管理的圖例(同一個元件、色塊或符號 + 文字;外觀與格子同一份樣式 `schedule-legend-styles.ts`)。
 */
export const ScheduleLegend = ({ items }: ScheduleLegendProps) => {
  const t = useTranslations("admin.schedule.legend");
  const markOf: Record<ScheduleLegendItem, ReactNode> = {
    leader: mark(t("sampleName"), leaderMarkSx),
    entry: swatch(null, { bgcolor: "primary.lighter", border: 0 }),
    temp: mark(t("tempMark"), { fontWeight: 600 }),
    // 我的班表:「臨」指的是沒有套用範本的班(同一個記號,文字不同)
    tempEntry: mark(t("tempMark"), { fontWeight: 600 }),
    auto: (
      <Box
        component="span"
        aria-hidden
        sx={[autoMarkSx, { position: "static", display: "inline-block" }]}
      >
        ✦
      </Box>
    ),
    breakMinutes: mark(t("breakSample"), { color: "text.secondary" }),
    unavailable: swatch(null, { bgcolor: "grey.100" }),
    dayOff: swatch(<Box sx={dayOffHatchSx} />),
    missingLeader: <Tag tone="error" label={t("countSample")} />,
    missingHelper: <Tag tone="warning" label={t("countSample")} />,
    full: <Tag tone="grey" label={t("countSample")} />,
    multi: mark("×2", multiBadgeSx),
    // 班表格子:範本簡稱後面寫「×2」(已排的班的底色),不是小徽章
    multiText: (
      <Box
        component="span"
        aria-hidden
        sx={[
          entryBlockSx,
          { position: "static", py: 0, typography: "caption", fontWeight: 600 },
        ]}
      >
        {t("multiTextSample")}
      </Box>
    ),
    closed: swatch(null, closedBlockSx),
    special: swatch(null, { borderColor: "text.secondary" }),
    unmatchedPunch: mark(t("punchSample"), unmatchedPunchSx),
    extension: swatch(null, extensionSwatchSx),
    vacancyLeader: swatch(null, vacancySwatchSx("error")),
    vacancyHelper: swatch(null, vacancySwatchSx("warning")),
    moreNeutral: mark(t("moreSample"), moreSampleSx("neutral")),
    moreWarning: mark(t("moreSample"), moreSampleSx("warning")),
    moreError: mark(t("moreSample"), moreSampleSx("error")),
    dotFull: mark("", demandDotSx("grey")),
    dotMissingHelper: mark("", demandDotSx("warning")),
    dotMissingLeader: mark("", demandDotSx("error")),
    punchTimes: mark(t("punchTimesSample"), { color: "text.secondary" }),
    changedDot: mark("", cornerDotSx("warning")),
    missingDot: mark("", cornerDotSx("error")),
  };
  return (
    <Stack
      direction="row"
      spacing={2}
      useFlexGap
      sx={{ flexWrap: "wrap", alignItems: "center" }}
      aria-label={t("title")}
    >
      {items.map((item) => (
        <Stack
          key={item}
          direction="row"
          spacing={0.75}
          sx={{ alignItems: "center" }}
        >
          {markOf[item]}
          <Typography variant="caption" color="textSecondary">
            {t(`items.${item}`)}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
};
