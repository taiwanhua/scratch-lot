"use client";

import type { Theme } from "@mui/material/styles";

import { Box } from "../Box/Box";
import type { MonthCalendarCorner } from "./month-calendar-types";

export interface MonthCalendarCornerMarkProps {
  corner: MonthCalendarCorner;
}

/** 貼右上角;手機小格(約 48px)縮小留白;疊在 `content` 的鋪滿裝飾之上(見 `MonthCalendarDayCell`)。 */
const cornerPosition = (theme: Theme) => ({
  position: "absolute",
  zIndex: 1,
  top: { xs: theme.spacing(0.5), md: theme.spacing(1) },
  right: { xs: theme.spacing(0.5), md: theme.spacing(1) },
});

/** 一個角標:小圓點或 error badge(Figma 的角標示範);位置由 `MonthCalendarCornerMarks` 決定。 */
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
        flexShrink: 0,
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
      sx={{
        minWidth: 0,
        typography: "caption",
        fontWeight: 600,
        px: 0.75,
        // 膠囊(同 Tag 的 999):與品牌無關的形狀值
        borderRadius: "999px",
        bgcolor: "error.main",
        color: "error.contrastText",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {corner.content}
    </Box>
  );

export interface MonthCalendarCornerMarksProps {
  corners: readonly MonthCalendarCorner[];
}

/**
 * 日期格右上角的角標列:多個角標依陣列順序由左到右並排(例:缺卡紅點在前、有異動金點在後),
 * 間距 4px;手機小格縮小留白、整列不蓋住日期數字。
 */
export const MonthCalendarCornerMarks = ({
  corners,
}: MonthCalendarCornerMarksProps) =>
  corners.length === 0 ? null : (
    <Box
      component="span"
      data-corners={corners.length}
      sx={(theme) => ({
        ...cornerPosition(theme),
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        // 手機小格不蓋住日期數字
        maxWidth: { xs: "45%", md: "70%" },
      })}
    >
      {corners.map((corner, index) => (
        <MonthCalendarCornerMark key={String(index)} corner={corner} />
      ))}
    </Box>
  );
