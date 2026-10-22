import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { WEEK_DAY_COUNT } from "@repo/domain/project/schedule-settings";
import {
  type ScheduleDemandTemplateFieldsFragment,
  type ScheduleDemandWeekTemplateFieldsFragment,
  useDeleteScheduleDemandWeekTemplateMutation,
  useSaveScheduleDemandWeekTemplateMutation,
  useScheduleDemandWeekTemplatesQuery,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import { ConfirmDeleteDialog } from "../../ConfirmDeleteDialog";
import { scheduleErrorOf } from "../../schedule-error";

const WEEKDAYS = Array.from({ length: WEEK_DAY_COUNT }, (_, day) => day);

/** 勾 / 取消某天的一個範本;每天的清單保持範本清單的順序(早 → 晚 → 補)。 */
const toggledDays = (
  days: readonly string[][],
  templates: readonly { id: string }[],
  change: { day: number; templateId: string; checked: boolean },
): string[][] =>
  days.map((ids, index) => {
    if (index !== change.day) {
      return ids;
    }
    const next = change.checked
      ? [...ids, change.templateId]
      : ids.filter((id) => id !== change.templateId);
    return templates
      .map((template) => template.id)
      .filter((id) => next.includes(id));
  });

export interface WeekTemplateDialogProps {
  /** 要編輯的週範本;null = 新增 */
  weekTemplate: ScheduleDemandWeekTemplateFieldsFragment | null;
  /** 這一層看得到的人力需求範本(勾選的選項) */
  templates: readonly ScheduleDemandTemplateFieldsFragment[];
  onClose: () => void;
}

/**
 * 人力需求週範本 編輯(SC-22b):名稱 + 星期日 … 星期六各勾要用的人力需求範本(寫範本簡稱)。
 * 上層建立的唯讀。手機全螢幕。
 */
export const WeekTemplateDialog = ({
  weekTemplate,
  templates,
  onClose,
}: WeekTemplateDialogProps) => {
  const t = useTranslations("admin.schedule.weekTemplates.dialog");
  const tWeek = useTranslations("admin.schedule.weekTemplates");
  const tCommon = useTranslations("admin.schedule.common");
  const tErrors = useTranslations("admin.schedule.errors");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const canEdit = weekTemplate === null || weekTemplate.canEdit;
  const [name, setName] = useState(weekTemplate?.name ?? "");
  const [days, setDays] = useState<string[][]>(() =>
    WEEKDAYS.map((day) => [...(weekTemplate?.days[day] ?? [])]),
  );
  const [isNameInvalid, setIsNameInvalid] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const done = () => {
    void queryClient.invalidateQueries({
      queryKey: useScheduleDemandWeekTemplatesQuery.getKey(),
    });
    onClose();
  };
  const errorOf = (error: unknown) => tErrors(scheduleErrorOf(error).code);
  const save = useSaveScheduleDemandWeekTemplateMutation(
    session.client,
    useMutationFeedback({
      success: tWeek("feedback.saveSuccess"),
      error: errorOf,
      onSuccess: done,
    }),
  );
  const remove = useDeleteScheduleDemandWeekTemplateMutation(
    session.client,
    useMutationFeedback({
      success: tWeek("feedback.deleteSuccess"),
      error: errorOf,
      onSuccess: done,
    }),
  );

  const toggle = (day: number, templateId: string, checked: boolean) => {
    setDays((current) =>
      toggledDays(current, templates, { day, templateId, checked }),
    );
  };

  const submit = () => {
    if (name.trim() === "") {
      setIsNameInvalid(true);
      return;
    }
    save.mutate({
      input: {
        ...(weekTemplate === null ? {} : { id: weekTemplate.id }),
        name: name.trim(),
        days,
      },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="sm"
      title={
        weekTemplate === null
          ? t("createTitle")
          : t("editTitle", { name: weekTemplate.name })
      }
      actions={
        canEdit ? (
          <>
            {weekTemplate !== null && (
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
              {tCommon("save")}
            </Button>
          </>
        ) : (
          <Button variant="text" onClick={onClose}>
            {tCommon("close")}
          </Button>
        )
      }
    >
      <Stack spacing={1.5} sx={{ pt: 1 }}>
        {weekTemplate !== null && !weekTemplate.canEdit && (
          <Typography variant="body2" color="textSecondary">
            {t("readOnly", { org: weekTemplate.ownerOrg.name })}
          </Typography>
        )}
        <TextField
          label={t("name")}
          value={name}
          required
          fullWidth
          disabled={!canEdit}
          error={isNameInvalid}
          onChange={(event) => {
            setName(event.target.value);
            setIsNameInvalid(false);
          }}
        />
        {templates.length === 0 && (
          <Typography variant="body2" color="textSecondary">
            {tWeek("noTemplates")}
          </Typography>
        )}
        {WEEKDAYS.map((day) => (
          <Stack
            key={day}
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", flexWrap: "wrap" }}
          >
            <Typography sx={{ flex: 1, minWidth: 72 }}>
              {tWeek(`weekdayLong.${String(day)}`)}
            </Typography>
            {templates.map((template) => (
              <FormControlLabel
                key={template.id}
                label={template.shortName}
                disabled={!canEdit}
                control={
                  <Checkbox
                    checked={days[day]?.includes(template.id) ?? false}
                    slotProps={{
                      input: {
                        "aria-label": t("pick", {
                          day: tWeek(`weekdayLong.${String(day)}`),
                          template: template.name,
                        }),
                      },
                    }}
                    onChange={(_event, checked) => {
                      toggle(day, template.id, checked);
                    }}
                  />
                }
              />
            ))}
          </Stack>
        ))}
      </Stack>
      {isConfirmingDelete && weekTemplate !== null && (
        <ConfirmDeleteDialog
          title={t("delete")}
          message={t("deleteConfirm", { name: weekTemplate.name })}
          isPending={remove.isPending}
          onConfirm={() => {
            remove.mutate({ input: { id: weekTemplate.id } });
          }}
          onCancel={() => {
            setIsConfirmingDelete(false);
          }}
        />
      )}
    </Dialog>
  );
};
