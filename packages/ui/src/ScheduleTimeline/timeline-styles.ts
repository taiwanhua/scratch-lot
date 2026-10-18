import type { Theme } from "@mui/material/styles";

import type {
  ScheduleTimelineBarTone,
  ScheduleTimelineGroupTone,
  ScheduleTimelineMoreTone,
} from "./schedule-timeline-types";

/**
 * 時間軸各元素共用的樣式片段(Figma Draft/ScheduleTimelineBlock、
 * Draft/ScheduleTimelineDemand、Draft/ScheduleTimelineMore)。
 */

/** 長條 / 缺額空位的色系:底 lighter、左框 / 虛線框 main、字 darker(primary 字用一般文字色)。 */
export const barToneColors = (tone: ScheduleTimelineBarTone) => ({
  bgcolor: `${tone}.lighter`,
  border: `${tone}.main`,
  text: tone === "primary" ? "text.primary" : `${tone}.darker`,
});

/** 容器框色 / 標題字色。 */
export const groupToneColors = (tone: ScheduleTimelineGroupTone) =>
  tone === "neutral"
    ? { border: "divider", text: "text.secondary" }
    : { border: `${tone}.main`, text: `${tone}.darker` };

/** 「+N」長條的框色 / 字色,以及互動狀態疊哪個色系。 */
export const moreToneColors = (tone: ScheduleTimelineMoreTone) =>
  tone === "neutral"
    ? { border: "divider", text: "text.secondary", layer: "grey" as const }
    : { border: `${tone}.main`, text: `${tone}.darker`, layer: tone };

/** 標題字:Caption / SemiBold(12px、600)。 */
export const captionStrongSx = {
  typography: "caption",
  fontWeight: 600,
  lineHeight: 1.5,
} as const;

/** 週模式窄長條的直排文字(中文一字一行,字身直立)。 */
export const verticalTextSx = {
  writingMode: "vertical-rl",
  textOrientation: "upright",
  whiteSpace: "nowrap",
  overflow: "hidden",
} as const;

/** 單行、超出以省略號截斷。 */
export const ellipsisSx = {
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
} as const;

/**
 * 每小時一條格線(分隔線色):週模式橫線(`y`)、日模式直線(`x`)。
 * 用背景漸層畫,不多出 24 個節點。
 */
export const hourLinesSx = (theme: Theme, axis: "x" | "y", step: number) => {
  const color = (theme.vars ?? theme).palette.divider;
  return {
    backgroundImage: `repeating-linear-gradient(${axis === "y" ? "to bottom" : "to right"}, transparent 0, transparent ${String(step - 1)}px, ${color} ${String(step - 1)}px, ${color} ${String(step)}px)`,
  };
};
