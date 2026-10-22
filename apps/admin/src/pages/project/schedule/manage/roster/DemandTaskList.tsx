import { useTranslations } from "use-intl";

import type { ScheduleTaskRole } from "@repo/domain/project/schedule-settings";
import { Button } from "@repo/ui/button";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { ScheduleFieldOption } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";

import type { DemandTaskRow } from "./demand-dialog-state";

export interface DemandTaskListProps {
  role: ScheduleTaskRole;
  rows: readonly DemandTaskRow[];
  /** 已到上限([+] 停用) */
  isFull: boolean;
  canEdit: boolean;
  taskOptions: readonly ScheduleFieldOption[];
  onAdd: () => void;
  onChange: (key: string, taskKey: string) => void;
  onRemove: (key: string) => void;
}

/**
 * 人力需求的一組執行任務(負責人 0–1 / 協同 0–10;Array Field):每列選執行任務、旁邊寫誰填進
 * (「李小華 填進」/「還沒有人填」;不選人)、可以移除;滿了 [+] 停用。
 */
export const DemandTaskList = ({
  role,
  rows,
  isFull,
  canEdit,
  taskOptions,
  onAdd,
  onChange,
  onRemove,
}: DemandTaskListProps) => {
  const t = useTranslations("admin.schedule.roster.demandDialog");
  const tCommon = useTranslations("admin.schedule.common");
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
        <Typography variant="subtitle2">{t(`roles.${role}`)}</Typography>
        <Typography variant="caption" color="textSecondary">
          {t(`limits.${role}`)}
        </Typography>
      </Stack>
      {rows.length === 0 && (
        <Typography variant="body2" color="textSecondary">
          {t(`empty.${role}`)}
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
            disabled={!canEdit}
            options={[...taskOptions]}
            onChange={(next) => {
              onChange(row.key, next);
            }}
          />
          {row.taskId !== null && (
            <Typography
              variant="body2"
              sx={{
                color:
                  row.userName === null ? "warning.dark" : "text.secondary",
                whiteSpace: "nowrap",
              }}
            >
              {row.userName === null
                ? t("unfilled")
                : t("filledBy", { name: row.userName })}
            </Typography>
          )}
          {canEdit && (
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
      {canEdit && (
        <Button
          variant="text"
          size="small"
          sx={{ alignSelf: "flex-start" }}
          disabled={isFull}
          onClick={onAdd}
        >
          {t(`add.${role}`)}
        </Button>
      )}
    </Stack>
  );
};
