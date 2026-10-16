"use client";

import type { Theme } from "@mui/material/styles";

import { Box } from "../Box/Box";
import type { MonthCalendarCorner } from "./month-calendar-types";

export interface MonthCalendarCornerMarkProps {
  corner: MonthCalendarCorner;
}

/** 貼右上角;手機小格(約 48px)縮小留白。 */
const cornerPosition = (theme: Theme) => ({
  position: "absolute",
  top: { xs: theme.spacing(0.5), md: theme.spacing(1) },
  right: { xs: theme.spacing(0.5), md: theme.spacing(1) },
});

/** 日期格右上角的角標:小圓點或 error badge(Figma BS-23 260:6356 的角標示範)。 */
export const MonthCalendarCornerMark = ({
  corner,
}: MonthCalendarCornerMarkProps) =>
  corner.variant === "dot" ? (
    <Box
      component="span"
      role="img"
      aria-label={corner.label}
      data-corner="dot"
      sx={(theme) => ({
        ...cornerPosition(theme),
        width: theme.spacing(1),
        height: theme.spacing(1),
        borderRadius: "50%",
        bgcolor: `${corner.color}.main`,
      })}
    />
  ) : (
    <Box
      component="span"
      data-corner="badge"
      sx={(theme) => ({
        ...cornerPosition(theme),
        typography: "caption",
        fontWeight: 600,
        px: 0.75,
        // 膠囊(同 Tag 的 999):與品牌無關的形狀值
        borderRadius: "999px",
        bgcolor: "error.main",
        color: "error.contrastText",
        // 手機小格不蓋住日期數字
        maxWidth: { xs: "45%", md: "70%" },
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      })}
    >
      {corner.content}
    </Box>
  );
