import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  type WorkflowTaskFieldsFragment,
  WorkflowTaskStatus,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { DataTable, type DataTableColumn } from "@repo/ui/data-table";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Tag, type TagTone } from "@repo/ui/tag";

import type { ApplicableModule } from "@/hooks/base/useApplicableForms";
import { useModuleRoutes } from "@/hooks/base/useModuleRoutes";
import { useMyTasks } from "@/hooks/base/useMyTasks";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import { APPLY_CENTER_VIEW_PAGE_KEY } from "../apply-center-keys";
import { ApplyCenterFilters } from "./ApplyCenterFilters";
import { TablePager } from "./TablePager";

const PAGE_SIZE = 20;

const TASK_TONE: Record<WorkflowTaskStatus, TagTone> = {
  [WorkflowTaskStatus.Pending]: "primary",
  [WorkflowTaskStatus.Approved]: "success",
  [WorkflowTaskStatus.Rejected]: "error",
  [WorkflowTaskStatus.Returned]: "warning",
  [WorkflowTaskStatus.Late]: "grey",
  [WorkflowTaskStatus.Cancelled]: "grey",
  [WorkflowTaskStatus.Blocked]: "warning",
};

type DoneFilter = "pending" | "done";

export interface MyTasksTabProps {
  modules: readonly ApplicableModule[];
}

/**
 * 「待我審核」(Spec 6b §8 畫面 8):模組、表單、實例快照的標題槽、申請人、關卡、建立時間;
 * 篩選模組 / 表單 / 待處理 · 已處理。點「審核」進申請中心詳情頁(不經業務模組頁面權限)。
 */
export const MyTasksTab = ({ modules }: MyTasksTabProps) => {
  const t = useTranslations("admin.applyCenter.tasks");
  const navigate = useNavigate();
  const routeOf = useModuleRoutes();
  const temporalText = useTemporalText();
  const [moduleKey, setModuleKey] = useState<string | null>(null);
  const [formKey, setFormKey] = useState<string | null>(null);
  const [done, setDone] = useState<DoneFilter>("pending");
  const [page, setPage] = useState(1);
  const list = useMyTasks({
    moduleKey,
    formKey,
    done: done === "done",
    page,
    pageSize: PAGE_SIZE,
  });
  const viewRoute = routeOf(APPLY_CENTER_VIEW_PAGE_KEY);

  const columns: DataTableColumn<WorkflowTaskFieldsFragment>[] = [
    {
      key: "module",
      header: t("module"),
      width: 140,
      accessor: (row) => row.moduleName ?? row.moduleKey,
    },
    {
      key: "form",
      header: t("form"),
      width: 160,
      accessor: (row) => row.formName ?? row.formKey,
    },
    {
      key: "title",
      header: t("title"),
      width: 200,
      isEmphasized: true,
      accessor: (row) => row.summary?.title ?? "—",
    },
    {
      key: "applicant",
      header: t("applicant"),
      width: 120,
      accessor: (row) => row.applicant?.name ?? "—",
    },
    {
      key: "step",
      header: t("step"),
      width: 140,
      accessor: (row) => row.stepName,
    },
    {
      key: "status",
      header: t("status"),
      width: 110,
      render: ({ row }) => (
        <Tag tone={TASK_TONE[row.status]} label={t(`statuses.${row.status}`)} />
      ),
    },
    {
      key: "createdAt",
      header: t("createdAt"),
      width: 170,
      accessor: (row) => temporalText(row.createdAt, "datetime"),
    },
    {
      key: "actions",
      header: t("actions"),
      width: 110,
      pinned: "right",
      render: ({ row }) =>
        viewRoute === null ? null : (
          <Button
            size="small"
            variant="text"
            aria-label={t("openOf", {
              label: row.summary?.title ?? row.formName ?? row.formKey,
            })}
            onClick={() => {
              void navigate(`${viewRoute}/${row.instanceId}`);
            }}
          >
            {row.status === WorkflowTaskStatus.Pending
              ? t("review")
              : t("view")}
          </Button>
        ),
    },
  ];

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <ApplyCenterFilters
        modules={modules}
        moduleKey={moduleKey}
        onModuleKeyChange={(next) => {
          setModuleKey(next);
          setPage(1);
        }}
        formKey={formKey}
        onFormKeyChange={(next) => {
          setFormKey(next);
          setPage(1);
        }}
      >
        <SelectField<DoneFilter>
          label={t("doneFilter")}
          value={done}
          size="small"
          sx={{ width: 140 }}
          options={[
            { value: "pending", label: t("pending") },
            { value: "done", label: t("done") },
          ]}
          onChange={(next) => {
            setDone(next);
            setPage(1);
          }}
        />
      </ApplyCenterFilters>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DataTable
          columns={columns}
          rows={list.items}
          getRowKey={(row) => row.id}
          isLoading={list.isLoading}
          emptyMessage={done === "pending" ? t("emptyPending") : t("emptyDone")}
          size="small"
          aria-label={t("tableAria")}
        />
      </Box>
      <TablePager
        totalCount={list.totalCount}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
      />
    </Stack>
  );
};
