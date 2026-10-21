import { useState } from "react";
import { useTranslations } from "use-intl";
import { z } from "zod";

import {
  type ScheduleAttendancePunchFieldsFragment,
  type ScheduleAttendanceRowFieldsFragment,
  useScheduleAttendanceByStoreQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Checkbox } from "@repo/ui/checkbox";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { IconButton } from "@repo/ui/icon-button";
import { ChevronLeftIcon, ChevronRightIcon } from "@repo/ui/icons";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Typography } from "@repo/ui/typography";

import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";
import { shiftDay } from "@/lib/project/schedule-roster";

import { useTenantToday } from "../manage/roster/views/useRosterDate";
import { scheduleErrorOf } from "../schedule-error";
import { AttendanceActions } from "./AttendanceActions";
import { AttendanceStatusTags } from "./AttendanceStatusTags";
import { ReassignPunchDialog } from "./ReassignPunchDialog";
import { ATTENDANCE_URL_KEYS } from "./attendance-keys";
import { useAttendanceText } from "./useAttendanceText";

type Row = ScheduleAttendanceRowFieldsFragment;
type Punch = ScheduleAttendancePunchFieldsFragment;

const ORG_SCHEMA = z.string().default("");
/** `?date=YYYY-MM-DD`;空字串 / 格式不對 = 今天。 */
const DATE_SCHEMA = z.string().default("");
const UNMATCHED_SCHEMA = z.boolean().default(false);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/** 依人分組的未對應排班的卡(畫面一人一行:「張小芳 · 09:02 上班 · 15:10 下班」)。 */
const groupByPerson = (punches: readonly Punch[]): Punch[][] => {
  const groups = new Map<string, Punch[]>();
  for (const punch of punches) {
    groups.set(punch.userId, [...(groups.get(punch.userId) ?? []), punch]);
  }
  return [...groups.values()];
};

/**
 * 出勤紀錄 → 依分店(日)(SC-12;規格 14.7):當天排班的人、上下班打卡、已到 / 未到 / 遲到 / 早退
 * (寬限用分店的規則);沒有對應排班的打卡另列「未對應排班」,可以勾「只看未對應排班的打卡」。
 * 員工只看到自己的(api 擋);不自動更新、不放刷新按鈕。分店、日期、篩選放網址。
 * 每列 [改對應排班](`reassign-punches`)。平板 / 手機照 RW-01 改成卡片。
 */
