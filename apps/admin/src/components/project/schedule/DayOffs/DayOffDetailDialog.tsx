import { useTranslations } from "use-intl";

import type {
  ScheduleDayOffDayFieldsFragment,
  ScheduleDayOffViolationFieldsFragment,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import type { TagTone } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { useDayOffDateTitle } from "@/hooks/project/schedule/useDayOffDateTitle/useDayOffDateTitle";
import { dayOffCountTone, violationsOn } from "@/lib/project/schedule-day-offs";

/** 「(2/2 已滿)」的文案依顏色:未滿 / 滿了 / 超過。 */
const COUNT_KEY: Record<TagTone, "countSuffix" | "countFull" | "countOver"> = {
  grey: "countSuffix",
  primary: "countSuffix",
  success: "countSuffix",
  warning: "countFull",
  error: "countOver",
};

export interface DayOffDetailDialogProps {
  date: string;
  /** 那天的畫休(沒有人畫休 = undefined) */
  day: ScheduleDayOffDayFieldsFragment | undefined;
  /** 同日最多畫休人數(規則關掉 = null) */
  limit: number | null;
  violations: readonly ScheduleDayOffViolationFieldsFragment[];
  onClose: () => void;
}

/**
 * 當天畫休詳細(SC-42;規格 14.6「點格子的 ⓘ」):誰整天畫休、誰時段不可排(含時間)、同日人數、
 * 涉及哪些規則。電腦 / 平板置中小視窗,手機全螢幕(規格 16.0 的底部面板以全螢幕對話框呈現)。
 */
export const DayOffDetailDialog = ({
  date,
  day,
  limit,
  violations,
  onClose,
}: DayOffDetailDialogProps) => {
  const t = useTranslations("admin.schedule.dayOffs.detail");
  const tRules = useTranslations("admin.schedule.rules");
  const tCommon = useTranslations("admin.schedule.common");
  const isMobile = useBreakpointDown("sm");
  const title = useDayOffDateTitle();
  const dayOffs = day?.dayOffs ?? [];
  const fullDay = [
    ...new Set(
      dayOffs
        .filter((item) => item.kind === "full-day")
        .map((item) => item.name),
    ),
  ];
  const timeRanges = dayOffs.filter((item) => item.kind === "time-range");
  const count = day?.staffCount ?? 0;
  const countText =
    limit === null
      ? ""
      : t(COUNT_KEY[dayOffCountTone(count, limit)], { count, limit });
  const rules = violationsOn(violations, date);

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="xs"
      title={title(date)}
      actions={
        <Button variant="text" onClick={onClose}>
          {tCommon("close")}
        </Button>
      }
    >
      <Stack spacing={1.5} sx={{ pt: 1 }}>
        <Typography variant="subtitle2">
          {t("fullDayTitle")}
          {countText}
        </Typography>
        <Typography variant="body2">
          {fullDay.length === 0 ? t("none") : fullDay.join("、")}
        </Typography>
        <Typography variant="subtitle2">{t("timeRangeTitle")}</Typography>
        {timeRanges.length === 0 ? (
          <Typography variant="body2">{t("none")}</Typography>
        ) : (
          timeRanges.map((item) => (
            <Typography key={item.id} variant="body2">
              {t("timeRangeItem", {
                name: item.name,
                start: item.startTime ?? "",
                end: item.endTime ?? "",
              })}
            </Typography>
          ))
        )}
        <Typography variant="subtitle2">{t("rulesTitle")}</Typography>
        {rules.length === 0 ? (
          <Typography variant="body2">{t("none")}</Typography>
        ) : (
          rules.map((rule) => (
            <Stack
              key={`${rule.key}-${rule.from ?? ""}`}
              direction="row"
              spacing={1}
              sx={{ alignItems: "center" }}
            >
              <Tag
                tone={rule.level === "limit" ? "error" : "warning"}
                label={tRules(`levels.${rule.level}`)}
              />
              <Typography variant="body2">
                {t("ruleItem", {
                  label: tRules(`labels.${rule.key}`),
                  limit: rule.limit ?? "",
                })}
              </Typography>
            </Stack>
          ))
        )}
      </Stack>
    </Dialog>
  );
};
