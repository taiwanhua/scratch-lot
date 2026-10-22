import { useTranslations } from "use-intl";

import {
  type LotteryReportRangeInput,
  useLotteryShiftCheckoutsReportCashPointsQuery,
} from "@repo/graphql";
import { SelectField } from "@repo/ui/select-field";

import { useSession } from "@/hooks/base/useSession";
import type { ReportCustomFieldProps } from "@/lib/project/reports/report-registry";

/**
 * 班次結帳歷史報表的「收銀點」條件(Figma RE-05 `129:1512`):選的分店的收銀點 + 「全部」(值 = 空字串)。
 * 選項依分店查(`lotteryShiftCheckoutsReportCashPoints`);還沒選分店只有「全部」。
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
          label: point.name,
        })),
      ]}
    />
  );
};
