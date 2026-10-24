import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import {
  localMonthText,
  parseLocalDate,
  parseLocalMonth,
} from "@repo/domain/form";
import {
  type ScheduleAttendancePunchFieldsFragment,
  type ScheduleAttendanceRowFieldsFragment,
  useScheduleAttendanceByPersonQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { IconButton } from "@repo/ui/icon-button";
import { ChevronLeftIcon, ChevronRightIcon } from "@repo/ui/icons";
import { useBreakpointDown } from "@repo/ui/media-query";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";
import { useTenantToday } from "@/hooks/base/useTenantToday";
import { useUrlState } from "@/hooks/base/useUrlState";
import { monthRangeOf } from "@/lib/project/schedule-day-offs";
import { shiftMonthOf } from "@/lib/project/schedule-roster";

import { scheduleErrorOf } from "../schedule-error";
import { AttendanceActions } from "./AttendanceActions";
import { ReassignPunchDialog } from "./ReassignPunchDialog";
import { ATTENDANCE_URL_KEYS } from "./attendance-keys";
import { useAttendanceText } from "./useAttendanceText";
import { makeupPrefillOf, useMakeupPunchHref } from "./useMakeupPunchHref";

type Row = ScheduleAttendanceRowFieldsFragment;
type Punch = ScheduleAttendancePunchFieldsFragment;

/** `?month=YYYY-MM`;空字串 / 格式不對 = 這個月。 */
const MONTH_SCHEMA = z.string().default("");
/** `?person=<使用者 id>`;空字串 = 自己。 */
const PERSON_SCHEMA = z.string().default("");

/**
 * 出勤紀錄 → 依人員(月)(SC-11;規格 14.7):一個人一個月的班與打卡(跨分店合併)、實際工時、遲到 / 早退、
 * 特殊日;缺卡的班附 [補打卡](帶入日期、分店、類型、對應排班)。員工只看自己的(人員選單只有自己);
 * `view-all` 可以選這家店的排班人員。月份、人員放網址;不自動更新。平板 / 手機改成卡片。
 */
export const ByPersonTab = () => {
  const t = useTranslations("admin.schedule.attendance");
  const tErrors = useTranslations("admin.schedule.errors");
  const text = useAttendanceText();
  const navigate = useNavigate();
  const { session } = useSession();
  const today = useTenantToday();
  const isNarrow = useBreakpointDown("md");
  const makeupHref = useMakeupPunchHref();
  const [monthParam, setMonth] = useUrlState(
    ATTENDANCE_URL_KEYS.month,
    MONTH_SCHEMA,
  );
  const [person, setPerson] = useUrlState(
    ATTENDANCE_URL_KEYS.person,
    PERSON_SCHEMA,
  );
  // 這個月以租戶時區的今天判斷
  const todayDate = parseLocalDate(today);
  const month =
    parseLocalMonth(monthParam) === null && todayDate !== null
      ? localMonthText(todayDate)
      : monthParam;
  // 送那個月在租戶時區的時點區間 `[月初 00:00, 下月初 00:00)`
  const range = monthRangeOf(month, text.timezone) ?? { from: "", to: "" };
  const [reassigning, setReassigning] = useState<readonly Punch[] | null>(null);
  const query = useScheduleAttendanceByPersonQuery(session.client, {
    input: { ...range, ...(person === "" ? {} : { userId: person }) },
  });
  const data = query.data?.scheduleAttendanceByPerson;
  const canReassign = data?.abilities.canReassign ?? false;
  const shown = parseLocalMonth(month);

  const makeupButton = (row: Row) =>
    makeupHref !== null &&
    row.missing.length > 0 &&
    data?.userId === row.userId ? (
      <Button
        variant="text"
        size="small"
        onClick={() => {
          void navigate(makeupHref(makeupPrefillOf(row)));
        }}
      >
        {t("makeupRow")}
      </Button>
    ) : null;

  const actions = (row: Row) => (
    <Stack direction="row" spacing={0.5}>
      {makeupButton(row)}
      {canReassign && row.punches.length > 0 && (
        <Button
          variant="text"
          size="small"
          onClick={() => {
            setReassigning(row.punches);
          }}
        >
          {t("reassignButton")}
        </Button>
      )}
    </Stack>
  );

  const clockText = (
    row: Row,
    value: string | null | undefined,
    type: "in" | "out",
  ) =>
    text.time(value) ??
    (row.missing.includes(type) ? (
      <Typography component="span" variant="body2" color="error">
        {t("missing")}
      </Typography>
    ) : (
      t("none")
    ));

  const columns: TableColumn<Row>[] = [
    {
      key: "date",
      header: t("columns.date"),
      width: 100,
      render: (row) => text.dateTitle(row.date),
    },
    {
      key: "entry",
      header: t("columns.entry"),
      render: (row) => `${row.orgName} ${text.entry(row)}`,
    },
    {
      key: "clockIn",
      header: t("columns.clockIn"),
      width: 80,
      render: (row) => clockText(row, row.clockIn, "in"),
    },
    {
      key: "clockOut",
      header: t("columns.clockOut"),
      width: 80,
      render: (row) => clockText(row, row.clockOut, "out"),
    },
    {
      key: "worked",
      header: t("columns.worked"),
      width: 90,
      render: (row) => text.hours(row.workedMinutes) ?? t("none"),
    },
    {
      key: "late",
      header: t("columns.late"),
      width: 80,
      render: (row) =>
        row.lateMinutes > 0 ? t("minutes", { minutes: row.lateMinutes }) : "",
    },
    {
      key: "early",
      header: t("columns.early"),
      width: 80,
      render: (row) =>
        row.earlyLeaveMinutes > 0
          ? t("minutes", { minutes: row.earlyLeaveMinutes })
          : "",
    },
    {
      key: "special",
      header: t("columns.special"),
      width: 100,
      render: (row) => row.specialDayName ?? row.specialDayCategory ?? "",
    },
    {
      key: "actions",
      header: t("columns.actions"),
      width: 180,
      render: actions,
    },
  ];

  const toolbar = (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={1.5}
      useFlexGap
      sx={{ alignItems: { sm: "center" }, flexWrap: "wrap" }}
    >
      <SelectField
        label={t("person")}
        size="small"
        value={data?.userId ?? ""}
        disabled={data?.abilities.canViewAll !== true}
        options={(data?.people ?? []).map((item) => ({
          value: item.userId,
          label: item.name,
        }))}
        onChange={setPerson}
        sx={{ minWidth: 200 }}
      />
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
        <IconButton
          size="small"
          aria-label={t("prevMonth")}
          onClick={() => {
            setMonth(shiftMonthOf(month, -1));
          }}
        >
          <ChevronLeftIcon />
        </IconButton>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t("monthTitle", {
            year: String(shown?.year ?? ""),
            month: shown?.month ?? 0,
          })}
        </Typography>
        <IconButton
          size="small"
          aria-label={t("nextMonth")}
          onClick={() => {
            setMonth(shiftMonthOf(month, 1));
          }}
        >
          <ChevronRightIcon />
        </IconButton>
      </Stack>
      {data !== undefined && (
        <AttendanceActions
          canExport={data.abilities.canExport}
          exportInput={{ ...range, orgId: data.orgId, userId: data.userId }}
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

  const rows = data?.rows ?? [];
  const unmatched = data?.unmatched ?? [];

  return (
    // 列表分頁(STYLE-08):最外層 `flex: 1; minHeight: 0`,清單外面再包一層 `flex: 1; minHeight: 0`、只放清單,
    // 平板以上且視窗夠高時由表格在卡片裡捲(表頭固定);工具列與未對應排班的打卡在那一層外面
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0, pt: 1 }}>
      {toolbar}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        {isNarrow ? (
          <Stack spacing={1.5} aria-label={t("rowsAria")} role="list">
            {rows.map((row) => (
              <Card key={row.entryId} role="listitem" sx={{ p: 2 }}>
                <Stack spacing={0.5}>
                  <Typography variant="subtitle2">
                    {`${text.dateTitle(row.date)} ${row.orgName} ${text.entry(row)}`}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    {t("personCardLine", {
                      clockIn: text.time(row.clockIn) ?? t("none"),
                      clockOut: text.time(row.clockOut) ?? t("none"),
                      worked: text.hours(row.workedMinutes) ?? t("none"),
                    })}
                  </Typography>
                  {(row.lateMinutes > 0 || row.earlyLeaveMinutes > 0) && (
                    <Typography variant="body2" color="warning">
                      {[
                        row.lateMinutes > 0
                          ? t("lateShort", { minutes: row.lateMinutes })
                          : null,
                        row.earlyLeaveMinutes > 0
                          ? t("earlyShort", { minutes: row.earlyLeaveMinutes })
                          : null,
                      ]
                        .filter((item) => item !== null)
                        .join(" · ")}
                    </Typography>
                  )}
                  {row.missing.length > 0 && (
                    <Typography variant="body2" color="error">
                      {t("missing")}
                    </Typography>
                  )}
                  <Box>{actions(row)}</Box>
                </Stack>
              </Card>
            ))}
            {rows.length === 0 && !query.isLoading && (
              <Typography color="textSecondary">{t("emptyMonth")}</Typography>
            )}
          </Stack>
        ) : (
          <Table
            minWidth={960}
            aria-label={t("rowsAria")}
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.entryId}
            isLoading={query.isLoading}
            emptyMessage={t("emptyMonth")}
          />
        )}
      </Box>
      {unmatched.length > 0 && (
        <Card
          sx={{ p: 2, flexShrink: 0 }}
          component="section"
          aria-label={t("unmatchedTitle")}
        >
          <Stack spacing={1}>
            <Typography variant="subtitle2" component="h3">
              {t("unmatchedTitle")}
            </Typography>
            {unmatched.map((punch) => (
              <Stack
                key={punch.id}
                direction="row"
                spacing={1}
                sx={{ alignItems: "center", justifyContent: "space-between" }}
              >
                <Typography variant="body2">
                  {`${punch.orgName} · ${text.punchLabel(punch)}`}
                </Typography>
                {canReassign && (
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => {
                      setReassigning([punch]);
                    }}
                  >
                    {t("reassignButton")}
                  </Button>
                )}
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
