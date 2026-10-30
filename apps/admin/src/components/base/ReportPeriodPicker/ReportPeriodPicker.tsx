import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import { Stack } from "@repo/ui/stack";
import { Tabs } from "@repo/ui/tabs";

import {
  type ReportPeriodKind,
  type ReportPeriodValue,
  normalizePeriod,
} from "@/lib/base/reports/report-period";

import { DayPeriodPicker } from "./DayPeriodPicker";
import { MonthPeriodPicker } from "./MonthPeriodPicker";
import { WeekPeriodPicker } from "./WeekPeriodPicker";

export interface ReportPeriodPickerProps {
  /** 目前的期間(起點日期已整理過,見 `normalizePeriod`) */
  value: ReportPeriodValue;
  onChange: (value: ReportPeriodValue) => void;
  /** 可選的期間類型(頁籤順序照這裡);只有一種時不顯示頁籤 */
  kinds: readonly ReportPeriodKind[];
  /** 租戶時區的今天(`YYYY-MM-DD`;快捷與月曆的「今天」都用它,不用瀏覽器時區) */
  today: string;
  /** 月格子下方的註記(例:已關帳 / 尚未關帳);`month` 是 `YYYY-MM` */
  monthCaption?: (month: string) => ReactNode;
}

const isKind = (
  kinds: readonly ReportPeriodKind[],
  value: string,
): value is ReportPeriodKind => (kinds as readonly string[]).includes(value);

/**
 * 報表的期間選擇器(正本 `docs/modules/reports.md`「期間」):
 *
 * - **日**:日期 + [今天] [昨天]
 * - **週**:月曆點任一天選整週(星期日起),下方顯示「10/11(日)~ 10/17(六)」+ [本週] [上週];不顯示週次
 * - **月**:年份切換 + 12 個月格子 + [本月] [上月]
 *
 * 值是「期間類型 + 起點日期」,換成起訖時點由呼叫端用 `reportPeriodRange`(租戶時區);沒有自訂區間。
 */
export const ReportPeriodPicker = ({
  value,
  onChange,
  kinds,
  today,
  monthCaption,
}: ReportPeriodPickerProps) => {
  const t = useTranslations("admin.reports.periodPicker");
  const select = (kind: ReportPeriodKind, date: string) => {
    onChange(normalizePeriod({ kind, date }, today));
  };

  return (
    <Stack spacing={2}>
      {kinds.length > 1 && (
        <Tabs
          aria-label={t("kindsAria")}
          value={value.kind}
          onChange={(next) => {
            if (isKind(kinds, next)) select(next, value.date);
          }}
          items={kinds.map((kind) => ({
            value: kind,
            label: t(`kinds.${kind}`),
          }))}
        />
      )}
      {value.kind === "day" && (
        <DayPeriodPicker value={value.date} today={today} onSelect={select} />
      )}
      {value.kind === "week" && (
        <WeekPeriodPicker value={value.date} today={today} onSelect={select} />
      )}
      {value.kind === "month" && (
        <MonthPeriodPicker
          value={value.date}
          today={today}
          onSelect={select}
          monthCaption={monthCaption}
        />
      )}
    </Stack>
  );
};
