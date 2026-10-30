import { useState } from "react";
import { useTranslations } from "use-intl";

import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import { isTagPaletteKey } from "@repo/domain/tag-palette";
import {
  type ScheduleDemandTemplateFieldsFragment,
  useScheduleDemandTemplatesQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { TagPaletteChip } from "@/components/base/TagPaletteChip/TagPaletteChip";
import { useSession } from "@/hooks/base/useSession";
import { useScheduleFieldOptions } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";

import { TemplateDialog } from "./TemplateDialog";

type Row = ScheduleDemandTemplateFieldsFragment;

/** 開啟中的對話框:新增 / 某一筆。 */
type Editing = { mode: "create" } | { mode: "edit"; row: Row };

/**
 * 排班設定 → 人力需求範本(SC-09a;規格 14.4):可見 = 這一層 + 所有上層建立的;
 * 列表「建立於」= 建立它的組織。點一列打開範本對話框(SC-22a);
 * 上層建立的唯讀(只有建立的那一層能改)。沒有 `edit-templates` 看不到 [+ 新增人力需求範本]。
 */
export const TemplatesTab = () => {
  const t = useTranslations("admin.schedule.templates");
  const { session } = useSession();
  const isMobile = useBreakpointDown("sm");
  const positions = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.position,
  );
  const query = useScheduleDemandTemplatesQuery(session.client);
  const rows = query.data?.scheduleDemandTemplates.items ?? [];
  const canCreate = query.data?.scheduleDemandTemplates.canCreate ?? false;
  const [editing, setEditing] = useState<Editing | null>(null);

  const timeOf = (row: Row) =>
    t("timeRange", { start: row.startTime, end: row.endTime });
  const tasksOf = (row: Row) =>
    t("taskCount", {
      leader: row.tasks.filter((task) => task.role === "leader").length,
      helper: row.tasks.filter((task) => task.role === "helper").length,
    });
  const colorOf = (row: Row) =>
    isTagPaletteKey(row.paletteKey) ? (
      <TagPaletteChip paletteKey={row.paletteKey} />
    ) : (
      "—"
    );
  const ownerOf = (row: Row) => <Tag label={row.ownerOrg.name} />;

  const columns: TableColumn<Row>[] = [
    { key: "name", header: t("columns.name"), render: (row) => row.name },
    {
      key: "shortName",
      header: t("columns.shortName"),
      render: (row) => row.shortName,
    },
    { key: "time", header: t("columns.time"), render: timeOf },
    {
      key: "position",
      header: t("columns.position"),
      render: (row) => positions.labelOf(row.positionKey),
    },
    { key: "tasks", header: t("columns.tasks"), render: tasksOf },
    { key: "color", header: t("columns.color"), render: colorOf },
    { key: "owner", header: t("columns.owner"), render: ownerOf },
  ];

  return (
    // 列表分頁(STYLE-08):平板以上分頁殼釘高,清單那一層吃掉剩下的高度並自己捲(表頭固定);手機寬整頁捲
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
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
      <Box sx={{ flex: 1, minHeight: 0 }}>
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
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center" }}
                >
                  {colorOf(row)}
                  <Typography variant="subtitle2" sx={{ flex: 1 }}>
                    {row.name}({row.shortName})
                  </Typography>
                  {ownerOf(row)}
                </Stack>
                <Typography variant="body2" color="textSecondary">
                  {t("cardMeta", {
                    time: timeOf(row),
                    position: positions.labelOf(row.positionKey),
                    tasks: tasksOf(row),
                  })}
                </Typography>
              </Card>
            ))}
          </Stack>
        ) : (
          <Table
            minWidth={960}
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
      </Box>
      <Typography variant="caption" color="textSecondary">
        {t("hint")}
      </Typography>
      {editing !== null && (
        <TemplateDialog
          template={editing.mode === "edit" ? editing.row : null}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </Stack>
  );
};
