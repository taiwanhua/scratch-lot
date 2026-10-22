import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import {
  type ScheduleStaffRowFieldsFragment,
  useAddScheduleStaffMutation,
  useScheduleStaffQuery,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Checkbox } from "@repo/ui/checkbox";
import { useBreakpointDown } from "@repo/ui/media-query";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useModuleRoutes } from "@/hooks/base/useModuleRoutes";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";

import { scheduleErrorKey } from "../../schedule-error";
import { SCHEDULE_PERMISSIONS } from "../../schedule-permissions";
import { StaffDialog } from "./StaffDialog";

type Row = ScheduleStaffRowFieldsFragment;

const joinedSchema = z.enum(["all", "yes", "no"]).default("all");

/** 已加入 / 未加入篩選 → api 的 `joined`。 */
const JOINED_INPUT = { all: null, yes: true, no: false } as const;

/**
 * 排班設定 → 排班人員(SC-08;規格 14.3):從使用者管理已有的帳號挑人 [加入排班]。
 *
 * - 只有**未加入**的人可以勾選;勾選後右上 [加入排班(N)](要 `edit-staff`)
 * - 點已加入的人 → 排班人員設定(SC-26:僱用類型、可以排的分店、可擔任負責人、主要分店)
 * - 列表底部「找不到人?」連到使用者管理(有那個模組才顯示)
 * - 手機改成卡片清單
 */
export const StaffTab = () => {
  const t = useTranslations("admin.schedule.staff");
  const tEmployment = useTranslations("admin.schedule.employment");
  const tErrors = useTranslations("admin.schedule.errors");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const navigate = useNavigate();
  const routeOf = useModuleRoutes();
  const [keyword, setKeyword] = useState("");
  const [joined, setJoined] = useUrlState("joined", joinedSchema);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<Row | null>(null);

  const variables = {
    input: {
      joined: JOINED_INPUT[joined],
      ...(keyword.trim() === "" ? {} : { keyword: keyword.trim() }),
    },
  };
  const query = useScheduleStaffQuery(session.client, variables);
  const rows = query.data?.scheduleStaff.items ?? [];
  const canEdit = query.data?.scheduleStaff.canEdit ?? false;
  const userManagerRoute = routeOf(SCHEDULE_PERMISSIONS.userManagerModule);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: useScheduleStaffQuery.getKey() });

  const add = useAddScheduleStaffMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.addSuccess"),
      error: (error) => tErrors(scheduleErrorKey(error)),
      onSuccess: () => {
        setSelected([]);
        void invalidate();
      },
    }),
  );

  const toggle = (userId: string, checked: boolean) => {
    setSelected((current) =>
      checked ? [...current, userId] : current.filter((id) => id !== userId),
    );
  };

  const primaryOf = (row: Row): string => {
    if (row.staff === null || row.staff === undefined) {
      return "—";
    }
    if (row.staff.primaryElsewhere) {
      return t("primaryElsewhere");
    }
    return row.staff.orgs.find((org) => org.isPrimary)?.orgName ?? "—";
  };

  const orgsOf = (row: Row): string =>
    row.staff?.orgs.length
      ? row.staff.orgs
          .map((org) =>
            org.canLead
              ? t("canLeadSuffix", { name: org.orgName })
              : org.orgName,
          )
          .join("、")
      : "—";

  const statusOf = (row: Row) => {
    // 別店建的檔案、因為可以排的分店有我看得到的店才看得到(資料共用):只能看
    if (row.staff?.isShared === true) {
      return <Tag label={t("sharedFromOtherOrg")} tone="primary" />;
    }
    if (row.staff) {
      return <Tag label={t("joinedYes")} tone="success" />;
    }
    // 已被看不到的組織加入(一人一份):不能再加入
    return row.joinedElsewhere ? (
      <Tag label={t("joinedElsewhere")} />
    ) : (
      <Tag label={t("joinedNo")} tone="warning" />
    );
  };

  const checkboxOf = (row: Row) => (
    <Checkbox
      checked={selected.includes(row.userId)}
      disabled={row.staff !== null || row.joinedElsewhere || !canEdit}
      onChange={(_event, checked) => {
        toggle(row.userId, checked);
      }}
      slotProps={{
        input: { "aria-label": t("selectAria", { name: row.name }) },
      }}
    />
  );

  const columns: TableColumn<Row>[] = [
    { key: "select", header: "", width: 56, render: checkboxOf },
    { key: "name", header: t("columns.name"), render: (row) => row.name },
    {
      key: "employmentType",
      header: t("columns.employmentType"),
      render: (row) =>
        row.staff ? tEmployment(row.staff.employmentType) : "—",
    },
    { key: "primary", header: t("columns.primary"), render: primaryOf },
    { key: "orgs", header: t("columns.orgs"), render: orgsOf },
    { key: "status", header: t("columns.status"), render: statusOf },
  ];

  const open = (row: Row) => {
    if (row.staff) {
      setEditing(row);
    }
  };

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ alignItems: { sm: "center" } }}
      >
        <TextField
          label={t("keyword")}
          value={keyword}
          size="small"
          onChange={(event) => {
            setKeyword(event.target.value);
          }}
        />
        <SelectField
          label={t("joinedFilter")}
          value={joined}
          size="small"
          options={[
            { value: "all", label: t("joinedAll") },
            { value: "yes", label: t("joinedYes") },
            { value: "no", label: t("joinedNo") },
          ]}
          onChange={(next) => {
            setJoined(joinedSchema.parse(next));
          }}
        />
        <Stack sx={{ flex: 1 }} />
        {canEdit && (
          <Button
            disabled={selected.length === 0 || add.isPending}
            onClick={() => {
              add.mutate({ input: { userIds: selected } });
            }}
          >
            {t("add", { count: selected.length })}
          </Button>
        )}
      </Stack>
      {isMobile ? (
        <Stack spacing={1.5}>
          {rows.map((row) => (
            <Card
              key={row.userId}
              variant="outlined"
              sx={{ p: 1.5, cursor: row.staff ? "pointer" : "default" }}
              onClick={() => {
                open(row);
              }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                {!row.staff && checkboxOf(row)}
                <Typography variant="subtitle2" sx={{ flex: 1 }}>
                  {row.name}
                </Typography>
                {statusOf(row)}
              </Stack>
              {row.staff && (
                <Typography variant="body2" color="textSecondary">
                  {tEmployment(row.staff.employmentType)} · {orgsOf(row)}
                </Typography>
              )}
            </Card>
          ))}
        </Stack>
      ) : (
        <Table
          minWidth={720}
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.userId}
          isLoading={query.isLoading}
          onRowClick={open}
          size="small"
        />
      )}
      {userManagerRoute !== null && (
        <Button
          variant="text"
          size="small"
          sx={{ alignSelf: "flex-start" }}
          onClick={() => {
            void navigate(userManagerRoute);
          }}
        >
          {t("notFound")}
        </Button>
      )}
      {editing?.staff && (
        <StaffDialog
          row={editing}
          canEdit={canEdit && !editing.staff.isShared}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </Stack>
  );
};
