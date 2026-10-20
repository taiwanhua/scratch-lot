import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  type FormSubmissionStatus,
  useFormSubmissionsQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Pagination } from "@repo/ui/pagination";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Typography } from "@repo/ui/typography";

import { FilterDrawer } from "@/components/base/FilterDrawer/FilterDrawer";
import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { useModuleForms } from "@/hooks/base/useModuleForms";
import { useSession } from "@/hooks/base/useSession";
import { useUrlSelectedId } from "@/hooks/base/useUrlSelectedId";
import { useUrlState } from "@/hooks/base/useUrlState";

import { SupportRequestCards } from "./SupportRequestCards";
import { SupportRequestPanel } from "./SupportRequestPanel";
import {
  SCHEDULE_MANAGE_MODULE_KEY,
  SUPPORT_LIST_KEY,
  SUPPORT_PAGE_SIZE,
  SUPPORT_REQUEST_FORM_KEY,
  SUPPORT_STATUS_ORDER,
  type SupportListFilters,
  type SupportRequestRow,
  supportListSchema,
} from "./support-requests";
import { useSupportRequestColumns } from "./useSupportRequestColumns";

const ALL = "all" as const;

type StatusFilter = typeof ALL | FormSubmissionStatus;

const EMPTY_FILTERS: Pick<SupportListFilters, "status"> = { status: null };

/**
 * 排班作業的「支援需求單」分頁(規格 14.10;Figma SC-31 274:32718):
 * 狀態篩選 + [+ 新增](開表單引擎的新增頁 SC-14)+ 列表;電腦版右側檢視 / 審核,
 * 平板 / 手機點一筆進詳情頁、手機列表改卡片、篩選收進抽屜(RW-01)。
 * 範圍(可見範圍 + 資料範圍規則)由 api 套;篩選放網址 `?support=`、選中的那一筆 `?detail=`。
 */
export const SupportRequestsTab = () => {
  const t = useTranslations("admin.schedule.supportRequests");
  const tStatus = useTranslations("admin.approval.submissionStatus");
  const navigate = useNavigate();
  const { session } = useSession();
  const isNarrow = useBreakpointDown("lg");
  const isMobile = useBreakpointDown("sm");
  const access = useFormModuleAccess(SCHEDULE_MANAGE_MODULE_KEY);
  const { creatableForms, isLoading: isFormsLoading } = useModuleForms(
    SCHEDULE_MANAGE_MODULE_KEY,
  );
  const canCreate =
    !isFormsLoading &&
    access.createRoute !== null &&
    creatableForms.some((form) => form.key === SUPPORT_REQUEST_FORM_KEY);
  const [filters, setFilters] = useUrlState(
    SUPPORT_LIST_KEY,
    supportListSchema,
  );
  const [selectedId, select] = useUrlSelectedId();

  const query = useFormSubmissionsQuery(session.client, {
    input: {
      moduleKey: SCHEDULE_MANAGE_MODULE_KEY,
      formKey: SUPPORT_REQUEST_FORM_KEY,
      keyword: "",
      page: filters.page,
      pageSize: SUPPORT_PAGE_SIZE,
      ...(filters.status !== null && { status: filters.status }),
    },
  });
  const rows = query.data?.formSubmissions.items ?? [];
  const totalCount = query.data?.formSubmissions.totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / SUPPORT_PAGE_SIZE));

  /** 電腦版在右側打開;平板 / 手機進詳情頁(右側放不下) */
  const open = (row: SupportRequestRow) => {
    if (!isNarrow) {
      select(row.id);
      return;
    }
    if (access.viewRoute !== null) {
      void navigate(`${access.viewRoute}/${row.id}`);
    }
  };

  // 欄位讀列表欄位配置(表格與手機卡片共用)
  const listColumns = useSupportRequestColumns(rows);
  const columns: TableColumn<SupportRequestRow>[] = listColumns.map(
    (column) => ({
      key: column.key,
      header: column.header,
      width: column.width,
      render: (row) => column.render(row),
    }),
  );

  const list = isMobile ? (
    <SupportRequestCards
      rows={rows}
      columns={listColumns}
      isLoading={query.isLoading}
      onOpen={open}
    />
  ) : (
    <Table
      aria-label={t("listAria")}
      columns={columns}
      rows={rows}
      getRowKey={(row) => row.id}
      isLoading={query.isLoading}
      emptyMessage={t("empty")}
      // 欄寬照列表欄位配置;放不下(右側開著檢視)時橫向捲動,不把欄位擠成折行
      minWidth={listColumns.reduce((sum, column) => sum + column.width, 0)}
      onRowClick={open}
    />
  );

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "flex-start", justifyContent: "space-between" }}
      >
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
                ...SUPPORT_STATUS_ORDER.map((status) => ({
                  value: status,
                  label: tStatus(status),
                })),
              ]}
              onChange={(next) => {
                change({
                  status: next === ALL ? null : next,
                });
              }}
              sx={{ minWidth: 200 }}
            />
          )}
        />
        {canCreate && (
          <Button
            onClick={() => {
              void navigate(
                `${access.createRoute ?? ""}/${SUPPORT_REQUEST_FORM_KEY}`,
              );
            }}
          >
            {t("create")}
          </Button>
        )}
      </Stack>

      <Stack direction="row" spacing={2} sx={{ flex: 1, minHeight: 0 }}>
        <Stack spacing={1} sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
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
        {!isNarrow && (
          <SupportRequestPanel id={selectedId} viewRoute={access.viewRoute} />
        )}
      </Stack>
    </Stack>
  );
};
