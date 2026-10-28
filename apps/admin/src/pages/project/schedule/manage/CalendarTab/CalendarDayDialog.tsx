import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import {
  type SaveScheduleCalendarDayMutation,
  type ScheduleCalendarDayFieldsFragment,
  useDeleteScheduleCalendarDayMutation,
  useSaveScheduleCalendarDayMutation,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { DatePicker } from "@repo/ui/date-picker";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Radio } from "@repo/ui/radio";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { FieldErrorGroup } from "@/components/base/FieldErrorGroup/FieldErrorGroup";
import { TagPaletteSelect } from "@/components/project/TagPaletteSelect/TagPaletteSelect";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useClosedDayConflictNotice } from "@/hooks/project/schedule/useClosedDayConflictNotice/useClosedDayConflictNotice";
import { useScheduleFieldOptions } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";
import type { FieldErrorTexts } from "@/lib/base/field-errors";
import { localDayInstantOf } from "@/lib/base/form-engine/local-day";
import { dayKeyOf } from "@/lib/project/schedule-day-offs";
import {
  SPECIAL_DAY_PALETTE_KEYS,
  type TagPaletteKey,
  isSpecialDayPaletteKey,
} from "@/lib/project/tag-palettes";

import { ConfirmDeleteDialog } from "../../ConfirmDeleteDialog";
import {
  scheduleErrorTextsOf,
  scheduleFormatErrorsOf,
} from "../../schedule-field-errors";

type Day = ScheduleCalendarDayFieldsFragment;

/** codegen 的 query key 第一段是 operation 名稱(`useScheduleCalendarQuery.getKey`)。 */
const SCHEDULE_CALENDAR_QUERY_KEY = "ScheduleCalendar";
type DayType = "closed" | "special";
/** 會標回對話框的欄位(api `fields`)。 */
const FIELD_LIST = ["date", "category", "name", "paletteKey"] as const;

type Field = (typeof FIELD_LIST)[number];

export interface CalendarDayDialogProps {
  /** 寫在哪一層(行事曆頁選的分店) */
  orgId: string;
  /** 點到的那一天;null = 新增 */
  day: Day | null;
  /** 新增時帶入的日期鍵 `YYYY-MM-DD`(點空白日期);[新增] 按鈕為空字串 */
  initialDate: string;
  onClose: () => void;
}

/**
 * 新增 / 編輯店休、特殊日(SC-28):類型、日期、類別(特殊日)、名稱、說明、顏色(特殊日,`TagPaletteSelect`)。
 * 上層組織設的那一天在本店唯讀(只有那一層能改);沒有 `edit-calendar` 也唯讀。手機全螢幕。
 */
