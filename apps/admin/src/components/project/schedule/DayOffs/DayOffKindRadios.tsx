import { useTranslations } from "use-intl";

import { FormControlLabel } from "@repo/ui/form-control-label";
import { Radio } from "@repo/ui/radio";
import { Stack } from "@repo/ui/stack";

import { FieldErrorGroup } from "@/components/base/FieldErrorGroup/FieldErrorGroup";
import type { DayOffKind } from "@/lib/project/schedule-day-offs";

export interface DayOffKindRadiosProps {
  value: DayOffKind;
  onChange: (kind: DayOffKind) => void;
  /** 寫在選項正下方的原因(REACT-18;例:這一天已經有整天的畫休) */
  errorText?: string;
}

/** 畫休種類:整天畫休 / 時段不可排(登記畫休與代改共用)。 */
export const DayOffKindRadios = ({
  value,
  onChange,
  errorText,
}: DayOffKindRadiosProps) => {
  const t = useTranslations("admin.schedule.dayOffs");
  return (
    <FieldErrorGroup label={t("override.kind")} errorText={errorText}>
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
    </FieldErrorGroup>
  );
};
