import { useState } from "react";
import { useTranslations } from "use-intl";

import type { MyScheduleQuery } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Collapse } from "@repo/ui/collapse";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { timeRangeOf } from "@/lib/project/schedule-my";

import { useMyEntryText } from "./useMyEntryText";

type Change = MyScheduleQuery["mySchedule"]["changes"][number];

export interface ChangesBannerProps {
  changes: readonly Change[];
  /** 晚於上次打開這一頁的異動(標「新」) */
  newIds: ReadonlySet<string>;
}

/**
 * 最近異動橫幅(SC-38;規格 14.6「最近異動」):有異動才出現「你的班表有 2 項異動 [展開]」,
 * 展開列出日期、原本 → 現在、原因;只列還沒到的班(api 已過濾);晚於上次打開這一頁的標「新」。
 */
export const ChangesBanner = ({ changes, newIds }: ChangesBannerProps) => {
  const t = useTranslations("admin.schedule.mySchedule.changes");
  const text = useMyEntryText();
  const [expanded, setExpanded] = useState(false);
  if (changes.length === 0) {
    return null;
  }
  const spanOf = (startAt: string | null, endAt: string | null) =>
    startAt === null || endAt === null
      ? null
      : timeRangeOf({ startAt, endAt }, text.timezone);
  const describe = (change: Change) => {
    const before = spanOf(
      change.beforeStartAt ?? null,
      change.beforeEndAt ?? null,
    );
    const after = spanOf(
      change.afterStartAt ?? null,
      change.afterEndAt ?? null,
    );
    if (before === null) {
      return t("created", { after: after ?? "" });
    }
    if (after === null) {
      return t("deleted", { before });
    }
    return t("edited", { before, after });
  };
  const reasonOf = (change: Change) =>
    change.reasonNote === null || change.reasonNote === undefined
      ? t("reason", { reason: change.reason })
      : t("reasonWithNote", { reason: change.reason, note: change.reasonNote });

  return (
    <Box component="section" data-changes-banner>
      <Stack direction="row" sx={{ alignItems: "center" }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {t("banner", { count: changes.length })}
        </Typography>
        <Button
          variant="text"
          size="small"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((value) => !value);
          }}
        >
          {expanded ? t("collapse") : t("expand")}
        </Button>
      </Stack>
      <Collapse in={expanded}>
        <Stack spacing={1} sx={{ pt: 1 }}>
          {changes.map((change) => (
            <Stack
              key={change.id}
              direction="row"
              spacing={1.5}
              useFlexGap
              sx={{ alignItems: "center", flexWrap: "wrap" }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {text.dateTitle(change.date)}
              </Typography>
              <Typography variant="body2">
                {[change.orgName, describe(change)].join(" ")}
              </Typography>
              <Typography variant="caption" color="textSecondary">
                {reasonOf(change)}
              </Typography>
              {newIds.has(change.id) && <Tag tone="warning" label={t("new")} />}
            </Stack>
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
};
