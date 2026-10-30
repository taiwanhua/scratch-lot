import { useTranslations } from "use-intl";

import {
  type LotteryReportRangeInput,
  useLotteryShiftCheckoutsReportCashPointsQuery,
  useTenantOrgTreeQuery,
} from "@repo/graphql";
import { SelectField } from "@repo/ui/select-field";

import { useSession } from "@/hooks/base/useSession";
import { flattenOrgs, tenantTreeToOrgNodes } from "@/lib/base/org-tree";
import type { ReportCustomFieldProps } from "@/lib/base/reports/report-registry";

/**
 * 班次結帳歷史報表的「收銀點」條件(Figma RE-05 `129:1512`):選的分店的收銀點 + 「全部」(值 = 空字串)。
 * 選項依分店查(`lotteryShiftCheckoutsReportCashPoints`);還沒選分店只有「全部」。選了多家店時選項加分店名
 * (名稱取分店選擇器同一份租戶組織樹)。
 */
export const CashPointConditionField = ({
  label,
  value,
  onChange,
  input,
}: ReportCustomFieldProps) => {
  const t = useTranslations("admin.lotteryReports.shiftCheckouts");
  const { session } = useSession();
  const range: LotteryReportRangeInput | null =
    input === null
      ? null
      : {
          periodKind: input.periodKind,
          from: input.from,
          to: input.to,
          orgIds: input.orgIds,
        };
  const points = useLotteryShiftCheckoutsReportCashPointsQuery(
    session.client,
    { input: range ?? { periodKind: "", from: "", to: "", orgIds: [] } },
    { enabled: range !== null },
  );
  const options = points.data?.lotteryShiftCheckoutsReportCashPoints ?? [];
  const multiStore = new Set(options.map((point) => point.orgId)).size > 1;
  const orgTree = useTenantOrgTreeQuery(session.client, undefined, {
    enabled: multiStore,
  });
  const storeName = new Map(
    flattenOrgs(
      tenantTreeToOrgNodes(orgTree.data?.tenantOrgTree ?? [], false),
    ).map((org) => [org.id, org.name]),
  );
  return (
    <SelectField
      label={label}
      size="small"
      value={options.some((point) => point.id === value) ? value : ""}
      onChange={onChange}
      options={[
        { value: "", label: t("allCashPoints") },
        ...options.map((point) => ({
          value: point.id,
          label: multiStore
            ? t("cashPointOfStore", {
                name: point.name,
                store: storeName.get(point.orgId) ?? "",
              })
            : point.name,
        })),
      ]}
    />
  );
};
