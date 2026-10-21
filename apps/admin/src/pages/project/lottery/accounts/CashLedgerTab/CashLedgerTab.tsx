import { useEffect, useMemo } from "react";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { DEFAULT_TENANT_TIMEZONE, formatTemporal } from "@repo/domain/form";
import { CASH_MOVEMENT_TYPES } from "@repo/domain/project/lottery-accounts";
import {
  type LotteryCashMovementFieldsFragment,
  useLotteryCashLedgerQuery,
  useLotteryCashMovementQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { DatePicker } from "@repo/ui/date-picker";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Typography } from "@repo/ui/typography";

import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { useMe } from "@/hooks/base/useMe";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useUrlState } from "@/hooks/base/useUrlState";
import {
  localDayInstantOf,
  localDayTextOf,
} from "@/lib/base/form-engine/local-day";

import { CASH_TABLE_MIN_WIDTH, moneyText } from "../accounts-config";
import { nextDayText } from "./next-day";

type Movement = LotteryCashMovementFieldsFragment;

const textSchema = z.string().default("");

/** 即時現金帳的篩選放同一個 key(REACT-14):分店、日期、類型、收銀點;空字串 = 預設 / 不篩。 */
const cashSchema = z
  .object({
    org: z.string().default(""),
    date: z.string().default(""),
    type: z.string().default(""),
    cashPoint: z.string().default(""),
  })
  .default({ org: "", date: "", type: "", cashPoint: "" });

/** 全部(不篩)的選項值。 */
const ALL = "";

/**
 * 即時現金帳分頁(只能查看;Figma AC-04 93:834,規格 10.2):
 * 分店選擇器(可見範圍)→ 上方小金庫與各收銀點抽屜(開著的班)目前的應有金額(只從流水與班次算)→
 * 流水清單(類型、收銀點、日期篩選)。網址 `?movementId=`(58mm 流水類單據的 QR)帶到那一筆的分店與日期並標亮。
 */
