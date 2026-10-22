import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { WEEK_DAY_COUNT } from "@repo/domain/project/schedule-settings";
import {
  type ScheduleDemandWeekTemplateFieldsFragment,
  useSaveScheduleDemandWeekTemplateMutation,
  useScheduleDemandTemplatesQuery,
  useScheduleDemandWeekTemplatesQuery,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Switch } from "@repo/ui/switch";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import { scheduleErrorOf } from "../../schedule-error";
import { WeekTemplateDialog } from "./WeekTemplateDialog";

type Row = ScheduleDemandWeekTemplateFieldsFragment;

type Editing = { mode: "create" } | { mode: "edit"; row: Row };

const WEEKDAYS = Array.from({ length: WEEK_DAY_COUNT }, (_, day) => day);

/**
 * 排班設定 → 人力需求週範本(SC-09b;規格 14.4):星期幾用哪些人力需求範本(格子寫範本簡稱)。
 * 可見與修改同人力需求範本;啟用開關只有建立的那一層、有 `edit-templates` 才能切。
 */
export const WeekTemplatesTab = () => {
  const t = useTranslations("admin.schedule.weekTemplates");
  const tErrors = useTranslations("admin.schedule.errors");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const query = useScheduleDemandWeekTemplatesQuery(session.client);
  const templates = useScheduleDemandTemplatesQuery(session.client);
  const rows = query.data?.scheduleDemandWeekTemplates.items ?? [];
  const canCreate = query.data?.scheduleDemandWeekTemplates.canCreate ?? false;
  const shortNames = new Map(
    (templates.data?.scheduleDemandTemplates.items ?? []).map((template) => [
      template.id,
      template.shortName,
    ]),
  );
  const [editing, setEditing] = useState<Editing | null>(null);

  const toggle = useSaveScheduleDemandWeekTemplateMutation(
    session.client,
    useMutationFeedback({
      success: (data) =>
        data.saveScheduleDemandWeekTemplate.item.enabled
          ? t("feedback.enableSuccess")
          : t("feedback.disableSuccess"),
      error: (error) => tErrors(scheduleErrorOf(error).code),
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: useScheduleDemandWeekTemplatesQuery.getKey(),
        });
      },
    }),
  );

  const weekdayOf = (day: number) => t(`weekdays.${String(day)}`);

  const dayText = (row: Row, day: number) => {
    const names = (row.days[day] ?? [])
      .map((id) => shortNames.get(id))
      .filter((name): name is string => name !== undefined);
    return names.length === 0 ? t("none") : names.join("、");
  };

  const enabledOf = (row: Row) => (
    <Switch
      checked={row.enabled}
      disabled={!row.canEdit || toggle.isPending}
      slotProps={{
        input: { "aria-label": t("enabledAria", { name: row.name }) },
      }}
      onClick={(event) => {
        event.stopPropagation();
      }}
      onChange={(_event, checked) => {
        toggle.mutate({
          input: {
            id: row.id,
            name: row.name,
            days: row.days,
            enabled: checked,
          },
        });
      }}
    />
  );

  const columns: TableColumn<Row>[] = [
    { key: "name", header: t("columns.name"), render: (row) => row.name },
    ...WEEKDAYS.map((day): TableColumn<Row> => ({
      key: `day-${String(day)}`,
      header: weekdayOf(day),
      render: (row) => dayText(row, day),
    })),
    {
      key: "owner",
      header: t("columns.owner"),
      render: (row) => <Tag label={row.ownerOrg.name} />,
    },
    { key: "enabled", header: t("columns.enabled"), render: enabledOf },
  ];

  return (
    <Stack spacing={2}>
      {canCreate && (
        <Button
          sx={{ alignSelf: "flex-end" }}
          onClick={() => {
            setEditing({ mode: "create" });
          }}
        >
          {t("create")}
        </Button>
      )}
      {isMobile ? (
        <Stack spacing={1.5}>
          {rows.map((row) => (
            <Card
              key={row.id}
              variant="outlined"
              sx={{ p: 1.5, cursor: "pointer" }}
              onClick={() => {
                setEditing({ mode: "edit", row });
              }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography variant="subtitle2" sx={{ flex: 1 }}>
                  {row.name}
                </Typography>
                <Tag label={row.ownerOrg.name} />
                {enabledOf(row)}
              </Stack>
              <Typography variant="body2" color="textSecondary">
                {WEEKDAYS.map((day) =>
                  t("dayCell", {
                    day: weekdayOf(day),
                    templates: dayText(row, day),
                  }),
                ).join(" · ")}
              </Typography>
            </Card>
          ))}
        </Stack>
      ) : (
        <Table
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          isLoading={query.isLoading}
          onRowClick={(row) => {
            setEditing({ mode: "edit", row });
          }}
          size="small"
        />
      )}
      {editing !== null && (
        <WeekTemplateDialog
          weekTemplate={editing.mode === "edit" ? editing.row : null}
          templates={templates.data?.scheduleDemandTemplates.items ?? []}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </Stack>
  );
};