export const ByStoreTab = () => {
  const t = useTranslations("admin.schedule.attendance");
  const tErrors = useTranslations("admin.schedule.errors");
  const text = useAttendanceText();
  const { session } = useSession();
  const today = useTenantToday();
  const isNarrow = useBreakpointDown("md");
  const [orgId, setOrgId] = useUrlState(ATTENDANCE_URL_KEYS.org, ORG_SCHEMA);
  const [dateParam, setDate] = useUrlState(
    ATTENDANCE_URL_KEYS.date,
    DATE_SCHEMA,
  );
  const [unmatchedOnly, setUnmatchedOnly] = useUrlState(
    ATTENDANCE_URL_KEYS.unmatched,
    UNMATCHED_SCHEMA,
  );
  const date = DATE_PATTERN.test(dateParam) ? dateParam : today;
  const [reassigning, setReassigning] = useState<readonly Punch[] | null>(null);
  const query = useScheduleAttendanceByStoreQuery(session.client, {
    input: {
      date,
      unmatchedOnly,
      ...(orgId === "" ? {} : { orgId }),
    },
  });
  const data = query.data?.scheduleAttendanceByStore;
  const canReassign = data?.abilities.canReassign ?? false;

  const reassignButton = (
    punches: readonly Punch[],
    variant: "text" | "outlined" = "text",
  ) =>
    canReassign && punches.length > 0 ? (
      <Button
        variant={variant}
        size="small"
        onClick={() => {
          setReassigning(punches);
        }}
      >
        {t("reassignButton")}
      </Button>
    ) : null;

  const columns: TableColumn<Row>[] = [
    {
      key: "person",
      header: t("columns.person"),
      isEmphasized: true,
      render: (row) => row.userName,
    },
    {
      key: "entry",
      header: t("columns.entry"),
      render: (row) => text.entry(row),
    },
    {
      key: "clockIn",
      header: t("columns.clockIn"),
      width: 90,
      render: (row) => text.time(row.clockIn) ?? t("none"),
    },
    {
      key: "clockOut",
      header: t("columns.clockOut"),
      width: 90,
      render: (row) => text.time(row.clockOut) ?? t("none"),
    },
    {
      key: "status",
      header: t("columns.status"),
      render: (row) => <AttendanceStatusTags row={row} />,
    },
    {
      key: "actions",
      header: t("columns.actions"),
      width: 130,
      render: (row) => reassignButton(row.punches),
    },
  ];

  const toolbar = (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={1.5}
      useFlexGap
      sx={{ alignItems: { sm: "center" }, flexWrap: "wrap" }}
    >
      <OrgTreeSelect
        // 業務頁篩選:可見範圍內的才能選(用法表 ④)
        scope="visible"
        label={t("org")}
        value={data === undefined ? [] : [data.orgId]}
        size="small"
        onChange={(ids) => {
          setOrgId(ids.at(0) ?? "");
        }}
      />
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
        <IconButton
          size="small"
          aria-label={t("prevDate")}
          onClick={() => {
            setDate(shiftDay(date, -1));
          }}
        >
          <ChevronLeftIcon />
        </IconButton>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {text.dateTitle(date)}
        </Typography>
        <IconButton
          size="small"
          aria-label={t("nextDate")}
          onClick={() => {
            setDate(shiftDay(date, 1));
          }}
        >
          <ChevronRightIcon />
        </IconButton>
      </Stack>
      <FormControlLabel
        label={t("unmatchedOnly")}
        control={
          <Checkbox
            checked={unmatchedOnly}
            onChange={(event) => {
              setUnmatchedOnly(event.target.checked);
            }}
          />
        }
      />
      {data !== undefined && (
        <AttendanceActions
          canExport={data.abilities.canExport}
          exportInput={{ month: date.slice(0, 7), orgId: data.orgId }}
        />
      )}
    </Stack>
  );

  if (query.error !== null) {
    return (
      <Stack spacing={2}>
        {toolbar}
        <Alert severity="error">
          {tErrors(scheduleErrorOf(query.error).code)}
        </Alert>
      </Stack>
    );
  }

  const unmatchedGroups = groupByPerson(data?.unmatched ?? []);
  const rows = data?.rows ?? [];

  return (
    <Stack spacing={2}>
      {toolbar}
      {data !== undefined && (
        <Typography variant="subtitle2" component="p">
          {t("summary", {
            scheduled: data.scheduledCount,
            arrived: data.arrivedCount,
            absent: data.absentCount,
            unmatched: data.unmatched.length,
          })}
        </Typography>
      )}
      {!unmatchedOnly &&
        (isNarrow ? (
          <Stack spacing={1.5} aria-label={t("rowsAria")} role="list">
            {rows.map((row) => (
              <Card key={row.entryId} role="listitem" sx={{ p: 2 }}>
                <Stack spacing={0.75}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <Typography variant="subtitle2">{row.userName}</Typography>
                    <AttendanceStatusTags row={row} />
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {t("cardLine", {
                      entry: text.entry(row),
                      clockIn: text.time(row.clockIn) ?? t("none"),
                      clockOut: text.time(row.clockOut) ?? t("none"),
                    })}
                  </Typography>
                  <Box>{reassignButton(row.punches)}</Box>
                </Stack>
              </Card>
            ))}
            {rows.length === 0 && !query.isLoading && (
              <Typography color="text.secondary">{t("emptyRows")}</Typography>
            )}
          </Stack>
        ) : (
          <Table
            aria-label={t("rowsAria")}
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.entryId}
            isLoading={query.isLoading}
            emptyMessage={t("emptyRows")}
          />
        ))}
      {(unmatchedOnly || unmatchedGroups.length > 0) && (
        <Card
          sx={{ p: 2 }}
          component="section"
          aria-label={t("unmatchedTitle")}
        >
          <Stack spacing={1}>
            <Typography variant="subtitle2" component="h3">
              {t("unmatchedTitle")}
            </Typography>
            {unmatchedGroups.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                {t("unmatchedEmpty")}
              </Typography>
            )}
            {unmatchedGroups.map((punches) => (
              <Stack
                key={punches[0]?.userId}
                direction="row"
                spacing={1}
                useFlexGap
                sx={{
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                }}
              >
                <Typography variant="body2">
                  {[
                    punches[0]?.userName ?? "",
                    ...punches.map((punch) => text.punchShort(punch)),
                  ].join(" · ")}
                </Typography>
                {reassignButton(punches, "outlined")}
              </Stack>
            ))}
          </Stack>
        </Card>
      )}
      {reassigning !== null && (
        <ReassignPunchDialog
          punches={reassigning}
          onClose={() => {
            setReassigning(null);
          }}
        />
      )}
    </Stack>
  );
};
