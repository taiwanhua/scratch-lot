"use client";

/** `@repo/ui/schedule-timeline` 的出口:bunchee 依 exports 名找 `src/<名>`,元件檔為 PascalCase(GEN-01)。 */
export * from "./ScheduleTimeline/ScheduleTimeline";
/** 週模式的排版純函式(元件內部同一份):模組要依同一套規則算「+N」或寫測試時用,不另寫排版。 */
export {
  layoutTimeline,
  timelineGroupWidth,
  type TimelineLayout,
  type TimelineLayoutGroup,
  type TimelinePlacement,
} from "./ScheduleTimeline/layout-timeline";