export const CashLedgerTab = () => {
  const t = useTranslations("admin.lotteryAccounts");
  const { session } = useSession();
  const me = useMe();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const [filters, setFilters] = useUrlState("cash", cashSchema);
  const [movementId] = useUrlState("movementId", textSchema);
  const { org: orgParam, date: dateParam, type, cashPoint } = filters;
  const patch = (next: Partial<typeof filters>) => {
    setFilters((current) => ({ ...current, ...next }));
  };

  const target = useLotteryCashMovementQuery(
    session.client,
    { id: movementId },
    { enabled: movementId !== "", retry: false },
  );
  const targetItem = target.data?.lotteryCashMovement.item ?? null;
  // 掃 QR 進來:分店與日期帶到那一筆
  useEffect(() => {
    if (targetItem !== null) {
      setFilters((current) => ({
        ...current,
        org: targetItem.org.id,
        date: localDayTextOf(targetItem.occurredAt, timezone) ?? "",
      }));
    }
  }, [targetItem, setFilters, timezone]);

  const orgId = orgParam === "" ? (me.data?.me.currentOrg?.id ?? "") : orgParam;
  const date =
    dateParam === "" ? (localDayTextOf(new Date(), timezone) ?? "") : dateParam;
  const from = localDayInstantOf(date, timezone);
  const to = localDayInstantOf(nextDayText(date), timezone);
  const query = useLotteryCashLedgerQuery(
    session.client,
    {
      input: {
        orgId,
        from,
        to,
        ...(type === ALL ? {} : { type }),
        ...(cashPoint === ALL ? {} : { cashPointId: cashPoint }),
      },
    },
    { enabled: orgId !== "", retry: false },
  );
  const ledger = query.data?.lotteryCashLedger;
  const rows = useMemo(() => ledger?.items ?? [], [ledger]);

  useEffect(() => {
    if (movementId !== "" && rows.some((row) => row.id === movementId)) {
      document
        .querySelector(`[data-movement="${CSS.escape(movementId)}"]`)
        ?.scrollIntoView({ block: "center" });
    }
  }, [movementId, rows]);

  const cashPointOptions = [
    { value: ALL, label: t("cash.filters.all") },
    ...[
      ...new Map(
        rows.flatMap((row) =>
          row.cashPoint
            ? [[row.cashPoint.id, row.cashPoint.name] as const]
            : [],
        ),
      ),
    ].map(([value, label]) => ({ value, label })),
  ];
  const typeOptions: { value: string; label: string }[] = [
    { value: ALL, label: t("cash.filters.all") },
    ...CASH_MOVEMENT_TYPES.map((value) => ({
      value,
      label: t(`movementTypes.${value}`),
    })),
  ];
  const placeLabel = (place: string) => t(`places.${place}`);
  const typeLabel = (row: Movement) => {
    const label = t(`movementTypes.${row.type}`);
    const reasonText =
      row.type === "withdraw" && row.reason
        ? t(`withdrawReasons.${row.reason}`)
        : null;
    const reason = reasonText === null ? "" : `(${reasonText})`;
    return `${label}${reason}${row.reversalOf ? t("cash.reversal") : ""}`;
  };

  const columns: TableColumn<Movement>[] = [
    {
      key: "occurredAt",
      header: t("cash.columns.occurredAt"),
      render: (row) => (
        <Typography
          variant="body2"
          data-movement={row.id}
          sx={
            row.id === movementId
              ? { fontWeight: 700, color: "primary.main" }
              : undefined
          }
        >
          {formatTemporal(row.occurredAt, { type: "datetime", timezone }).slice(
            11,
          )}
        </Typography>
      ),
    },
    {
      key: "type",
      header: t("cash.columns.type"),
      render: typeLabel,
    },
    {
      key: "route",
      header: t("cash.columns.route"),
      render: (row) =>
        row.payee
          ? t("cash.routeWithPayee", {
              from: placeLabel(row.from),
              to: placeLabel(row.to),
              payee: row.payee,
            })
          : t("cash.route", {
              from: placeLabel(row.from),
              to: placeLabel(row.to),
            }),
    },
    {
      key: "cashPoint",
      header: t("cash.columns.cashPoint"),
      render: (row) => row.cashPoint?.name ?? "—",
    },
    {
      key: "amount",
      header: t("cash.columns.amount"),
      align: "right",
      render: (row) => moneyText(row.amount),
    },
    {
      key: "document",
      header: t("cash.columns.document"),
      render: (row) => row.note ?? "—",
    },
  ];

  const baselineAt = ledger?.vault.baselineAt ?? null;
  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <Box sx={{ maxWidth: 240 }}>
        <OrgTreeSelect
          scope="visible"
          label={t("cash.org")}
          value={orgId === "" ? [] : [orgId]}
          size="small"
          fullWidth
          onChange={(ids) => {
            patch({ org: ids.at(0) ?? "", cashPoint: ALL });
          }}
        />
      </Box>
      {query.isError ? (
        <Alert severity="error">{t("cash.loadFailed")}</Alert>
      ) : null}
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, 1fr)",
            md: "repeat(4, 1fr)",
          },
        }}
      >
        <Card variant="outlined" sx={{ p: 2 }}>
          <Typography variant="caption" color="text.secondary">
            {t("cash.vault")}
          </Typography>
          <Typography variant="h6">
            {moneyText(ledger?.vault.amount ?? 0)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {baselineAt === null
              ? t("cash.vaultFromZero")
              : t("cash.vaultBaseline", {
                  date: formatTemporal(baselineAt, {
                    type: "monthDay",
                    timezone,
                  }),
                })}
          </Typography>
        </Card>
        {(ledger?.drawers ?? []).map((drawer) => (
          <Card key={drawer.shiftId} variant="outlined" sx={{ p: 2 }}>
            <Typography variant="caption" color="text.secondary">
              {t("cash.drawer", { name: drawer.cashPoint.name })}
            </Typography>
            <Typography variant="h6">{moneyText(drawer.amount)}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t("cash.drawerOwner", { name: drawer.openedBy.name })}
            </Typography>
          </Card>
        ))}
      </Box>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ alignItems: { sm: "center" } }}
      >
        <SelectField
          label={t("cash.filters.type")}
          value={type}
          size="small"
          displayEmpty
          options={typeOptions}
          onChange={(value: string) => {
            patch({ type: value });
          }}
          sx={{ minWidth: 160 }}
        />
        <SelectField
          label={t("cash.filters.cashPoint")}
          value={cashPoint}
          size="small"
          displayEmpty
          options={cashPointOptions}
          onChange={(value: string) => {
            patch({ cashPoint: value });
          }}
          sx={{ minWidth: 160 }}
        />
        <Box sx={{ maxWidth: 200 }}>
          <DatePicker
            label={t("cash.filters.date")}
            value={date}
            size="small"
            onChange={(value) => {
              patch({ date: value ?? "" });
            }}
          />
        </Box>
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Table
          aria-label={t("cash.listAria")}
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          isLoading={query.isLoading}
          emptyMessage={orgId === "" ? t("cash.pickOrg") : t("cash.empty")}
          minWidth={CASH_TABLE_MIN_WIDTH}
        />
      </Box>
    </Stack>
  );
};
