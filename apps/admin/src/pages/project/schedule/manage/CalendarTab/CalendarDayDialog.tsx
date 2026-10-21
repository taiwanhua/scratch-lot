import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import {
  type ScheduleCalendarDayFieldsFragment,
  useDeleteScheduleCalendarDayMutation,
  useSaveScheduleCalendarDayMutation,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Radio } from "@repo/ui/radio";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { TagPaletteSelect } from "@/components/project/TagPaletteSelect/TagPaletteSelect";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useScheduleFieldOptions } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";
import {
  type TagPaletteKey,
  isTagPaletteKey,
} from "@/lib/project/tag-palettes";

import { ConfirmDeleteDialog } from "../../ConfirmDeleteDialog";
import { scheduleErrorOf } from "../../schedule-error";

type Day = ScheduleCalendarDayFieldsFragment;

/** codegen 的 query key 第一段是 operation 名稱(`useScheduleCalendarQuery.getKey`)。 */
const SCHEDULE_CALENDAR_QUERY_KEY = "ScheduleCalendar";
type DayType = "closed" | "special";
type Field = "date" | "category" | "name";

const FIELDS: ReadonlySet<Field> = new Set(["date", "category", "name"]);

export interface CalendarDayDialogProps {
  /** 寫在哪一層(行事曆頁選的分店) */
  orgId: string;
  /** 點到的那一天;null = 新增 */
  day: Day | null;
  /** 新增時帶入的日期(點空白日期);[新增] 按鈕為空字串 */
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
  const tErrors = useTranslations("admin.schedule.errors");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const categories = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.specialDayCategory,
  );
  const canEdit = day === null || day.canEdit;
  const isInherited = day !== null && day.ownerOrg.id !== orgId;
  const [type, setType] = useState<DayType>(
    day?.type === "closed" ? "closed" : "special",
  );
  const [date, setDate] = useState(day?.date ?? initialDate);
  const [category, setCategory] = useState(day?.category ?? "");
  const [name, setName] = useState(day?.name ?? "");
  const [note, setNote] = useState(day?.note ?? "");
  const [paletteKey, setPaletteKey] = useState<TagPaletteKey | null>(
    isTagPaletteKey(day?.paletteKey) ? day.paletteKey : null,
  );
  const [invalid, setInvalid] = useState<Field[]>([]);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const done = () => {
    void queryClient.invalidateQueries({
      // 這家店所有月份的快取一起失效(只認 operation 名稱的前綴)
      queryKey: [SCHEDULE_CALENDAR_QUERY_KEY],
    });
    onClose();
  };
  const errorOf = (error: unknown) => tErrors(scheduleErrorOf(error).code);
  const save = useSaveScheduleCalendarDayMutation(
    session.client,
    useMutationFeedback({
      success: tCalendar("feedback.saveSuccess"),
      error: errorOf,
      onSuccess: done,
      onError: (error) => {
        setInvalid(
          (scheduleErrorOf(error).fields ?? []).filter(
            (field): field is Field => FIELDS.has(field as Field),
          ),
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
    if (date === "") missing.push("date");
    if (isSpecial && category === "") missing.push("category");
    if (isSpecial && name.trim() === "") missing.push("name");
    setInvalid(missing);
    if (missing.length > 0) {
      return;
    }
    save.mutate({
      input: {
        ...(day === null ? {} : { id: day.id }),
        orgId,
        date,
        type,
        category: isSpecial ? category : null,
        name: name.trim() === "" ? null : name.trim(),
        note: note.trim() === "" ? null : note.trim(),
        paletteKey: isSpecial ? paletteKey : null,
      },
    });
  };

  const title =
    day === null ? t("createTitle") : t("editTitle", { date: day.date });

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
          <Typography variant="body2" color="text.secondary">
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
          <TextField
            label={t("date")}
            type="date"
            value={date}
            required
            fullWidth
            disabled={!canEdit}
            error={invalid.includes("date")}
            slotProps={{ inputLabel: { shrink: true } }}
            onChange={(event) => {
              setDate(event.target.value);
              setInvalid([]);
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
              options={categories.options}
              onChange={(next) => {
                setCategory(next);
                setInvalid([]);
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
          onChange={(event) => {
            setName(event.target.value);
            setInvalid([]);
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
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Typography variant="subtitle2">{t("color")}</Typography>
            <TagPaletteSelect
              value={paletteKey}
              label={t("colorAria")}
              disabled={!canEdit}
              onChange={setPaletteKey}
            />
          </Stack>
        )}
      </Stack>
      {isConfirmingDelete && day !== null && (
        <ConfirmDeleteDialog
          title={t("delete")}
          message={t("deleteConfirm", { date: day.date })}
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
