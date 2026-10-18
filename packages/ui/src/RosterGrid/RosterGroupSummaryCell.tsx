"use client";

import { Box } from "../Box/Box";
import { tagToneStyles } from "../Tag/tag-tones";
import type { RosterTopGroupSummary } from "./roster-grid-types";

export interface RosterGroupSummaryCellProps {
  summary: RosterTopGroupSummary;
}

/**
 * 頂部群組收合時的每日彙總:主行 + 副行(例「需 4 · 已排 3」/「缺 1 · 可排 2」),
 * 底色與字色同 `Tag` 的色調(Figma Draft/RosterGrid Group=Collapsed)。
 */
export const RosterGroupSummaryCell = ({
  summary,
}: RosterGroupSummaryCellProps) => (
  <Box
    sx={{
      display: "inline-flex",
      flexDirection: "column",
      maxWidth: "100%",
      px: 0.75,
      py: 0.25,
      borderRadius: 0.75,
      ...tagToneStyles[summary.tone ?? "grey"],
    }}
  >
    <Box component="span" sx={{ typography: "caption", fontWeight: 600 }}>
      {summary.primary}
    </Box>
    {summary.secondary === undefined ? null : (
      <Box component="span" sx={{ typography: "caption", opacity: 0.8 }}>
        {summary.secondary}
      </Box>
    )}
  </Box>
);
