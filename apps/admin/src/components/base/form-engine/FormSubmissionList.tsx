import { type ReactNode, useMemo } from "react";
import { useTranslations } from "use-intl";

import {
  DEFAULT_LIST_BUILTIN_COLUMNS,
  type ListBuiltinColumns,
} from "@repo/domain/form";
import {
  type FormSubmissionFieldsFragment,
  type FormSubmissionStatus,
  ModuleListColumnKind,
  useFormSubmissionsQuery,
  useModuleListColumnsQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { DataTable, type DataTableColumn } from "@repo/ui/data-table";
import { Pagination } from "@repo/ui/pagination";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useModuleForms } from "@/hooks/base/useModuleForms";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useVersionDefinitions } from "@/hooks/base/useVersionDefinitions";
import {
  type ListColumnSpec,
  columnIdOf,
  fieldColumnLabelOf,
  resolveListCell,
  sortedColumns,
} from "@/lib/base/form-engine/list-columns";
import { summaryDateTypeOf } from "@/lib/base/form-engine/tab-label";

import { SubmissionStatusTag } from "../workflow/SubmissionStatusTag";
import { renderValue } from "./render-value";

export type FormSubmissionRow = FormSubmissionFieldsFragment;

export interface FormSubmissionListFilters {
  keyword: string;
  formKey: string | null;
  status: FormSubmissionStatus | null;
  page: number;
}

export interface FormSubmissionListProps {
  moduleKey: string;
  filters: FormSubmissionListFilters;
  /** 不列這些表單的提交(api 查詢條件,總筆數照排除後算);不給 = 不排除 */
  excludeFormKeys?: readonly string[];
  onPageChange: (page: number) => void;
  /** 自訂欄;不給 = 模組的列表欄位配置(沒設定過 = 預設的標題 + 日期) */
  columns?: readonly ListColumnSpec[];
  /** 內建欄(表單 / 狀態 / 建立者)的開關;不給 = 模組的列表欄位配置(自訂欄時 = 全開) */
  builtin?: ListBuiltinColumns;
  pageSize?: number;
  /** 列尾的操作(檢視 / 編輯 / 刪除,由組裝頁決定) */
  renderActions?: (row: FormSubmissionRow) => ReactNode;
  "aria-label"?: string;
}

const DEFAULT_PAGE_SIZE = 20;

/**
 * 提交列表(`<FormSubmissionList moduleKey columns? …>`,`DataTable` + REACT-13 `render(ctx)`)。
 *
 * 欄位來自列表欄位配置(摘要槽或表單欄位);表單欄位的一格依**那一筆綁的版本**判斷:
 * 配置引用的欄位在那一版不存在(或是別張表單的欄位)→ 顯示「—」。表單欄位的表頭讀該表單**目前版本**的定義
 * (沒有資料列也顯示欄位名;多張表單取第一個有該欄位的),再退到這一頁資料列的版本、最後才是 key。
 * 內建欄「表單 / 狀態 / 建立者」依配置的開關顯示。範圍(可見範圍 + 資料範圍規則)由 api 套,
 * 別人的草稿不列;搜尋只比對摘要標題。
 */
