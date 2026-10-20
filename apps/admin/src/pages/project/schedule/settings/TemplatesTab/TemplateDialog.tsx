import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import {
  DEFAULT_HELPER_TASK_KEY,
  DEFAULT_LEADER_TASK_KEY,
  MAX_HELPER_TASKS,
  MAX_LEADER_TASKS,
  type ScheduleTaskRole,
} from "@repo/domain/project/schedule-settings";
import {
  type ScheduleDemandTemplateFieldsFragment,
  useDeleteScheduleDemandTemplateMutation,
  useSaveScheduleDemandTemplateMutation,
  useScheduleDemandTemplatesQuery,
  useScheduleRulesQuery,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
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
import { TemplateTaskList, type TemplateTaskRow } from "./TemplateTaskList";

interface Values {
  name: string;
  shortName: string;
  startTime: string;
  endTime: string;
  positionKey: string;
  tasks: TemplateTaskRow[];
  paletteKey: TagPaletteKey | null;
}

type Field =
  "name" | "shortName" | "startTime" | "endTime" | "positionKey" | "tasks";

let rowSequence = 0;
const nextKey = (): string => {
  rowSequence += 1;
  return `new-${String(rowSequence)}`;
};

const initialValues = (
  template: ScheduleDemandTemplateFieldsFragment | null,
): Values =>
  template === null
    ? {
        name: "",
        shortName: "",
        startTime: "",
        endTime: "",
        positionKey: "",
        tasks: [],
        paletteKey: null,
      }
    : {
        name: template.name,
        shortName: template.shortName,
        startTime: template.startTime,
        endTime: template.endTime,
        positionKey: template.positionKey,
        tasks: template.tasks.map((task) => ({
          taskId: task.taskId,
          key: task.taskId,
          role: task.role === "leader" ? "leader" : "helper",
          taskKey: task.taskKey,
        })),
        paletteKey: isTagPaletteKey(template.paletteKey)
          ? template.paletteKey
          : null,
      };

const stringValue = (value: unknown, fallback: string): string =>
  typeof value === "string" && value !== "" ? value : fallback;

export interface TemplateDialogProps {
  /** 要編輯的範本;null = 新增 */
  template: ScheduleDemandTemplateFieldsFragment | null;
  onClose: () => void;
}

/**
 * 人力需求範本 新增 / 編輯(SC-22a;規格 14.4):名稱、簡稱(1–2 字)、開始 / 結束(到分鐘)、崗位、
 * 負責人 0–1 列、協同 0–10 列(新增一列帶入規則的負責人 / 協同預設任務)、顏色(`TagPaletteSelect`)。
 * 範本沒有休息。上層建立的(`canEdit` = false)欄位停用、只剩 [關閉]。手機全螢幕。
 */
export const TemplateDialog = ({ template, onClose }: TemplateDialogProps) => {
  const t = useTranslations("admin.schedule.templates.dialog");
  const tTemplates = useTranslations("admin.schedule.templates");
  const tCommon = useTranslations("admin.schedule.common");
  const tErrors = useTranslations("admin.schedule.errors");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const positions = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.position,
  );
  const tasks = useScheduleFieldOptions(SCHEDULE_FIELD_CATEGORY_KEYS.task);
  const rules = useScheduleRulesQuery(session.client, { input: null });
  const [values, setValues] = useState(() => initialValues(template));
  const [invalid, setInvalid] = useState<Field[]>([]);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const canEdit = template === null || template.canEdit;

  const defaultTasks = rules.data?.scheduleRules.items.find(
    (rule) => rule.key === "defaultTasks",
  )?.effective.value;
  const defaultTaskOf = (role: ScheduleTaskRole): string =>
    role === "leader"
      ? stringValue(defaultTasks?.defaultLeaderTaskKey, DEFAULT_LEADER_TASK_KEY)
      : stringValue(
          defaultTasks?.defaultHelperTaskKey,
          DEFAULT_HELPER_TASK_KEY,
        );

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: useScheduleDemandTemplatesQuery.getKey(),
    });
  const errorOf = (error: unknown) => tErrors(scheduleErrorOf(error).code);

  const save = useSaveScheduleDemandTemplateMutation(
    session.client,
    useMutationFeedback({
      success: tTemplates("feedback.saveSuccess"),
      error: errorOf,
      onSuccess: () => {
        void invalidate();
        onClose();
      },
      onError: (error) => {
        setInvalid(
          (scheduleErrorOf(error).fields ?? []).filter(
            (field): field is Field =>
              [
                "name",
                "shortName",
                "startTime",
                "endTime",
                "positionKey",
                "tasks",
              ].includes(field),
          ),
        );
      },
    }),
  );
  const remove = useDeleteScheduleDemandTemplateMutation(
    session.client,
    useMutationFeedback({
      success: tTemplates("feedback.deleteSuccess"),
      error: errorOf,
      onSuccess: () => {
        void invalidate();
        onClose();
      },
    }),
  );

  const change = <Key extends keyof Values>(key: Key, value: Values[Key]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setInvalid((current) => current.filter((field) => field !== key));
  };

  const leaders = values.tasks.filter((task) => task.role === "leader");
  const helpers = values.tasks.filter((task) => task.role === "helper");

  const addTask = (role: ScheduleTaskRole) => {
    change("tasks", [
      ...values.tasks,
      { taskId: null, key: nextKey(), role, taskKey: defaultTaskOf(role) },
    ]);
  };

  const submit = () => {
    const missing: Field[] = [];
    if (values.name.trim() === "") missing.push("name");
    if (values.shortName.trim() === "") missing.push("shortName");
    if (values.startTime === "") missing.push("startTime");
    if (values.endTime === "") missing.push("endTime");
    if (values.positionKey === "") missing.push("positionKey");
    setInvalid(missing);
    if (missing.length > 0) {
      return;
    }
    save.mutate({
      input: {
        ...(template === null ? {} : { id: template.id }),
        name: values.name.trim(),
        shortName: values.shortName.trim(),
        startTime: values.startTime,
        endTime: values.endTime,
        positionKey: values.positionKey,
        tasks: values.tasks.map((task) => ({
          ...(task.taskId === null ? {} : { taskId: task.taskId }),
          role: task.role,
          taskKey: task.taskKey,
        })),
        paletteKey: values.paletteKey,
      },
    });
  };

  const changeTask = (key: string, taskKey: string) => {
    change(
      "tasks",
      values.tasks.map((item) =>
        item.key === key ? { ...item, taskKey } : item,
      ),
    );
  };
  const removeTask = (key: string) => {
    change(
      "tasks",
      values.tasks.filter((item) => item.key !== key),
    );
  };

  const title =
    template === null
      ? t("createTitle")
      : t("editTitle", { name: template.name });

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
            {template !== null && (
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
      <Stack spacing={2} sx={{ pt: 1 }}>
        {template !== null && !template.canEdit && (
          <Typography variant="body2" color="text.secondary">
            {t("readOnly", { org: template.ownerOrg.name })}
          </Typography>
        )}
        <Stack direction="row" spacing={1.5}>
          <TextField
            label={t("name")}
            value={values.name}
            required
            fullWidth
            disabled={!canEdit}
            error={invalid.includes("name")}
            onChange={(event) => {
              change("name", event.target.value);
            }}
          />
          <TextField
            label={t("shortName")}
            value={values.shortName}
            required
            fullWidth
            disabled={!canEdit}
            error={invalid.includes("shortName")}
            helperText={t("shortNameHint")}
            onChange={(event) => {
              change("shortName", event.target.value);
            }}
          />
        </Stack>
        <Stack direction="row" spacing={1.5}>
          <TextField
            label={t("startTime")}
            type="time"
            value={values.startTime}
            required
            fullWidth
            disabled={!canEdit}
            error={invalid.includes("startTime")}
            slotProps={{ inputLabel: { shrink: true } }}
            onChange={(event) => {
              change("startTime", event.target.value);
            }}
          />
          <TextField
            label={t("endTime")}
            type="time"
            value={values.endTime}
            required
            fullWidth
            disabled={!canEdit}
            error={invalid.includes("endTime")}
            helperText={t("timeHint")}
            slotProps={{ inputLabel: { shrink: true } }}
            onChange={(event) => {
              change("endTime", event.target.value);
            }}
          />
        </Stack>
        <SelectField
          label={t("position")}
          value={values.positionKey}
          required
          fullWidth
          disabled={!canEdit}
          error={invalid.includes("positionKey")}
          options={positions.options}
          onChange={(next) => {
            change("positionKey", next);
          }}
        />
        <TemplateTaskList
          title={t("leaders")}
          emptyText={t("noLeader")}
          addLabel={t("addLeader")}
          rows={leaders}
          isFull={leaders.length >= MAX_LEADER_TASKS}
          disabled={!canEdit}
          taskOptions={tasks.options}
          onAdd={() => {
            addTask("leader");
          }}
          onChange={changeTask}
          onRemove={removeTask}
        />
        <TemplateTaskList
          title={t("helpers")}
          emptyText={t("noHelper")}
          addLabel={t("addHelper")}
          rows={helpers}
          isFull={helpers.length >= MAX_HELPER_TASKS}
          disabled={!canEdit}
          taskOptions={tasks.options}
          onAdd={() => {
            addTask("helper");
          }}
          onChange={changeTask}
          onRemove={removeTask}
        />
        {invalid.includes("tasks") && (
          <Typography variant="caption" color="error">
            {tErrors("VALIDATION_FAILED")}
          </Typography>
        )}
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Typography variant="subtitle2">{t("color")}</Typography>
          <TagPaletteSelect
            value={values.paletteKey}
            label={t("colorAria")}
            disabled={!canEdit}
            onChange={(next) => {
              change("paletteKey", next);
            }}
          />
        </Stack>
      </Stack>
      {isConfirmingDelete && template !== null && (
        <ConfirmDeleteDialog
          title={t("delete")}
          message={t("deleteConfirm", { name: template.name })}
          isPending={remove.isPending}
          onConfirm={() => {
            remove.mutate({ input: { id: template.id } });
          }}
          onCancel={() => {
            setIsConfirmingDelete(false);
          }}
        />
      )}
    </Dialog>
  );
};
