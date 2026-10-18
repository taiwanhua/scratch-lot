import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { FormSubmissionStatus } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { DataTable, type DataTableColumn } from "@repo/ui/data-table";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";

import { SubmissionStatusTag } from "@/components/base/workflow/SubmissionStatusTag";
import type { ApplicableModule } from "@/hooks/base/useApplicableForms";
import { useModuleRoutes } from "@/hooks/base/useModuleRoutes";
import {
  type MyApplication,
  useMyApplications,
} from "@/hooks/base/useMyApplications";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useUrlState } from "@/hooks/base/useUrlState";

import {
  APPLY_CENTER_VIEW_PAGE_KEY,
  formModulePageKey,
} from "../apply-center-keys";
import { ApplyCenterFilters } from "./ApplyCenterFilters";
import { TablePager } from "./TablePager";
import {
  APPLY_CENTER_LIST_KEY,
  myApplicationsListSchema,
} from "./apply-center-list";

const PAGE_SIZE = 20;
const ALL = "";

const STATUSES: readonly FormSubmissionStatus[] = [
  FormSubmissionStatus.Draft,
  FormSubmissionStatus.Reviewing,
  FormSubmissionStatus.Returned,
  FormSubmissionStatus.Withdrawn,
  FormSubmissionStatus.Completed,
  FormSubmissionStatus.Rejected,
  FormSubmissionStatus.Voided,
];

/** 還能改內容的三種(草稿、被退回、已撤回):列上多一顆「繼續編輯」。 */
const EDITABLE = new Set<FormSubmissionStatus>([
  FormSubmissionStatus.Draft,
  FormSubmissionStatus.Returned,
  FormSubmissionStatus.Withdrawn,
]);

export interface MyApplicationsTabProps {
  modules: readonly ApplicableModule[];
}

/**
 * 「我的申請」:模組、表單、標題槽、狀態 chip、目前關卡(所有進行中的關卡名稱,
 * 平行時多個)、送出時間;篩選模組 / 表單 / 狀態。檢視 → 申請中心詳情頁;草稿 / 退回 / 撤回 → 回該模組的編輯頁改。
 */
export const MyApplicationsTab = ({ modules }: MyApplicationsTabProps) => {
  const t = useTranslations("admin.applyCenter.mine");
  const tStatus = useTranslations("admin.approval.submissionStatus");
  const navigate = useNavigate();
  const routeOf = useModuleRoutes();
  const temporalText = useTemporalText();
  const [filters, setFilters] = useUrlState(
    APPLY_CENTER_LIST_KEY,
    myApplicationsListSchema,
  );
  const { module: moduleKey, form: formKey, status, page } = filters;
  const list = useMyApplications({
    moduleKey,
    formKey,
    status,
    page,
    pageSize: PAGE_SIZE,
  });
  const viewRoute = routeOf(APPLY_CENTER_VIEW_PAGE_KEY);

  const labelOf = (row: MyApplication): string =>
    row.summary?.title ?? row.formName ?? row.formKey;

  const renderActions = (row: MyApplication) => {
    const editRoute = routeOf(formModulePageKey(row.moduleKey, "edit-page"));
    return (
      <Stack direction="row" spacing={0.5}>
        {viewRoute !== null &&
          row.currentInstanceId !== null &&
          row.currentInstanceId !== undefined && (
            <Button
              size="small"
              variant="text"
              aria-label={t("viewOf", { label: labelOf(row) })}
              onClick={() => {
                void navigate(`${viewRoute}/${row.currentInstanceId ?? ""}`);
              }}
            >
              {t("view")}
            </Button>
          )}
        {editRoute !== null && EDITABLE.has(row.status) && (
          <Button
            size="small"
            variant="text"
            aria-label={t("editOf", { label: labelOf(row) })}
            onClick={() => {
              void navigate(`${editRoute}/${row.id}`);
            }}
          >
            {t("edit")}
          </Button>
        )}
      </Stack>
    );
  };

  const columns: DataTableColumn<MyApplication>[] = [
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
      key: "status",
      header: t("status"),
      width: 150,
      render: ({ row }) => (
        <SubmissionStatusTag status={row.status} blocked={row.blocked} />
      ),
    },
    {
      key: "activeSteps",
      header: t("activeSteps"),
      width: 200,
      accessor: (row) =>
        row.activeSteps.length === 0
          ? "—"
          : row.activeSteps.map((step) => step.name).join("、"),
    },
    {
      key: "submittedAt",
      header: t("submittedAt"),
      width: 170,
      accessor: (row) =>
        row.submittedAt === null || row.submittedAt === undefined
          ? "—"
          : temporalText(row.submittedAt, "datetime"),
    },
    {
      key: "actions",
      header: t("actions"),
      width: 170,
      pinned: "right",
      render: ({ row }) => renderActions(row),
    },
  ];

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <ApplyCenterFilters
        modules={modules}
        moduleKey={moduleKey}
        onModuleKeyChange={(next) => {
          setFilters((current) => ({ ...current, module: next, page: 1 }));
        }}
        formKey={formKey}
        onFormKeyChange={(next) => {
          setFilters((current) => ({ ...current, form: next, page: 1 }));
        }}
      >
        <SelectField<FormSubmissionStatus | typeof ALL>
          label={t("statusFilter")}
          value={status ?? ALL}
          displayEmpty
          size="small"
          sx={{ width: 180 }}
          options={[
            { value: ALL, label: t("allStatuses") },
            ...STATUSES.map((value) => ({ value, label: tStatus(value) })),
          ]}
          onChange={(next) => {
            setFilters((current) => ({
              ...current,
              status: next === ALL ? null : next,
              page: 1,
            }));
          }}
        />
      </ApplyCenterFilters>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DataTable
          columns={columns}
          rows={list.items}
          getRowKey={(row) => row.id}
          isLoading={list.isLoading}
          emptyMessage={t("empty")}
          size="small"
          aria-label={t("tableAria")}
        />
      </Box>
      <TablePager
        totalCount={list.totalCount}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={(next) => {
          setFilters((current) => ({ ...current, page: next }));
        }}
      />
    </Stack>
  );
};
