import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useTranslations } from "use-intl";

import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import {
  useApplyScheduleTemplatesMutation,
  useScheduleTemplateApplyPreviewQuery,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { Dialog } from "@repo/ui/dialog";
import { Drawer } from "@repo/ui/drawer";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { useBreakpointDown } from "@repo/ui/media-query";
import {
  MonthCalendar,
  type MonthCalendarDayInfo,
} from "@repo/ui/month-calendar";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { SegmentedControl } from "@repo/ui/segmented-control";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { TagPaletteChip } from "@/components/project/TagPaletteChip/TagPaletteChip";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useScheduleFieldOptions } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";
import {
  type DatePreset,
  datesOfPreset,
  templateHeadcountOf,
  weekTemplateSummary,
} from "@/lib/project/schedule-auto-run";
import { datesOfMonth } from "@/lib/project/schedule-roster";
import { isTagPaletteKey } from "@/lib/project/tag-palettes";

import { scheduleErrorKey } from "../../../schedule-error";
import { useRosterCheck } from "../check-panel/roster-check-context";
import { useChangeReason } from "../publish/useChangeReason";
import { ROSTER_QUERY_ROOT } from "../roster-context";
import { autoRunBlockedReasonOf, useAutoRunStatus } from "./auto-run-status";

type ApplyKind = "template" | "week-template";

/** 套用範本抽屜寬(px;Figma SC-17a 電腦 / 平板)。 */
const DRAWER_WIDTH = 460;

const PRESETS: readonly DatePreset[] = ["all", "none", "weekdays", "weekends"];

export interface ApplyTemplatesDialogProps {
  onClose: () => void;
}

/**
 * 套用範本(SC-17a 人力需求範本 / SC-17b 人力需求週範本;規格 14.4「套用範本」):
 * 電腦 / 平板右側抽屜、手機全螢幕。
 *
 * - 種類切換;人力需求範本可多選、週範本單選
 * - 套用到:底座 `MonthCalendar` 多選,**預設整個月全選**;[全選] [全不選] [平日] [週末]、每週左邊勾整週;
 *   店休停用、特殊日顯示名稱;週範本模式下已有人力需求的日子標「已有」
 * - 說明文字依種類;預覽由 api 算(和套用同一個規劃):「將產生 N 個時段,略過 M 個已存在的相同時段」
 * - 已發布的月份多一個「異動原因」(`useChangeReason`)
 */
