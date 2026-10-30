import {
  type LotteryOperationsReportInput,
  useLotteryOperationsReportPeriodsQuery,
} from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";
import type { ReportQueryInput } from "@/lib/base/reports/report-registry";

/**
 * 營運報表條件畫面的期間資訊(`lotteryOperationsReportPeriods`):各店實際期間(對齊日結)與已關帳到哪。
 * 條件不完整(沒選分店)時不查。條件卡片的逐店期間與月份格子的註記共用同一個查詢(同一個 key 只查一次)。
 */
export const useOperationsPeriods = (input: ReportQueryInput | null) => {
  const { session } = useSession();
  return useLotteryOperationsReportPeriodsQuery(
    session.client,
    { input: (input ?? {}) as LotteryOperationsReportInput },
    { enabled: input !== null },
  );
};
