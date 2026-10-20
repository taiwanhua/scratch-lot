import type { ReportPeriodKind } from "@/lib/project/reports/report-period";

/** 日 / 週 / 月三個子選擇器共用的 props。 */
export interface PeriodKindPickerProps {
  /** 期間起點 `YYYY-MM-DD`(日 = 那一天、週 = 星期日、月 = 1 日) */
  value: string;
  /** 租戶時區的今天 */
  today: string;
  onSelect: (kind: ReportPeriodKind, date: string) => void;
}
