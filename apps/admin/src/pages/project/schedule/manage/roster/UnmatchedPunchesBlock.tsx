import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Checkbox } from "@repo/ui/checkbox";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import {
  type DayPunch,
  duplicatePunchIdsOfDay,
} from "@/lib/project/schedule-attendance";
import { localPartsOf } from "@/lib/project/schedule-roster";

export interface UnmatchedPunchesBlockProps {
  /** 「王小明 11/5」 */
  heading: string;
  /** 這個人這天在這家店未對應排班的卡(依時間) */
  punches: readonly DayPunch[];
  checked: ReadonlySet<string>;
  onToggle: (punchId: string, isChecked: boolean) => void;
  /** 有 `schedule.manage.use-punch-time` 才顯示「上下班時間改用打卡時間」 */
  canUsePunchTime: boolean;
  usePunchTime: boolean;
  onUsePunchTimeChange: (next: boolean) => void;
  disabled: boolean;
  timezone: string;
}

/**
 * 排班對話框的「未對應排班的打卡」區塊(SC-04d、SC-04e ①;規格 14.5):列出這個人那天全部未對應的卡,
 * 每張可以勾選(預設勾排班時間前後容許時間內的;重複打卡標「重複打卡」、預設不勾),儲存時勾選的一起
 * 對應到這筆排班。「上下班時間改用打卡時間」預設不勾,沒有 `use-punch-time` 不顯示。
 */
export const UnmatchedPunchesBlock = ({
  heading,
  punches,
  checked,
  onToggle,
  canUsePunchTime,
  usePunchTime,
  onUsePunchTimeChange,
  disabled,
  timezone,
}: UnmatchedPunchesBlockProps) => {
  const t = useTranslations("admin.schedule.roster.entryDialog.punches");
  if (punches.length === 0) {
    return null;
  }
  const duplicates = duplicatePunchIdsOfDay(punches);
  return (
    <Box
      component="section"
      aria-label={t("region")}
      data-unmatched-punches
      sx={{
        border: 1,
        borderColor: "warning.light",
        bgcolor: "warning.lighter",
        borderRadius: 1.5,
        px: 1.5,
        py: 1.25,
      }}
    >
      <Stack spacing={0.5}>
        <Typography variant="subtitle2" component="h3">
          {t("title", { heading, count: punches.length })}
        </Typography>
        {punches.map((punch) => {
          const time = localPartsOf(punch.at, timezone).time;
          const type = punch.type === "in" ? t("in") : t("out");
          return (
            <FormControlLabel
              key={punch.id}
              label={
                duplicates.has(punch.id)
                  ? t("duplicateLabel", { time, type })
                  : t("label", { time, type })
              }
              disabled={disabled}
              control={
                <Checkbox
                  checked={checked.has(punch.id)}
                  onChange={(event) => {
                    onToggle(punch.id, event.target.checked);
                  }}
                />
              }
            />
          );
        })}
        {canUsePunchTime && (
          <Box sx={{ borderTop: 1, borderColor: "divider", pt: 0.5 }}>
            <FormControlLabel
              label={t("usePunchTime")}
              disabled={disabled}
              control={
                <Checkbox
                  checked={usePunchTime}
                  onChange={(event) => {
                    onUsePunchTimeChange(event.target.checked);
                  }}
                />
              }
            />
          </Box>
        )}
      </Stack>
    </Box>
  );
};
