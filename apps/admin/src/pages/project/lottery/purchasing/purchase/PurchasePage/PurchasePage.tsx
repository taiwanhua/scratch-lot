import { Fragment, type ReactNode, useMemo } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  type FormSubmissionStatus,
  type LotteryPurchaseProgressQuery,
  useFormSubmissionsQuery,
  useLotteryPurchaseProgressQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Pagination } from "@repo/ui/pagination";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { FilterDrawer } from "@/components/base/FilterDrawer/FilterDrawer";
import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { SubmissionStatusTag } from "@/components/base/workflow/SubmissionStatusTag";
import { useModuleForms } from "@/hooks/base/useModuleForms";
import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";
import { LIST_PAGE_SHELL_SX } from "@/lib/base/list-page-layout";

import {
  REQUISITION_STATUS_ORDER,
  requisitionListSchema,
} from "../../RequisitionsTab/requisitions";
import {
  type SubmissionColumn,
  type SubmissionRow,
  useFormListColumns,
} from "../../shared/useFormListColumns";
import {
  PURCHASE_FORM_KEY,
  PURCHASE_LIST_KEY,
  PURCHASE_MODULE_KEY,
  PURCHASE_PAGE_SIZE,
  formatMoney,
} from "../purchase-keys";

const ALL = "all" as const;

type StatusFilter = typeof ALL | FormSubmissionStatus;

/** 進貨單列表的篩選(狀態、頁碼;同叫貨單列表的形狀)。 */
const listSchema = requisitionListSchema;

/** 點收進度、結算兩欄的欄寬。 */
const PROGRESS_WIDTH = 100;
const SETTLEMENT_WIDTH = 130;

/** 卡片標題列放前幾欄。 */
const HEADING_COUNT = 2;

const joined = (
  row: SubmissionRow,
  columns: readonly SubmissionColumn[],
): ReactNode =>
  columns.map((column, index) => (
    <Fragment key={column.key}>
      {index > 0 && " · "}
      {column.render(row)}
    </Fragment>
  ));

type Progress = NonNullable<
  LotteryPurchaseProgressQuery["lotteryPurchaseProgress"]
>[number];

/** 結算欄:待付 / 待退 N(標色)、已結清;沒參與收付(草稿、駁回、作廢)= 「—」。 */
const SettlementCell = ({ item }: { item: Progress | undefined }) => {
  const t = useTranslations("admin.lotteryPurchasing.purchase.list");
  const kind = item?.inSettlement === true ? item.settlementKind : undefined;
  if (kind === undefined || item === undefined) {
    return <>—</>;
  }
  if (kind === null) {
    return <>{t("cleared")}</>;
  }
  return (
    <Tag
      tone="warning"
      label={t(`kinds.${kind}`, {
        amount: formatMoney(item.settlementAmount),
      })}
    />
  );
};

/**
 * 進貨單(`purchasing.purchase`,表單模組的列表頁;規格 8.2「列表欄位」;Figma PU-04 92:1625):
 * 欄位讀列表欄位配置(初值:單號、進貨分店、甲類、批購日、扣款金額)+ 點收進度(8 / 10)+ 結算
 * (待付 / 待退 N、已結清)+ 狀態;狀態篩選(含「草稿」)。右上 [+ 新增](有新增權限)。點一筆進詳情頁。
 * 手機列表改卡片、篩選收進抽屜(RW-01)。
 */
export const PurchasePage = () => {
  const t = useTranslations("admin.lotteryPurchasing.purchase.list");
  const tStatus = useTranslations("admin.approval.submissionStatus");
  const navigate = useNavigate();
  const { session } = useSession();
  const isMobile = useBreakpointDown("sm");
  const access = useFormModuleAccess(PURCHASE_MODULE_KEY);
  const { creatableForms } = useModuleForms(PURCHASE_MODULE_KEY);
  const [filters, setFilters] = useUrlState(PURCHASE_LIST_KEY, listSchema);
  const canCreate =
    access.createRoute !== null &&
    creatableForms.some((form) => form.key === PURCHASE_FORM_KEY);

  const query = useFormSubmissionsQuery(session.client, {
    input: {
      moduleKey: PURCHASE_MODULE_KEY,
      formKey: PURCHASE_FORM_KEY,
      keyword: "",
      page: filters.page,
      pageSize: PURCHASE_PAGE_SIZE,
      ...(filters.status !== null && { status: filters.status }),
    },
  });
  const rows = query.data?.formSubmissions.items ?? [];
  const totalCount = query.data?.formSubmissions.totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / PURCHASE_PAGE_SIZE));
  const ids = rows.map((row) => row.id);
  const progressQuery = useLotteryPurchaseProgressQuery(
    session.client,
    { purchaseIds: ids },
    { enabled: ids.length > 0 },
  );
  const progress = useMemo(
    () =>
      new Map(
        (progressQuery.data?.lotteryPurchaseProgress ?? []).map((item) => [
          item.purchaseId,
          item,
        ]),
      ),
    [progressQuery.data],
  );

  const listColumns = useFormListColumns(PURCHASE_MODULE_KEY, rows, {
    renderStatus: (row) => (
      <SubmissionStatusTag status={row.status} blocked={row.blocked} />
    ),
    extraColumns: [
      {
        key: "progress",
        header: t("progress"),
        width: PROGRESS_WIDTH,
        render: (row) => {
          const item = progress.get(row.id);
          return item === undefined || item.totalCount === 0
            ? "—"
            : `${String(item.receivedCount)} / ${String(item.totalCount)}`;
        },
      },
      {
        key: "settlement",
        header: t("settlement"),
        width: SETTLEMENT_WIDTH,
        render: (row) => <SettlementCell item={progress.get(row.id)} />,
      },
    ],
  });

  const open = (row: SubmissionRow) => {
    if (access.viewRoute !== null) {
      void navigate(`${access.viewRoute}/${row.id}`);
    }
  };

  const columns: TableColumn<SubmissionRow>[] = listColumns.map((column) => ({
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
      <Typography variant="body2" color="textSecondary">
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
              <Typography variant="body2" color="textSecondary" component="div">
                {joined(row, others.slice(HEADING_COUNT))}
              </Typography>
            </Stack>
          </Card>
        ))}
      </Stack>
    );
  }

  return (
    // 列表頁殼(STYLE-08):平板以上釘高、表格在卡片裡捲(表頭固定);手機寬不釘高,整頁捲
    <Card
      sx={[
        LIST_PAGE_SHELL_SX,
        {
          display: "flex",
          flexDirection: "column",
          px: { xs: 2, sm: 3 },
          py: 2,
        },
      ]}
    >
      <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="h6" component="h1" sx={{ flex: 1 }}>
            {t("title")}
          </Typography>
          {canCreate && (
            <Button
              onClick={() => {
                void navigate(
                  `${access.createRoute ?? ""}/${PURCHASE_FORM_KEY}`,
                );
              }}
            >
              {t("create")}
            </Button>
          )}
        </Stack>
        <FilterDrawer
          value={{ status: filters.status }}
          emptyValue={{ status: null }}
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
          <Typography variant="body2" color="textSecondary" sx={{ flex: 1 }}>
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
    </Card>
  );
};