export const CalendarDayDialog = ({
  orgId,
  day,
  initialDate,
  onClose,
}: CalendarDayDialogProps) => {
  const t = useTranslations("admin.schedule.calendar.dialog");
  const tCalendar = useTranslations("admin.schedule.calendar");
  const tCommon = useTranslations("admin.schedule.common");
  const tSchedule = useTranslations("admin.schedule");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const text = useTemporalText();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const categories = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.specialDayCategory,
  );
  const canEdit = day === null || day.canEdit;
  const isInherited = day !== null && day.ownerOrg.id !== orgId;
  const [type, setType] = useState<DayType>(
    day?.type === "closed" ? "closed" : "special",
  );
  // 日期欄是租戶時區的日期鍵;送出時換回那天 00:00 的時點
  const [date, setDate] = useState(
    day === null ? initialDate : dayKeyOf(day.date, timezone),
  );
  const [category, setCategory] = useState(day?.category ?? "");
  const [name, setName] = useState(day?.name ?? "");
  const [note, setNote] = useState(day?.note ?? "");
  // 特殊日顏色必選、不含灰色(規格 14.1);舊資料不是可選的色票時當作還沒選
  const [paletteKey, setPaletteKey] = useState<TagPaletteKey | null>(
    isSpecialDayPaletteKey(day?.paletteKey) ? day.paletteKey : null,
  );
  // 欄位錯了就在欄位正下方寫原因(REACT-18);提示只放通用句
  const [fieldErrors, setFieldErrors] = useState<FieldErrorTexts<Field>>({});
  const invalid = Object.keys(fieldErrors);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const done = () => {
    void queryClient.invalidateQueries({
      // 這家店所有月份的快取一起失效(只認 operation 名稱的前綴)
      queryKey: [SCHEDULE_CALENDAR_QUERY_KEY],
    });
    onClose();
  };
  const errorOf = (error: unknown) =>
    scheduleErrorTextsOf(error, FIELD_LIST, tSchedule).summary;
  const noticeClosedConflicts = useClosedDayConflictNotice();
  const save = useSaveScheduleCalendarDayMutation(
    session.client,
    useMutationFeedback<SaveScheduleCalendarDayMutation>({
      success: tCalendar("feedback.saveSuccess"),
      error: errorOf,
      onSuccess: (result) => {
        // 先有人力需求 / 排班、後設店休:照樣存,提醒去排班表刪除
        noticeClosedConflicts(result.saveScheduleCalendarDay.closedConflicts);
        done();
      },
      onError: (error) => {
        setFieldErrors(
          scheduleErrorTextsOf(error, FIELD_LIST, tSchedule).texts,
        );
      },
    }),
  );
  const remove = useDeleteScheduleCalendarDayMutation(
    session.client,
    useMutationFeedback({
      success: tCalendar("feedback.deleteSuccess"),
      error: errorOf,
      onSuccess: done,
    }),
  );

  const isSpecial = type === "special";

  const submit = () => {
    const missing: Field[] = [];
    const instant = localDayInstantOf(date, timezone);
    if (instant === null) missing.push("date");
    if (isSpecial && category === "") missing.push("category");
    if (isSpecial && name.trim() === "") missing.push("name");
    if (isSpecial && paletteKey === null) missing.push("paletteKey");
    setFieldErrors(scheduleFormatErrorsOf(missing, tSchedule));
    if (missing.length > 0 || instant === null) {
      return;
    }
    save.mutate({
      input: {
        ...(day === null ? {} : { id: day.id }),
        orgId,
        date: instant,
        type,
        category: isSpecial ? category : null,
        name: name.trim() === "" ? null : name.trim(),
        note: note.trim() === "" ? null : note.trim(),
        paletteKey: isSpecial ? paletteKey : null,
      },
    });
  };

  const title =
    day === null
      ? t("createTitle")
      : t("editTitle", { date: text(day.date, "date") });

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="sm"
      title={title}
      actions={
        canEdit ? (
          <>
            {day !== null && (
              <Button
                variant="text"
                color="error"
                sx={{ mr: "auto" }}
                onClick={() => {
                  setIsConfirmingDelete(true);
                }}
              >
                {t("delete")}
              </Button>
            )}
            <Button variant="text" onClick={onClose}>
              {tCommon("cancel")}
            </Button>
            <Button disabled={save.isPending} onClick={submit}>
              {day === null ? t("add") : tCommon("save")}
            </Button>
          </>
        ) : (
          <Button variant="text" onClick={onClose}>
            {tCommon("close")}
          </Button>
        )
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {isInherited && (
          <Typography variant="body2" color="textSecondary">
            {t("inherited", { org: day.ownerOrg.name })}
          </Typography>
        )}
        <Stack direction="row" spacing={2}>
          {(["closed", "special"] as const).map((option) => (
            <FormControlLabel
              key={option}
              label={tCalendar(option)}
              disabled={!canEdit}
              control={
                <Radio
                  checked={type === option}
                  onChange={() => {
                    setType(option);
                  }}
                />
              }
            />
          ))}
        </Stack>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <DatePicker
            label={t("date")}
            value={date === "" ? null : date}
            required
            fullWidth
            disabled={!canEdit}
            error={invalid.includes("date")}
            helperText={fieldErrors.date}
            onChange={(next) => {
              setDate(next ?? "");
              setFieldErrors({});
            }}
          />
          {isSpecial && (
            <SelectField
              label={t("category")}
              value={category}
              required
              fullWidth
              disabled={!canEdit}
              error={invalid.includes("category")}
              helperText={fieldErrors.category}
              options={categories.options}
              onChange={(next) => {
                setCategory(next);
                setFieldErrors({});
              }}
            />
          )}
        </Stack>
        <TextField
          label={t("name")}
          value={name}
          required={isSpecial}
          fullWidth
          disabled={!canEdit}
          error={invalid.includes("name")}
          helperText={fieldErrors.name}
          onChange={(event) => {
            setName(event.target.value);
            setFieldErrors({});
          }}
        />
        <TextField
          label={t("note")}
          value={note}
          fullWidth
          multiline
          disabled={!canEdit}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        {isSpecial && (
          <FieldErrorGroup
            label={t("color")}
            errorText={fieldErrors.paletteKey}
          >
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              {/* 必填:同其他必填欄位在標籤後加「*」 */}
              <Typography variant="subtitle2">{`${t("color")} *`}</Typography>
              <TagPaletteSelect
                value={paletteKey}
                label={t("colorAria")}
                disabled={!canEdit}
                keys={SPECIAL_DAY_PALETTE_KEYS}
                allowNone={false}
                onChange={(next) => {
                  setPaletteKey(next);
                  setFieldErrors({});
                }}
              />
            </Stack>
          </FieldErrorGroup>
        )}
      </Stack>
      {isConfirmingDelete && day !== null && (
        <ConfirmDeleteDialog
          title={t("delete")}
          message={t("deleteConfirm", { date: text(day.date, "date") })}
          isPending={remove.isPending}
          onConfirm={() => {
            remove.mutate({ input: { id: day.id, orgId } });
          }}
          onCancel={() => {
            setIsConfirmingDelete(false);
          }}
        />
      )}
    </Dialog>
  );
};
