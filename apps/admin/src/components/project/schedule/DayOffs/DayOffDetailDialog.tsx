import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import type {
  ScheduleDayOffDayFieldsFragment,
  ScheduleDayOffFieldsFragment,
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
  /** 涉及的規則(人的規則);不給 = 不顯示「涉及的規則」(畫休總覽沒有個人規則) */
  violations?: readonly ScheduleDayOffViolationFieldsFragment[];
  /** 給了 = 每筆畫休旁邊一個 [刪除](代改權限;確認與原因由呼叫端處理) */
  onDelete?: (item: ScheduleDayOffFieldsFragment) => void;
  /** [關閉] 左邊的其他按鈕(例:畫休總覽的 [代改]) */
  extraActions?: ReactNode;
  onClose: () => void;
}

/**
 * 當天畫休詳細(SC-42;規格 14.6「點格子的 ⓘ」):誰整天畫休、誰時段不可排(含時間)、同日人數、
 * 涉及哪些規則。電腦 / 平板置中小視窗,手機全螢幕(規格 16.0 的底部面板以全螢幕對話框呈現)。
 *
 * 畫休總覽點日期也用這個對話框:沒有代改權限時唯讀;有代改權限時每筆畫休一列、旁邊 [刪除],
 * 下方 [代改](SC-24)。
 */
export const DayOffDetailDialog = ({
  date,
  day,
  limit,
  violations,
  onDelete,
  extraActions,
  onClose,
}: DayOffDetailDialogProps) => {
  const t = useTranslations("admin.schedule.dayOffs.detail");
  const tRules = useTranslations("admin.schedule.rules");
  const tCommon = useTranslations("admin.schedule.common");
  const isMobile = useBreakpointDown("sm");
  const title = useDayOffDateTitle();
  const dayOffs = day?.dayOffs ?? [];
  const fullDayRecords = dayOffs.filter((item) => item.kind === "full-day");
  const fullDay = [...new Set(fullDayRecords.map((item) => item.name))];
  const timeRanges = dayOffs.filter((item) => item.kind === "time-range");
  const count = day?.staffCount ?? 0;
  const countText =
    limit === null
      ? ""
      : t(COUNT_KEY[dayOffCountTone(count, limit)], { count, limit });
  const rules = violations === undefined ? [] : violationsOn(violations, date);
  const timeRangeText = (item: ScheduleDayOffFieldsFragment) =>
    t("timeRangeItem", {
      name: item.name,
      start: item.startTime ?? "",
      end: item.endTime ?? "",
    });
  /** 刪除模式:一筆畫休一列,旁邊 [刪除](同一人同一天可能有多段時段不可排) */
  const deletableRow = (item: ScheduleDayOffFieldsFragment, text: string) => (
    <Stack
      key={item.id}
      direction="row"
      spacing={1}
      sx={{ alignItems: "center" }}
    >
      <Typography variant="body2" sx={{ flex: 1 }}>
        {text}
      </Typography>
      <Button
        variant="text"
        color="error"
        size="small"
        aria-label={t("deleteAria", { item: text })}
        onClick={() => {
          onDelete?.(item);
        }}
      >
        {t("delete")}
      </Button>
    </Stack>
  );
  const fullDayContent =
    onDelete === undefined || fullDayRecords.length === 0 ? (
      <Typography variant="body2">
        {fullDay.length === 0 ? t("none") : fullDay.join("、")}
      </Typography>
    ) : (
      fullDayRecords.map((item) => deletableRow(item, item.name))
    );

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="xs"
      title={title(date)}
      actions={
        <>
          {extraActions}
          <Button variant="text" onClick={onClose}>
            {tCommon("close")}
          </Button>
        </>
      }
    >
      <Stack spacing={1.5} sx={{ pt: 1 }}>
        <Typography variant="subtitle2">
          {t("fullDayTitle")}
          {countText}
        </Typography>
        {fullDayContent}
        <Typography variant="subtitle2">{t("timeRangeTitle")}</Typography>
        {timeRanges.length === 0 ? (
          <Typography variant="body2">{t("none")}</Typography>
        ) : (
          timeRanges.map((item) =>
            onDelete === undefined ? (
              <Typography key={item.id} variant="body2">
                {timeRangeText(item)}
              </Typography>
            ) : (
              deletableRow(item, timeRangeText(item))
            ),
          )
        )}
        {violations !== undefined && (
          <>
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
          </>
        )}
      </Stack>
    </Dialog>
  );
};
