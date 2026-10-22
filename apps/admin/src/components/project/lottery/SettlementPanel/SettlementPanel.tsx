import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE, formatTemporal } from "@repo/domain/form";
import {
  type LotterySettlementFieldsFragment,
  useLotterySettlementQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";

import { ReverseSettlementDialog } from "./ReverseSettlementDialog";
import { SettlementDialog } from "./SettlementDialog";
import { buttonLabelKey, moneyText } from "./settlement-text";
import { useSettlementReceipt } from "./useSettlementReceipt";

type Settlement = LotterySettlementFieldsFragment;
type SettlementRecord = Settlement["records"][number];

export interface SettlementPanelProps {
  /** 單據的模組 key(例 `purchasing.purchase`) */
  moduleKey: string;
  /** 單據(提交)id */
  refId: string;
}

/** 歷程的一列:登記過的一筆,或「尚未登記」的那一邊。 */
type HistoryRow =
  | { kind: "record"; record: SettlementRecord }
  | {
      kind: "pending";
      side: Settlement["sides"][number];
      button: "out" | "in";
    };

/** 金額列(調貨單:調貨金額、收貨店已付、出貨店已收、待收;進貨單:應付、已付、差額)。 */
const AmountRow = ({ settlement }: { settlement: Settlement }) => {
  const t = useTranslations("admin.lotteryAccounts.settlement");
  const payer = settlement.sides.find((side) => side.role === "payer");
  const payee = settlement.sides.find((side) => side.role === "payee");
  const items: { label: string; value: string; tone?: "warning" }[] =
    payee === undefined
      ? [
          { label: t("payable"), value: moneyText(settlement.payable) },
          { label: t("paid"), value: moneyText(payer?.net ?? 0) },
          diffItem(settlement.payable - (payer?.net ?? 0), t),
        ]
      : [
          { label: t("transferAmount"), value: moneyText(settlement.payable) },
          {
            label: `${payer?.label ?? ""}${t("paid")}`,
            value: moneyText(payer?.net ?? 0),
          },
          {
            label: `${payee.label}${t("received")}`,
            value: moneyText(payee.net),
          },
          diffItem(settlement.payable - payee.net, t),
        ];
  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 3 }}>
      {items.map((item) => (
        <Stack key={item.label} spacing={0.25}>
          <Typography variant="caption" color="textSecondary">
            {item.label}
          </Typography>
          <Typography
            variant="h6"
            color={item.tone === "warning" ? "warning" : "textPrimary"}
          >
            {item.value}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
};

const diffItem = (
  diff: number,
  t: (key: string) => string,
): { label: string; value: string; tone?: "warning" } =>
  diff === 0
    ? { label: t("diff"), value: t("settled") }
    : { label: t("diff"), value: moneyText(diff), tone: "warning" };

const roleOf = (side: Settlement["sides"][number]): "payer" | "payee" =>
  side.role === "payee" ? "payee" : "payer";

/** 付款方式的字 key。 */
const methodKey = (method: string): string =>
  method === "cash" ? "settlement.methods.cash" : "settlement.methods.bank";

const rowKeyOf = (row: HistoryRow): string =>
  row.kind === "record" ? row.record.id : `${row.side.side}-${row.button}`;

/**
 * 收付面板(規格 9;Figma PU-07 叫貨與進貨 127:2714 / 127:26961 / 127:27369):進貨、調貨的檢視頁共用,
 * 待結清款項頁的按鈕開同一個付款視窗。
 *
 * - 上方:每一邊能按的按鈕(先填 > 0 且有那一邊的權限)、金額列;收貨店已付 > 出貨店已收時提示「N 待出貨店入帳」
 * - 下方:收付歷程(哪一店記的、類型、方式、金額、經手 / 收款人、登記人);還沒登記的一邊顯示「尚未登記」與按鈕
 * - 不用「對方」這類看情境才懂的字:一律寫店名的角色(總部、收貨店、出貨店)
 * - 收貨店付現金之後自動印調貨付款收據(規格第 12 章;`useSettlementReceipt`)
 */
export const SettlementPanel = ({ moduleKey, refId }: SettlementPanelProps) => {
  const t = useTranslations("admin.lotteryAccounts");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const query = useLotterySettlementQuery(session.client, { moduleKey, refId });
  const settlement = query.data?.lotterySettlement.item ?? null;
  const [paying, setPaying] = useState<{
    side: string;
    button: "out" | "in";
  } | null>(null);
  const [reversing, setReversing] = useState<SettlementRecord | null>(null);
  const receipt = useSettlementReceipt();

  if (settlement === null) {
    return null;
  }
  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: useLotterySettlementQuery.getKey({ moduleKey, refId }),
    });
  };
  const usable = settlement.sides.flatMap((side) =>
    side.buttons
      .filter((button) => button.canUse)
      .map((button) => ({
        side,
        button: button.button === "in" ? ("in" as const) : ("out" as const),
      })),
  );
  const sideLabel = (key: string) =>
    settlement.sides.find((side) => side.side === key)?.label ?? key;
  const typeLabel = (record: SettlementRecord) =>
    record.method === "cash"
      ? t(`movementTypes.${record.type}`)
      : t(`transactionTypes.${record.type}`);
  const recordTypeText = (record: SettlementRecord) => {
    const suffix = record.reversalOf === null ? "" : t("cash.reversal");
    return typeLabel(record) + suffix;
  };
  const timeText = (record: SettlementRecord) =>
    formatTemporal(record.occurredAt, { type: "monthDayTime", timezone });
  const pendingText = (row: Extract<HistoryRow, { kind: "pending" }>) =>
    t(buttonLabelKey(roleOf(row.side), row.button));
  const rowTitle = (row: HistoryRow) => {
    if (row.kind === "pending") {
      return [row.side.label, pendingText(row)].join(" · ");
    }
    const { record } = row;
    return [
      sideLabel(record.side),
      recordTypeText(record),
      `${t(methodKey(record.method))} ${moneyText(record.amount)}`,
    ].join(" · ");
  };
  const rowSubtitle = (row: HistoryRow) =>
    row.kind === "pending"
      ? t("settlement.notRecorded")
      : [
          timeText(row.record),
          row.record.accountLabel ?? row.record.handler,
          row.record.createdBy?.name,
        ]
          .filter(Boolean)
          .join(" · ");

  const rows: HistoryRow[] = [
    ...settlement.records.map((record) => ({
      kind: "record" as const,
      record,
    })),
    ...usable
      .filter(
        ({ side }) =>
          !settlement.records.some((record) => record.side === side.side),
      )
      .map(({ side, button }) => ({ kind: "pending" as const, side, button })),
  ];
  const rowAction = (row: HistoryRow) => {
    if (row.kind === "pending") {
      return (
        <Button
          variant="outlined"
          size="small"
          onClick={() => {
            setPaying({ side: row.side.side, button: row.button });
          }}
        >
          {t(buttonLabelKey(roleOf(row.side), row.button))}
        </Button>
      );
    }
    if (row.record.reversedById !== null) {
      return (
        <Typography variant="caption" color="textSecondary">
          {t("settlement.reversed")}
        </Typography>
      );
    }
    return row.record.canReverse ? (
      <Button
        variant="text"
        size="small"
        color="error"
        onClick={() => {
          setReversing(row.record);
        }}
      >
        {t("settlement.reverse")}
      </Button>
    ) : null;
  };

  const columns: TableColumn<HistoryRow>[] = [
    {
      key: "occurredAt",
      header: t("settlement.historyColumns.occurredAt"),
      render: (row) => (row.kind === "record" ? timeText(row.record) : "—"),
    },
    {
      key: "side",
      header: t("settlement.historyColumns.side"),
      render: (row) =>
        row.kind === "record" ? sideLabel(row.record.side) : row.side.label,
    },
    {
      key: "type",
      header: t("settlement.historyColumns.type"),
      render: (row) =>
        row.kind === "record" ? recordTypeText(row.record) : pendingText(row),
    },
    {
      key: "method",
      header: t("settlement.historyColumns.method"),
      render: (row) =>
        row.kind === "record" ? t(methodKey(row.record.method)) : "—",
    },
    {
      key: "amount",
      header: t("settlement.historyColumns.amount"),
      align: "right",
      render: (row) =>
        row.kind === "record" ? moneyText(row.record.amount) : "—",
    },
    {
      key: "handler",
      header: t("settlement.historyColumns.handler"),
      render: (row) =>
        row.kind === "record"
          ? (row.record.accountLabel ?? row.record.handler ?? "—")
          : t("settlement.notRecorded"),
    },
    {
      key: "createdBy",
      header: t("settlement.historyColumns.createdBy"),
      render: (row) =>
        row.kind === "record" ? (row.record.createdBy?.name ?? "—") : "—",
    },
    { key: "actions", header: "", width: 120, render: rowAction },
  ];

  return (
    <Card sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
      <Stack spacing={2}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", flexWrap: "wrap" }}
        >
          <Typography variant="h6" sx={{ flex: 1 }}>
            {t("settlement.title")}
          </Typography>
          {usable.map(({ side, button }) => (
            <Button
              key={`${side.side}-${button}`}
              variant="outlined"
              size="small"
              onClick={() => {
                setPaying({ side: side.side, button });
              }}
            >
              {t(buttonLabelKey(roleOf(side), button))}
            </Button>
          ))}
        </Stack>
        <AmountRow settlement={settlement} />
        {settlement.pendingPayee > 0 && (
          <Alert severity="warning">
            {t("settlement.pendingPayee", {
              amount: moneyText(settlement.pendingPayee),
            })}
          </Alert>
        )}
        <Typography variant="subtitle2">{t("settlement.history")}</Typography>
        {isMobile ? (
          <Stack spacing={1.5}>
            {rows.map((row) => (
              <Stack
                key={rowKeyOf(row)}
                direction="row"
                spacing={1}
                sx={{
                  alignItems: "center",
                  borderTop: 1,
                  borderColor: "divider",
                  pt: 1.5,
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2">{rowTitle(row)}</Typography>
                  <Typography variant="caption" color="textSecondary">
                    {rowSubtitle(row)}
                  </Typography>
                </Box>
                {rowAction(row)}
              </Stack>
            ))}
          </Stack>
        ) : (
          <Table
            aria-label={t("settlement.historyAria")}
            columns={columns}
            rows={rows}
            getRowKey={rowKeyOf}
            size="small"
          />
        )}
      </Stack>
      {paying !== null && (
        <SettlementDialog
          settlement={settlement}
          side={paying.side}
          button={paying.button}
          onClose={() => {
            setPaying(null);
          }}
          onDone={refresh}
          onRecorded={receipt.onRecorded}
        />
      )}
      {reversing !== null && (
        <ReverseSettlementDialog
          record={reversing}
          typeLabel={typeLabel(reversing)}
          onClose={() => {
            setReversing(null);
          }}
          onDone={refresh}
        />
      )}
      {receipt.host}
    </Card>
  );
};
