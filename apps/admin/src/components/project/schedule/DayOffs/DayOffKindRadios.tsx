import { useTranslations } from "use-intl";

import { FormControlLabel } from "@repo/ui/form-control-label";
import { Radio } from "@repo/ui/radio";
import { Stack } from "@repo/ui/stack";

import type { DayOffKind } from "@/lib/project/schedule-day-offs";

export interface DayOffKindRadiosProps {
  value: DayOffKind;
  onChange: (kind: DayOffKind) => void;
}

/** 畫休種類:整天畫休 / 時段不可排(登記畫休與代改共用)。 */
export const DayOffKindRadios = ({
  value,
  onChange,
}: DayOffKindRadiosProps) => {
  const t = useTranslations("admin.schedule.dayOffs");
  return (
    <Stack direction="row" spacing={2}>
      <FormControlLabel
        label={t("fullDay")}
        control={
          <Radio
            checked={value === "full-day"}
            onChange={() => {
              onChange("full-day");
            }}
          />
        }
      />
      <FormControlLabel
        label={t("timeRange")}
        control={
          <Radio
            checked={value === "time-range"}
            onChange={() => {
              onChange("time-range");
            }}
          />
        }
      />
    </Stack>
  );
};