export const FormSubmissionList = ({
  moduleKey,
  filters,
  excludeFormKeys,
  onPageChange,
  columns,
  builtin,
  pageSize = DEFAULT_PAGE_SIZE,
  renderActions,
  "aria-label": ariaLabel,
}: FormSubmissionListProps) => {
  const t = useTranslations("admin.formEngine.list");
  const tValue = useTranslations("admin.formEngine.renderer");
  const temporalText = useTemporalText();
  const tenantTimezone = useTenantTimezone();
  const { session } = useSession();

  const configured = useModuleListColumnsQuery(
    session.client,
    { moduleKey },
    { enabled: columns === undefined },
  );
  const specs = sortedColumns(
    columns ?? configured.data?.moduleListColumns.columns ?? [],
  );
  const shown =
    builtin ??
    (columns === undefined
      ? configured.data?.moduleListColumns.builtin
      : undefined) ??
    DEFAULT_LIST_BUILTIN_COLUMNS;
  // 表頭:模組內各表單目前版本的定義(沒有資料列也要有欄位名)
  const { forms } = useModuleForms(moduleKey);
  // 以 useMemo 保持身分穩定:`useVersionDefinitions` 以它為 memo 依賴
  const currentRefs = useMemo(
    () =>
      forms.map((form) => ({
        formKey: form.key,
        version: form.currentVersion,
      })),
    [forms],
  );
  const currentDefinitionOf = useVersionDefinitions(currentRefs);

  const query = useFormSubmissionsQuery(session.client, {
    input: {
      moduleKey,
      keyword: filters.keyword,
      page: filters.page,
      pageSize,
      ...(filters.formKey !== null && { formKey: filters.formKey }),
      ...(filters.status !== null && { status: filters.status }),
      ...(excludeFormKeys !== undefined &&
        excludeFormKeys.length > 0 && {
          excludeFormKeys: [...excludeFormKeys],
        }),
    },
  });
  const rows = query.data?.formSubmissions.items ?? [];
  const totalCount = query.data?.formSubmissions.totalCount ?? 0;
  const definitionOf = useVersionDefinitions(rows);
  /** 表單欄位欄的表頭:目前版本 → 這一頁資料列綁的版本 → 欄位 key。 */
  const fieldLabelOf = (spec: ListColumnSpec): string =>
    fieldColumnLabelOf(
      spec,
      currentRefs.map((ref) => ({
        formKey: ref.formKey,
        fields: currentDefinitionOf(ref.formKey, ref.version)?.fields,
      })),
    ) ??
    fieldColumnLabelOf(
      spec,
      rows.map((row) => ({
        formKey: row.formKey,
        fields: definitionOf(row.formKey, row.version)?.fields,
      })),
    ) ??
    spec.key;
  /**
   * 摘要槽的一格:「日期」是時點(ISO),以讀者的租戶時區格式化 —— 對到日期欄印 `YYYY-MM-DD`,
   * 對到日期時間欄或沒對(= 送出時間)印到分鐘;其他槽照字。
   */
  const slotText = (
    key: string,
    value: string,
    row: FormSubmissionRow,
    timezone: string | undefined,
  ): string => {
    if (key !== "date") {
      return value;
    }
    return temporalText(
      value,
      summaryDateTypeOf(definitionOf(row.formKey, row.version)),
      timezone,
    );
  };
  const valueText = {
    empty: tValue("empty"),
    yes: tValue("yes"),
    no: tValue("no"),
    unavailable: tValue("sourceUnavailable"),
  };

  const configuredColumns: DataTableColumn<FormSubmissionRow>[] = specs.map(
    (spec) => ({
      key: columnIdOf(spec),
      header:
        spec.kind === ModuleListColumnKind.Slot
          ? t(`slots.${spec.key}`)
          : fieldLabelOf(spec),
      width: spec.width,
      render: ({ row }) => {
        const cell = resolveListCell(
          spec,
          row,
          (formKey, version) => definitionOf(formKey, version)?.fields,
        );
        // 引用的欄位在那一筆的版本不存在(或是別張表單的欄位)→「—」
        let node: ReactNode = valueText.empty;
        // 一律用讀者的租戶時區(修訂的 ctx 時區不決定顯示)
        const timezone = tenantTimezone ?? undefined;
        if (cell.kind === "slot") {
          node =
            cell.value === null
              ? valueText.empty
              : slotText(spec.key, cell.value, row, timezone);
        } else if (cell.kind === "field") {
          node = renderValue({
            field: cell.field,
            value: cell.value,
            display:
              row.displayValues.find((entry) => entry.fieldKey === spec.key)
                ?.items ?? [],
            text: valueText,
            ...(timezone !== undefined && { timezone }),
          });
        }
        return node;
      },
    }),
  );

  const builtinColumns: DataTableColumn<FormSubmissionRow>[] = [
    {
      key: "form",
      header: t("form"),
      width: 160,
      render: ({ row }) => row.formName ?? row.formKey,
    },
    {
      key: "status",
      header: t("status"),
      width: 140,
      render: ({ row }) => (
        <SubmissionStatusTag status={row.status} blocked={row.blocked} />
      ),
    },
    {
      key: "createdBy",
      header: t("createdBy"),
      width: 140,
      render: ({ row }) => row.createdBy?.name ?? valueText.empty,
    },
  ];

  const tableColumns: DataTableColumn<FormSubmissionRow>[] = [
    ...configuredColumns,
    ...builtinColumns.filter(
      (column) => shown[column.key as keyof ListBuiltinColumns],
    ),
    ...(renderActions === undefined
      ? []
      : [
          {
            key: "actions",
            header: t("actions"),
            width: 180,
            pinned: "right" as const,
            render: ({ row }: { row: FormSubmissionRow }) => renderActions(row),
          },
        ]),
  ];

  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <Stack sx={{ flex: 1, minHeight: 0 }}>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DataTable
          columns={tableColumns}
          rows={rows}
          getRowKey={(row) => row.id}
          isLoading={query.isLoading}
          emptyMessage={t("empty")}
          size="small"
          aria-label={ariaLabel ?? t("tableAria")}
        />
      </Box>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", px: 3, py: 1.5 }}
      >
        <Typography variant="body2" color="textSecondary" sx={{ flex: 1 }}>
          {t("total", { total: totalCount })}
        </Typography>
        <Pagination
          count={pageCount}
          page={filters.page}
          onChange={(_event, next) => {
            onPageChange(next);
          }}
        />
      </Stack>
    </Stack>
  );
};
