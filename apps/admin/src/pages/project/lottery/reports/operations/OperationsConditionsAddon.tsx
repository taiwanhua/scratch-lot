import { useMemo } from "react";
import { useTranslations } from "use-intl";

import {
  DEFAULT_TENANT_TIMEZONE,
  formatTemporal,
  localMonthText,
  parseLocalDate,
} from "@repo/domain/form";
import { useTenantOrgTreeQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";

import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { flattenOrgs, tenantTreeToOrgNodes } from "@/lib/base/org-tree";
import type { ReportConditionsAddonProps } from "@/lib/project/reports/report-registry";

import { useOperationsPeriods } from "./useOperationsPeriods";

interface PeriodRow {
  orgId: string;
  name: string;
  period: string;
  note: string;
}

/**
 * 營運報表條件卡片的專屬區塊(Figma RE-01 `94:17`、RE-03 `129:421`;規格 11.1):
 *
 * - 日:勾選框旁一律提醒「不要把多天的日報加總當成週報」(勾不勾都顯示);勾了「對齊日結」再逐店列出實際期間,
 *   當天沒有日結的店註記「本店 10/16 未日結,期間改用整天,小金庫和盤點未核對」
 * - 月:選的月份已關帳 → 說明數字固定、之後的更正列在「前期更正」
 */
export const OperationsConditionsAddon = ({
  input,
  periodKind,
  periodDate,
  extra,
}: ReportConditionsAddonProps) => {
  const t = useTranslations("admin.lotteryReports.operations");
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const { session } = useSession();
  const aligned = periodKind === "day" && extra.alignDailyClose === true;
  const wantsPeriods = aligned || periodKind === "month";
  const periods = useOperationsPeriods(wantsPeriods ? input : null);
  const orgTree = useTenantOrgTreeQuery(session.client, undefined, {
    enabled: aligned,
  });
  const nameOf = useMemo(
    () =>
      new Map(
        flattenOrgs(
          tenantTreeToOrgNodes(orgTree.data?.tenantOrgTree ?? [], false),
        ).map((org) => [org.id, org.name]),
      ),
    [orgTree.data],
  );
  const data = periods.data?.lotteryOperationsReportPeriods;
  const periodDay = parseLocalDate(periodDate);
  const month = periodDay === null ? "" : localMonthText(periodDay);
  const monthClosed =
    periodKind === "month" &&
    periodDay !== null &&
    data?.closedThrough != null &&
    month <= data.closedThrough;

  if (periodKind === "month") {
    return monthClosed ? (
      <Alert severity="info">
        {t("closing.closedHint", { month: periodDay.month })}
      </Alert>
    ) : null;
  }
  if (periodKind !== "day") {
    return null;
  }
  const warning = <Alert severity="warning">{t("alignment.warning")}</Alert>;
  if (!aligned) {
    return warning;
  }

  const time = (value: string) =>
    formatTemporal(value, { type: "monthDayTime", timezone });
  const rows: PeriodRow[] = (data?.stores ?? []).map((store) => ({
    orgId: store.orgId,
    name: nameOf.get(store.orgId) ?? store.orgId,
    period: `${time(store.from)} ~ ${time(store.to)}`,
    note:
      store.alignment === "fullDay"
        ? t("items.fullDayNote", {
            store: t("items.thisStore"),
            date: formatTemporal(store.from, { type: "monthDay", timezone }),
          })
        : "",
  }));
  const columns: TableColumn<PeriodRow>[] = [
    { key: "name", header: t("alignment.store"), render: (row) => row.name },
    {
      key: "period",
      header: t("alignment.period"),
      render: (row) => row.period,
    },
    { key: "note", header: t("alignment.note"), render: (row) => row.note },
  ];
  return (
    <Stack spacing={1.5}>
      {warning}
      {input !== null && (
        <Table
          aria-label={t("alignment.tableAria")}
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.orgId}
          emptyMessage={t("alignment.loading")}
          size="small"
        />
      )}
    </Stack>
  );
};
