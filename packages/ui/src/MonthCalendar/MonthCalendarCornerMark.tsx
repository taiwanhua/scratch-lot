"use client";

import type { Theme } from "@mui/material/styles";

import { Box } from "../Box/Box";
import type {
  MonthCalendarCorner,
  MonthCalendarSize,
} from "./month-calendar-types";

export interface MonthCalendarCornerMarkProps {
  corner: MonthCalendarCorner;
}

/**
 * 貼右上角;`medium` 在手機小格(約 48px)縮小留白,`small` 一律小留白;
 * 疊在 `content` 的鋪滿裝飾之上(見 `MonthCalendarDayCell`)。
 */
const cornerPosition = (theme: Theme, size: MonthCalendarSize) => {
  const inset =
    size === "small"
      ? theme.spacing(0.5)
      : { xs: theme.spacing(0.5), md: theme.spacing(1) };
  return { position: "absolute", zIndex: 1, top: inset, right: inset };
};

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

/** 角標最少顯示幾個(同 MUI `AvatarGroup`:`max` 小於 2 時以 2 計,收合後至少還看得到一個)。 */
const MIN_CORNERS = 2;

/** 各尺寸預設最多顯示幾個角標(含「+N」那一個)。 */
export const DEFAULT_MAX_CORNERS: Record<MonthCalendarSize, number> = {
  small: 2,
  medium: 3,
};

/** 角標能報讀的文字:小圓點的 `label`、內容是字串的 badge;其他(自訂節點)沒有。 */
const spokenTextOf = (corner: MonthCalendarCorner): string | null => {
  if (corner.variant === "dot") return corner.label;
  return typeof corner.content === "string" ? corner.content : null;
};

/** 「+N」的預設無障礙名稱:被收起來的角標都有文字時逐一列出,否則只說個數。 */
export const defaultMoreCornersLabel = (
  hidden: readonly MonthCalendarCorner[],
): string => {
  const texts = hidden.map((corner) => spokenTextOf(corner));
  return texts.every((text) => text !== null)
    ? `還有:${texts.join("、")}`
    : `還有 ${String(hidden.length)} 個標記`;
};

/** 依上限切出要畫的角標與收進「+N」的角標(超過上限時「+N」佔最後一格)。 */
export const splitCorners = (
  corners: readonly MonthCalendarCorner[],
  max: number,
): {
  visible: readonly MonthCalendarCorner[];
  hidden: readonly MonthCalendarCorner[];
} => {
  const limit = Math.max(MIN_CORNERS, Math.floor(max));
  if (corners.length <= limit) {
    return { visible: corners, hidden: [] };
  }
  return {
    visible: corners.slice(0, limit - 1),
    hidden: corners.slice(limit - 1),
  };
};

export interface MonthCalendarCornerMarksProps {
  corners: readonly MonthCalendarCorner[];
  size: MonthCalendarSize;
  /** 最多顯示幾個(含「+N」);超過時其餘收成「+N」 */
  max: number;
  /** 「+N」的無障礙名稱 */
  formatMoreLabel: (hidden: readonly MonthCalendarCorner[]) => string;
}

/**
 * 日期格右上角的角標列:多個角標依陣列順序由左到右並排(例:缺卡紅點在前、有異動金點在後),
 * 間距 4px;超過 `max` 個時前面的照畫、其餘收成「+N」(MUI `AvatarGroup` 的慣例)。
 * 整列有寬度上限,手機小格與 `small` 不蓋住日期數字(小格約放得下兩個角標,所以 `small` 預設上限 2)。
 */
export const MonthCalendarCornerMarks = ({
  corners,
  size,
  max,
  formatMoreLabel,
}: MonthCalendarCornerMarksProps) => {
  if (corners.length === 0) {
    return null;
  }
  const { visible, hidden } = splitCorners(corners, max);
  return (
    <Box
      component="span"
      data-corners={corners.length}
      sx={(theme) => ({
        ...cornerPosition(theme, size),
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        // 不蓋住日期數字;放不下的 badge 文字由 badge 自己省略
        maxWidth: size === "small" ? "45%" : { xs: "45%", md: "70%" },
      })}
    >
      {visible.map((corner, index) => (
        <MonthCalendarCornerMark key={String(index)} corner={corner} />
      ))}
      {hidden.length > 0 ? (
        <Box
          component="span"
          role="img"
          aria-label={formatMoreLabel(hidden)}
          data-corner="more"
          sx={{
            flexShrink: 0,
            typography: "caption",
            fontWeight: 600,
            lineHeight: 1,
            color: "text.secondary",
          }}
        >
          +{hidden.length}
        </Box>
      ) : null}
    </Box>
  );
};
