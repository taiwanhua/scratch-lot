import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";

import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useScheduleFieldOptions } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";
import { localPartsOf, monthDayOf } from "@/lib/project/schedule-roster";

import type { RosterData } from "../roster-context";
import type { RosterCheckItem } from "./roster-check-context";

const dayOf = (date: string | null | undefined): string =>
  typeof date === "string" && date !== "" ? monthDayOf(date) : "";

/**
 * 檢核項目的一句話(檢核面板、發布確認視窗;規格 14.5):依規則 key 組文案(`admin.schedule.roster.check.items`),
 * 人的規則前面帶姓名;人力不足寫人力需求(範本名稱 / 「臨」+ 崗位)、時段、缺幾人與可排人數或原因。
 * 不認得的 key(之後追加的類別)退回 api 的說明。
 */
export const useCheckItemText = (
  data: RosterData | undefined,
): ((item: RosterCheckItem) => string) => {
  const t = useTranslations("admin.schedule.roster.check");
  const tRoster = useTranslations("admin.schedule.roster");
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const positions = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.position,
  );
  const time = (value: string | null | undefined) =>
    value === null || value === undefined
      ? ""
      : localPartsOf(value, timezone).time;

  const demandLabelOf = (demandId: string) => {
    const demand = data?.demands.find((item) => item.id === demandId);
    if (demand === undefined) {
      return "";
    }
    const template = data?.templates.find(
      (item) => item.id === demand.templateId,
    );
    return [
      template?.name ?? tRoster("tempRow"),
      positions.labelOf(demand.positionKey),
    ].join(" ");
  };

  const understaffedText = (item: RosterCheckItem) => {
    const detail = item.understaffed;
    if (detail === null || detail === undefined) {
      return item.message;
    }
    const base = t("items.understaffed", {
      date: dayOf(item.date),
      demand: demandLabelOf(detail.demandId),
      start: time(item.startAt),
      end: time(item.endAt),
      missing: detail.missing,
      role: tRoster(`cell.roles.${detail.role}`),
    });
    if (detail.available > 0) {
      return `${base}${t("items.understaffedAvailable", { count: detail.available })}`;
    }
    const reasons = [
      detail.dayOff > 0 ? t("reasons.dayOff", { count: detail.dayOff }) : null,
      detail.timeRange > 0
        ? t("reasons.timeRange", { count: detail.timeRange })
        : null,
      detail.occupied > 0
        ? t("reasons.occupied", { count: detail.occupied })
        : null,
      detail.cannotLead > 0
        ? t("reasons.cannotLead", { count: detail.cannotLead })
        : null,
    ].filter((reason) => reason !== null);
    return `${base}${t("items.understaffedNone", { reasons: reasons.join("、") })}`;
  };

  return (item) => {
    const name = item.userName ?? "";
    const actual = item.actual ?? 0;
    const limit = item.limit ?? 0;
    const from = dayOf(item.from);
    const to = dayOf(item.to);
    const date = dayOf(item.date);
    const start = time(item.startAt);
    const end = time(item.endAt);
    switch (item.key) {
      case "maxMonthlyDayOffs": {
        return t("items.maxMonthlyDayOffs", { name, actual, limit });
      }
      case "minMonthlyDayOffs": {
        return t("items.minMonthlyDayOffs", { name, actual, limit });
      }
      case "maxConsecutiveDaysOff": {
        return t("items.maxConsecutiveDaysOff", {
          name,
          actual,
          limit,
          from,
          to,
        });
      }
      case "maxDailyDayOffStaff": {
        return t("items.maxDailyDayOffStaff", {
          actual,
          limit,
          date: dayOf(item.from ?? item.date),
        });
      }
      case "maxConsecutiveWorkDays": {
        return t("items.maxConsecutiveWorkDays", {
          name,
          actual,
          limit,
          from,
          to,
        });
      }
      case "minRestBetweenShifts": {
        // 休息那段:前一班下班(startAt)→ 後一班上班(endAt)
        return t("items.minRestBetweenShifts", {
          name,
          actual,
          limit,
          from,
          to,
          end: start,
          start: end,
        });
      }
      case "maxDailyWorkHours": {
        return t("items.maxDailyWorkHours", { name, actual, limit, date });
      }
      case "multiPositionOverlap": {
        return t("items.multiPositionOverlap", {
          name,
          actual,
          date,
          start,
          end,
        });
      }
      case "understaffed": {
        return understaffedText(item);
      }
      case "dayOffEntryConflict": {
        if (!item.isOtherStore) {
          return t("items.dayOffEntryConflict", { name, date, start, end });
        }
        return typeof item.orgName === "string"
          ? t("items.dayOffEntryConflictOther", {
              name,
              date,
              start,
              end,
              org: item.orgName,
            })
          : t("items.dayOffEntryConflictUnknown", { name, date, start, end });
      }
      case "unmatchedPunches": {
        return t("items.unmatchedPunches", { name, date, count: actual });
      }
      default: {
        return item.message;
      }
    }
  };
};
