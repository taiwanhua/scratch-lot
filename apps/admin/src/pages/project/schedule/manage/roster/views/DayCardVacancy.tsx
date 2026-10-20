import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";

import { vacancySwatchSx } from "@/components/project/schedule/ScheduleLegend/schedule-legend-styles";

export interface DayCardVacancyProps {
  role: "leader" | "helper";
  /** 有 `edit` 才能點 */
  canAdd: boolean;
  /** 點了新增排班(帶好那筆人力需求與執行任務) */
  onAdd: () => void;
}

const vacancySx = {
  border: 1,
  borderRadius: 1,
  px: 1,
  py: 0.75,
  font: "inherit",
  typography: "caption",
  fontWeight: 600,
  textAlign: "left",
} as const;

/** 手機日檢視卡片裡的缺額虛線空位(「缺負責 1」紅、「缺協同 1」橘)。 */
export const DayCardVacancy = ({
  role,
  canAdd,
  onAdd,
}: DayCardVacancyProps) => {
  const t = useTranslations("admin.schedule.roster.timeline");
  const label = t(role === "leader" ? "missingLeader" : "missingHelper");
  // 虛線框樣式放後面:`border: 1` 會蓋掉框的樣式與顏色
  const sx = [
    vacancySx,
    vacancySwatchSx(role === "leader" ? "error" : "warning"),
  ];
  return canAdd ? (
    <Box component="button" onClick={onAdd} sx={[...sx, { cursor: "pointer" }]}>
      {label}
    </Box>
  ) : (
    <Box sx={sx}>{label}</Box>
  );
};
