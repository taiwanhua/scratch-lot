import type { ReactNode } from "react";

import { Box } from "@repo/ui/box";
import { IconButton } from "@repo/ui/icon-button";
import { Typography } from "@repo/ui/typography";

import {
  type DayOffBandLevel,
  dayOffCountTone,
} from "@/lib/project/schedule-day-offs";

import { dayOffBandSx, dayOffCountSx, dayOffHatchSx } from "./day-off-styles";

export interface DayOffCellContentProps {
  /** 格子裡的文字(一行一項,例「畫休」「09:00–13:00 不可排」「畫休 王小明、林美麗」) */
  lines: readonly string[];
  /** 同日畫休人數;沒有人畫休的日子不給 */
  count?: { count: number; limit: number | null; text: string };
  /** 整格灰色斜線底(我的畫休:我那天有畫休) */
  hatched?: boolean;
  /** 底部色帶(紅 = 違反限制、橘 = 提醒) */
  band?: DayOffBandLevel | null;
  /** 右上角 ⓘ:看當天誰畫休 */
  info?: { label: string; onClick: () => void };
}

/**
 * 畫休月曆一格的內容(我的畫休 SC-02、畫休總覽 SC-06 共用):斜線底與色帶鋪滿整格,
 * 文字與「2/2」疊在上面;ⓘ 是獨立的按鈕(點了不會觸發選日期)。
 */
export const DayOffCellContent = ({
  lines,
  count,
  hatched = false,
  band = null,
  info,
}: DayOffCellContentProps): ReactNode => (
  <>
    {hatched && <Box aria-hidden sx={dayOffHatchSx} />}
    {band !== null && (
      <Box data-band={band} aria-hidden sx={dayOffBandSx(band)} />
    )}
    {info !== undefined && (
      <IconButton
        size="small"
        aria-label={info.label}
        sx={{
          position: "absolute",
          top: (theme) => theme.spacing(0.25),
          right: (theme) => theme.spacing(0.25),
          p: 0.25,
        }}
        onClick={(event) => {
          event.stopPropagation();
          info.onClick();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
        }}
      >
        <Typography component="span" variant="caption" color="text.secondary">
          ⓘ
        </Typography>
      </IconButton>
    )}
    <Box
      sx={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 0.25,
        minWidth: 0,
      }}
    >
      {lines.map((line) => (
        <Typography
          key={line}
          variant="caption"
          sx={{
            display: { xs: "none", sm: "block" },
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {line}
        </Typography>
      ))}
      {count !== undefined && (
        <Typography
          variant="caption"
          sx={dayOffCountSx(dayOffCountTone(count.count, count.limit))}
        >
          {count.text}
        </Typography>
      )}
    </Box>
  </>
);
