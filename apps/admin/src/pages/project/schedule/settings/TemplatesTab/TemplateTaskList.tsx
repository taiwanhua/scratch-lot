import { useTranslations } from "use-intl";

import type { ScheduleTaskRole } from "@repo/domain/project/schedule-settings";
import { Button } from "@repo/ui/button";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { ScheduleFieldOption } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";

export interface TemplateTaskRow {
  /** 既有的執行任務 id;新的一列為 null(由 api 產生) */
  taskId: string | null;
  /** 畫面上的 key(新的一列也要有) */
  key: string;
  role: ScheduleTaskRole;
  taskKey: string;
}

export interface TemplateTaskListProps {
  /** 區塊標題(「負責人(0–1 筆)」) */
  title: string;
  /** 沒有任何一列時的文字 */
  emptyText: string;
  /** [+ 負責人] / [+ 協同] */
  addLabel: string;
  rows: readonly TemplateTaskRow[];
  /** 已到上限([+] 停用) */
  isFull: boolean;
  disabled: boolean;
  taskOptions: readonly ScheduleFieldOption[];
  onAdd: () => void;
  onChange: (key: string, taskKey: string) => void;
  onRemove: (key: string) => void;
}

/** 人力需求範本的一組執行任務(負責人或協同):每列選執行任務,可以移除;滿了 [+] 停用。 */
export const TemplateTaskList = ({
  title,
  emptyText,
  addLabel,
  rows,
  isFull,
  disabled,
  taskOptions,
  onAdd,
  onChange,
  onRemove,
}: TemplateTaskListProps) => {
  const t = useTranslations("admin.schedule.templates.dialog");
  const tCommon = useTranslations("admin.schedule.common");
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">{title}</Typography>
      {rows.length === 0 && (
        <Typography variant="body2" color="textSecondary">
          {emptyText}
        </Typography>
      )}
      {rows.map((row) => (
        <Stack
          key={row.key}
          direction="row"
          spacing={1}
          sx={{ alignItems: "center" }}
        >
          <SelectField
            label={t("task")}
            value={row.taskKey}
            size="small"
            fullWidth
            disabled={disabled}
            options={[...taskOptions]}
            onChange={(next) => {
              onChange(row.key, next);
            }}
          />
          {!disabled && (
            <Button
              variant="text"
              color="error"
              size="small"
              onClick={() => {
                onRemove(row.key);
              }}
            >
              {tCommon("remove")}
            </Button>
          )}
        </Stack>
      ))}
      {!disabled && (
        <Button
          variant="text"
          size="small"
          sx={{ alignSelf: "flex-start" }}
          disabled={isFull}
          onClick={onAdd}
        >
          {addLabel}
        </Button>
      )}
    </Stack>
  );
};
