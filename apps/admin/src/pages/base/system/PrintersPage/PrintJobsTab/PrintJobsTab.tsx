import { useMemo } from "react";
import { useTranslations } from "use-intl";

import { PRINT_TEST_PAGE_DOCUMENT_TYPE } from "@repo/domain/printing";
import {
  type PrintJobFieldsFragment,
  PrintJobStatus,
  usePrintJobsQuery,
  usePrintersQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { DataTable, type DataTableColumn } from "@repo/ui/data-table";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";

import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useUrlState } from "@/hooks/base/useUrlState";

import { PrintersPager } from "../PrintersPager";
import {
  PRINTERS_LIST_KEY,
  PRINTERS_PAGE_SIZE,
  printJobsListSchema,
} from "../printers-list";
import { PrintJobStatusTag } from "./PrintJobStatusTag";

const ALL = "";

const STATUSES: readonly PrintJobStatus[] = [
  PrintJobStatus.Pending,
  PrintJobStatus.Sent,
  PrintJobStatus.Printed,
  PrintJobStatus.Failed,
];

/** 印表機篩選的選項一次取的筆數(api 上限 100)。 */
const PRINTER_OPTIONS_INPUT = { pageSize: 100 } as const;

/**
 * 列印紀錄分頁:新到舊;篩選印表機 / 結果。
 * 時間、單據、印表機、次數(補印標「補印」)、結果(失敗附原因)、操作者。
 */
export const PrintJobsTab = () => {
  const t = useTranslations("admin.printers.jobs");
  const tStatus = useTranslations("admin.printers.jobStatus");
  const { session } = useSession();
  const temporalText = useTemporalText();
  const [filters, setFilters] = useUrlState(
    PRINTERS_LIST_KEY,
    printJobsListSchema,
  );
  const printers = usePrintersQuery(session.client, {
    input: PRINTER_OPTIONS_INPUT,
  });
  const list = usePrintJobsQuery(session.client, {
    input: {
      printerId: filters.printer,
      status: filters.status,
      page: filters.page,
      pageSize: PRINTERS_PAGE_SIZE,
    },
  });
  const printerNames = useMemo(
    () =>
      new Map(
        (printers.data?.printers.items ?? []).map((printer) => [
          printer.id,
          printer.name,
        ]),
      ),
    [printers.data],
  );

  const documentOf = (row: PrintJobFieldsFragment): string => {
    if (row.documentType === PRINT_TEST_PAGE_DOCUMENT_TYPE) {
      return t("testPage");
    }
    return row.documentName ?? `${row.documentType} #${row.refId}`;
  };

  const columns: DataTableColumn<PrintJobFieldsFragment>[] = [
    {
      key: "createdAt",
      header: t("createdAt"),
      width: 160,
      isEmphasized: true,
      accessor: (row) => temporalText(row.createdAt, "datetime"),
    },
    {
      key: "document",
      header: t("document"),
      width: 220,
      accessor: (row) => documentOf(row),
    },
    {
      key: "printer",
      header: t("printer"),
      width: 160,
      // 印表機清單晚到時要重畫:用 render(accessor 的值會被表格快取)
      render: ({ row }) => printerNames.get(row.printerId) ?? "—",
    },
    {
      key: "printNo",
      header: t("printNo"),
      width: 130,
      accessor: (row) =>
        row.isReprint
          ? t("reprintNo", { no: row.printNo })
          : t("printNoValue", { no: row.printNo }),
    },
    {
      key: "status",
      header: t("status"),
      width: 170,
      render: ({ row }) => <PrintJobStatusTag job={row} />,
    },
    {
      key: "requestedBy",
      header: t("requestedBy"),
      width: 140,
      accessor: (row) => row.requestedBy?.name ?? "—",
    },
  ];

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "center", flexWrap: "wrap" }}
      >
        <SelectField
          label={t("printerFilter")}
          value={filters.printer ?? ALL}
          displayEmpty
          size="small"
          sx={{ width: 180 }}
          options={[
            { value: ALL, label: t("allPrinters") },
            ...(printers.data?.printers.items ?? []).map((printer) => ({
              value: printer.id,
              label: printer.name,
            })),
          ]}
          onChange={(next) => {
            setFilters((current) => ({
              ...current,
              printer: next === ALL ? null : next,
              page: 1,
            }));
          }}
        />
        <SelectField<PrintJobStatus | typeof ALL>
          label={t("statusFilter")}
          value={filters.status ?? ALL}
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
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DataTable
          columns={columns}
          rows={list.data?.printJobs.items ?? []}
          getRowKey={(row) => row.id}
          isLoading={list.isLoading}
          emptyMessage={t("empty")}
          size="small"
          aria-label={t("tableAria")}
        />
      </Box>
      <PrintersPager
        totalCount={list.data?.printJobs.totalCount ?? 0}
        page={filters.page}
        onPageChange={(next) => {
          setFilters((current) => ({ ...current, page: next }));
        }}
      />
    </Stack>
  );
};