export const ApplyTemplatesDialog = ({
  onClose,
}: ApplyTemplatesDialogProps) => {
  const t = useTranslations("admin.schedule.roster.applyTemplates");
  const tCalendar = useTranslations("admin.schedule.calendar");
  const tErrors = useTranslations("admin.schedule.errors");
  const tAutoRun = useTranslations("admin.schedule.roster.autoRun");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const { data, month } = useRosterCheck();
  const status = useAutoRunStatus();
  const positions = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.position,
  );
  const changeReason = useChangeReason(true);
  const templates = data?.templates ?? [];
  const weekTemplates = status?.weekTemplates ?? [];
  const closed = new Set(
    (data?.calendarDays ?? [])
      .filter((day) => day.type === "closed")
      .map((day) => day.date),
  );
  const selectable = datesOfMonth(month).filter((date) => !closed.has(date));
  const [kind, setKind] = useState<ApplyKind>("template");
  const [templateIds, setTemplateIds] = useState<string[]>([]);
  const [pickedWeekId, setPickedWeekId] = useState<string | null>(null);
  const [dates, setDates] = useState<string[]>(selectable);
  const weekTemplateId = pickedWeekId ?? weekTemplates.at(0)?.id ?? null;
  const [year = "", monthNumber = ""] = month.split("-");

  const isReady =
    data !== undefined &&
    dates.length > 0 &&
    (kind === "template" ? templateIds.length > 0 : weekTemplateId !== null);
  const input = {
    month,
    kind,
    dates,
    ...(data === undefined ? {} : { orgId: data.orgId }),
    ...(kind === "template" ? { templateIds } : { weekTemplateId }),
  };
  const preview = useScheduleTemplateApplyPreviewQuery(
    session.client,
    { input },
    {
      queryKey: [...ROSTER_QUERY_ROOT, "applyPreview", input],
      enabled: isReady,
    },
  );
  const errorText = (cause: unknown) =>
    autoRunBlockedReasonOf(cause) === "AUTO_RUN_IN_PROGRESS"
      ? tAutoRun("errors.AUTO_RUN_IN_PROGRESS")
      : tErrors(scheduleErrorKey(cause));
  const apply = useApplyScheduleTemplatesMutation(
    session.client,
    useMutationFeedback({
      success: (payload) =>
        t("feedback", { count: payload.applyScheduleTemplates.createdCount }),
      error: errorText,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ROSTER_QUERY_ROOT });
        onClose();
      },
      onError: (cause) => {
        changeReason.markFromError(cause);
      },
    }),
  );
  const submit = () => {
    const reason = changeReason.take();
    if (reason === null || !isReady) {
      return;
    }
    apply.mutate({ input: { ...input, ...reason } });
  };

  const toggleTemplate = (id: string, checked: boolean) => {
    setTemplateIds((current) =>
      checked ? [...current, id] : current.filter((item) => item !== id),
    );
  };
  const weekdayLabels = [0, 1, 2, 3, 4, 5, 6].map((day) =>
    tCalendar(`weekdays.${String(day)}`),
  );
  const shortNameOf = (id: string) =>
    templates.find((template) => template.id === id)?.shortName ?? "";
  const demandDays = new Set(data?.demands.map((demand) => demand.date));
  const dayInfo: Record<string, MonthCalendarDayInfo> = Object.fromEntries(
    datesOfMonth(month).map((date) => {
      const day = data?.calendarDays.find((item) => item.date === date);
      let note: ReactNode = null;
      if (day?.type === "closed") {
        note = tCalendar("closed");
      } else if (day?.type === "special" && day.name !== null) {
        note = isTagPaletteKey(day.paletteKey) ? (
          <TagPaletteChip paletteKey={day.paletteKey} label={day.name} />
        ) : (
          <Tag label={day.name} />
        );
      } else if (kind === "week-template" && demandDays.has(date)) {
        note = t("existing");
      }
      return [
        date,
        {
          disabled: closed.has(date),
          ...(note === null ? {} : { note }),
        },
      ];
    }),
  );

  const previewText = (() => {
    const result = preview.data?.scheduleTemplateApplyPreview;
    if (!isReady) {
      return dates.length === 0 ? t("noDates") : null;
    }
    if (result === undefined) {
      return t("previewLoading");
    }
    return kind === "template"
      ? t("preview", {
          created: result.createdCount,
          skipped: result.skippedSlots,
        })
      : t("previewWeek", {
          filled: result.filledDays,
          skipped: result.skippedDays,
        });
  })();

  const body = (
    <Stack spacing={2} sx={{ pt: 1 }}>
      <SegmentedControl
        aria-label={t("kind")}
        value={kind}
        onChange={(value) => {
          setKind(value === "week-template" ? "week-template" : "template");
        }}
        options={[
          { value: "template", label: t("kindTemplate") },
          { value: "week-template", label: t("kindWeek") },
        ]}
      />
      {kind === "template" ? (
        <Stack spacing={0.5}>
          <Typography variant="subtitle2">{t("templatesTitle")}</Typography>
          {templates.length === 0 && (
            <Typography variant="body2" color="textSecondary">
              {t("noTemplates")}
            </Typography>
          )}
          {templates.map((template) => (
            <FormControlLabel
              key={template.id}
              label={t("templateLine", {
                name: template.name,
                start: template.startTime,
                end: template.endTime,
                position: positions.labelOf(template.positionKey),
                count: templateHeadcountOf(template.tasks),
              })}
              control={
                <Checkbox
                  checked={templateIds.includes(template.id)}
                  onChange={(_event, checked) => {
                    toggleTemplate(template.id, checked);
                  }}
                />
              }
            />
          ))}
        </Stack>
      ) : (
        <Stack spacing={0.5}>
          <Typography variant="subtitle2">{t("weekTitle")}</Typography>
          {weekTemplates.length === 0 && (
            <Typography variant="body2" color="textSecondary">
              {t("noWeekTemplates")}
            </Typography>
          )}
          <RadioGroup
            value={weekTemplateId ?? ""}
            onChange={(_event, value) => {
              setPickedWeekId(value);
            }}
          >
            {weekTemplates.map((weekTemplate) => (
              <FormControlLabel
                key={weekTemplate.id}
                value={weekTemplate.id}
                control={<Radio />}
                label={t("weekLine", {
                  name: weekTemplate.name,
                  summary: weekTemplateSummary(
                    weekTemplate.days,
                    shortNameOf,
                    weekdayLabels,
                  ),
                })}
              />
            ))}
          </RadioGroup>
        </Stack>
      )}
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ alignItems: "center", flexWrap: "wrap" }}
      >
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {t("applyTo", { year, month: Number(monthNumber) })}
        </Typography>
        {PRESETS.map((preset) => (
          <Button
            key={preset}
            variant="text"
            size="small"
            onClick={() => {
              setDates(datesOfPreset(selectable, preset));
            }}
          >
            {t(`presets.${preset}`)}
          </Button>
        ))}
      </Stack>
      <MonthCalendar
        month={month}
        showHeader={false}
        selectionMode="multiple"
        selectedDates={dates}
        onSelectedDatesChange={(next) => {
          setDates(next.filter((date) => !closed.has(date)));
        }}
        days={dayInfo}
        weekdayLabels={weekdayLabels}
        formatWeekLabel={(week) => t("weekCheck", { week: week + 1 })}
        aria-label={t("applyTo", { year, month: Number(monthNumber) })}
      />
      <Typography variant="caption" color="textSecondary">
        {kind === "template" ? t("hintTemplate") : t("hintWeek")}
      </Typography>
      {changeReason.fields}
      {previewText !== null && (
        <Typography variant="body2" aria-live="polite">
          {previewText}
        </Typography>
      )}
    </Stack>
  );

  const actions = (
    <>
      <Button variant="text" onClick={onClose}>
        {t("cancel")}
      </Button>
      <Button disabled={!isReady || apply.isPending} onClick={submit}>
        {t("apply")}
      </Button>
    </>
  );

  return isMobile ? (
    <Dialog
      open
      fullScreen
      onClose={onClose}
      title={t("title")}
      actions={actions}
    >
      {body}
    </Dialog>
  ) : (
    <Drawer
      open
      anchor="right"
      title={t("title")}
      closeLabel={t("close")}
      actions={actions}
      onClose={onClose}
      // 底座抽屜寬 360;月曆要放得下(Figma SC-17a 抽屜寬 460)
      sx={{ "& .MuiDrawer-paper": { width: DRAWER_WIDTH } }}
    >
      {body}
    </Drawer>
  );
};
