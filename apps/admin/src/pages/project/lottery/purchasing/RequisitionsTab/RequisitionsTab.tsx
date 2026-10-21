import { Fragment, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  type FormSubmissionStatus,
  useFormSubmissionsQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Pagination } from "@repo/ui/pagination";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Typography } from "@repo/ui/typography";

import { FilterDrawer } from "@/components/base/FilterDrawer/FilterDrawer";
import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";

import {
  REQUISITION_FORM_KEY,
  REQUISITION_LIST_KEY,
  REQUISITION_MODULE_KEY,
  REQUISITION_PAGE_SIZE,
} from "../purchasing-keys";
import {
  REQUISITION_STATUS_ORDER,
  type RequisitionListFilters,
  type RequisitionRow,
  requisitionListSchema,
} from "./requisitions";
import {
  type RequisitionColumn,
  useRequisitionColumns,
} from "./useRequisitionColumns";

const ALL = "all" as const;

type StatusFilter = typeof ALL | FormSubmissionStatus;

const EMPTY_FILTERS: Pick<RequisitionListFilters, "status"> = { status: null };

/** 卡片標題列放前幾欄。 */
const HEADING_COUNT = 2;

const joined = (
  row: RequisitionRow,
  columns: readonly RequisitionColumn[],
): ReactNode =>
  columns.map((column, index) => (
    <Fragment key={column.key}>
      {index > 0 && " · "}
      {column.render(row)}
    </Fragment>
  ));

/**
 * 「叫貨單」分頁(規格 8.1;Figma PU-01 92:1017):狀態篩選(含「草稿」)+ 列表(欄位讀列表欄位配置,
 * 狀態把已完成再細分 待購買 / 已進貨 / 已調貨);點一筆進詳情頁(檢視、審核、作廢都在那裡)。
 * 草稿只有建立者看得到(api 的範圍規則)。手機列表改卡片、篩選收進抽屜(RW-01)。
 */
export const RequisitionsTab = () => {
  const t = useTranslations("admin.lotteryPurchasing.requisitions");
  const tStatus = useTranslations("admin.approval.submissionStatus");
  const navigate = useNavigate();
  const { session } = useSession();
  const isMobile = useBreakpointDown("sm");
  const access = useFormModuleAccess(REQUISITION_MODULE_KEY);
  const [filters, setFilters] = useUrlState(
    REQUISITION_LIST_KEY,
    requisitionListSchema,
  );

  const query = useFormSubmissionsQuery(session.client, {
    input: {
      moduleKey: REQUISITION_MODULE_KEY,
      formKey: REQUISITION_FORM_KEY,
      keyword: "",
      page: filters.page,
      pageSize: REQUISITION_PAGE_SIZE,
      ...(filters.status !== null && { status: filters.status }),
    },
  });
  const rows = query.data?.formSubmissions.items ?? [];
  const totalCount = query.data?.formSubmissions.totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / REQUISITION_PAGE_SIZE));
  const listColumns = useRequisitionColumns(rows);

  const open = (row: RequisitionRow) => {
    if (access.viewRoute !== null) {
      void navigate(`${access.viewRoute}/${row.id}`);
    }
  };

  const columns: TableColumn<RequisitionRow>[] = listColumns.map((column) => ({
    key: column.key,
    header: column.header,
    width: column.width,
    render: (row) => column.render(row),
  }));

  let list: ReactNode;
  if (!isMobile) {
    list = (
      <Table
        aria-label={t("listAria")}
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        isLoading={query.isLoading}
        emptyMessage={t("empty")}
        minWidth={listColumns.reduce((sum, column) => sum + column.width, 0)}
        onRowClick={open}
      />
    );
  } else if (query.isLoading) {
    list = <CircularProgress aria-label={t("loading")} />;
  } else if (rows.length === 0) {
    list = (
      <Typography variant="body2" color="text.secondary">
        {t("empty")}
      </Typography>
    );
  } else {
    const status = listColumns.find((column) => column.key === "status");
    const others = listColumns.filter((column) => column.key !== "status");
    list = (
      <Stack spacing={1.5} sx={{ height: "100%", overflow: "auto" }}>
        {rows.map((row) => (
          <Card
            key={row.id}
            variant="outlined"
            role="button"
            tabIndex={0}
            onClick={() => {
              open(row);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                open(row);
              }
            }}
            sx={{ p: 2, flexShrink: 0, cursor: "pointer" }}
          >
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography
                  variant="subtitle2"
                  component="div"
                  sx={{ flex: 1 }}
                >
                  {joined(row, others.slice(0, HEADING_COUNT))}
                </Typography>
                {status?.render(row)}
              </Stack>
              <Typography
                variant="body2"
                color="text.secondary"
                component="div"
              >
                {joined(row, others.slice(HEADING_COUNT))}
              </Typography>
            </Stack>
          </Card>
        ))}
      </Stack>
    );
  }

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <FilterDrawer
        value={{ status: filters.status }}
        emptyValue={EMPTY_FILTERS}
        activeCount={filters.status === null ? 0 : 1}
        onApply={(next) => {
          setFilters((current) => ({ ...current, ...next, page: 1 }));
        }}
        renderFields={(value, change) => (
          <SelectField<StatusFilter>
            label={t("filters.status")}
            size="small"
            value={value.status ?? ALL}
            options={[
              { value: ALL, label: t("filters.all") },
              ...REQUISITION_STATUS_ORDER.map((status) => ({
                value: status,
                label: tStatus(status),
              })),
            ]}
            onChange={(next) => {
              change({ status: next === ALL ? null : next });
            }}
            sx={{ minWidth: 200 }}
          />
        )}
      />
      <Box sx={{ flex: 1, minHeight: 0 }}>{list}</Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {t("total", { total: totalCount })}
        </Typography>
        <Pagination
          count={pageCount}
          page={filters.page}
          onChange={(_event, page) => {
            setFilters((current) => ({ ...current, page }));
          }}
        />
      </Stack>
    </Stack>
  );
};
